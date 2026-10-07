ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signature_url TEXT;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS sales_agent_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS sales_agent_signature_url_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_label TEXT NOT NULL DEFAULT 'Adjustment',
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  role TEXT,
  signature_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS user_id,
    p.display_name,
    ur.role::text AS role,
    p.signature_url
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = auth.uid()
    AND p.status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_user_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_quote_derived_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.adjustment_label := COALESCE(NULLIF(trim(NEW.adjustment_label), ''), 'Adjustment');
  NEW.adjustment_amount := COALESCE(NEW.adjustment_amount, 0);
  NEW.total_amount := COALESCE(NEW.subtotal, 0) + NEW.adjustment_amount;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_quote_derived_totals ON public.quotations;
CREATE TRIGGER trg_apply_quote_derived_totals
  BEFORE INSERT OR UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.apply_quote_derived_totals();

CREATE OR REPLACE FUNCTION public.recompute_quote_totals(_quote UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s NUMERIC(14,2);
BEGIN
  SELECT COALESCE(SUM(line_total), 0)
  INTO s
  FROM public.quote_line_items
  WHERE quotation_id = _quote;

  UPDATE public.quotations
  SET subtotal = s
  WHERE id = _quote;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_quote_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, app_private
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
  reopening BOOLEAN := current_setting('app.reopen_quote_for_correction', true) = 'on';
  actor_signature TEXT;
BEGIN
  IF old_status <> 'draft' THEN
    IF NOT (reopening AND old_status = 'approved' AND new_status = 'draft') THEN
      IF NEW.customer_id <> OLD.customer_id
        OR NEW.project_name <> OLD.project_name
        OR NEW.quote_date <> OLD.quote_date
        OR COALESCE(NEW.remarks, '') <> COALESCE(OLD.remarks, '')
        OR COALESCE(NEW.sales_agent, '') <> COALESCE(OLD.sales_agent, '')
        OR COALESCE(NEW.terms, '') <> COALESCE(OLD.terms, '')
        OR COALESCE(NEW.sales_agent_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
           <> COALESCE(OLD.sales_agent_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        OR COALESCE(NEW.sales_agent_signature_url_snapshot, '')
           <> COALESCE(OLD.sales_agent_signature_url_snapshot, '')
        OR COALESCE(NEW.adjustment_label, '') <> COALESCE(OLD.adjustment_label, '')
        OR NEW.adjustment_amount <> OLD.adjustment_amount
        OR NEW.subtotal <> OLD.subtotal
        OR NEW.total_amount <> OLD.total_amount
        OR NEW.tax_type <> OLD.tax_type THEN
        RAISE EXCEPTION 'Only draft quotations can be edited.';
      END IF;
    END IF;
  END IF;

  IF new_status <> old_status THEN
    IF old_status = 'draft' AND new_status <> 'sent' THEN
      RAISE EXCEPTION 'Draft quotations must be sent before approval or rejection.';
    END IF;

    IF old_status = 'sent' AND new_status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Sent quotations can only be approved or rejected.';
    END IF;

    IF old_status IN ('approved', 'rejected') THEN
      IF NOT (reopening AND old_status = 'approved' AND new_status = 'draft') THEN
        RAISE EXCEPTION 'Final quotation statuses cannot be changed.';
      END IF;
    END IF;

    IF new_status IN ('sent', 'approved') AND NEW.total_amount <= 0 THEN
      RAISE EXCEPTION 'Quote total must be greater than zero.';
    END IF;

    IF new_status = 'sent' AND OLD.status = 'draft' THEN
      NEW.sent_at := COALESCE(NEW.sent_at, now());
      IF NEW.sales_agent_user_id IS NULL THEN
        NEW.sales_agent_user_id := auth.uid();
      END IF;
      SELECT p.signature_url
      INTO actor_signature
      FROM public.profiles p
      WHERE p.id = COALESCE(NEW.sales_agent_user_id, auth.uid());
      NEW.sales_agent_signature_url_snapshot := actor_signature;
    END IF;

    IF new_status = 'approved' THEN
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    END IF;

    IF new_status = 'rejected' THEN
      NEW.rejected_at := COALESCE(NEW.rejected_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_quotation_for_correction(
  quotation_id UUID,
  reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  q public.quotations%ROWTYPE;
  actor_role TEXT;
  trimmed_reason TEXT := trim(COALESCE(reason, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to reopen quotations.';
  END IF;

  SELECT ur.role::text
  INTO actor_role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = auth.uid()
    AND p.status = 'active'
  LIMIT 1;

  IF actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owner or admin staff can reopen approved quotations.';
  END IF;

  IF trimmed_reason = '' THEN
    RAISE EXCEPTION 'A correction reason is required.';
  END IF;

  SELECT *
  INTO q
  FROM public.quotations
  WHERE id = quotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found.';
  END IF;

  IF q.status::text <> 'approved' THEN
    RAISE EXCEPTION 'Only approved quotations can be reopened for correction.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.job_orders jo WHERE jo.quotation_id = q.id) THEN
    RAISE EXCEPTION 'This quotation already has a job order and cannot be reopened.';
  END IF;

  PERFORM set_config('app.reopen_quote_for_correction', 'on', true);

  UPDATE public.quotations
  SET
    status = 'draft',
    sent_at = NULL,
    approved_at = NULL,
    rejected_at = NULL
  WHERE id = q.id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    old_values,
    new_values
  )
  VALUES (
    auth.uid(),
    'quotation.reopened',
    'quotation',
    q.id,
    jsonb_build_object('status', q.status::text),
    jsonb_build_object(
      'status', 'draft',
      'reason', trimmed_reason,
      'old_status', q.status::text,
      'new_status', 'draft'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_quotation_for_correction(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_quotation_for_correction(UUID, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "qli editable sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales delete" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales delete" ON public.quote_line_items;

CREATE POLICY "qli draft sales insert" ON public.quote_line_items
  FOR INSERT TO authenticated WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  );

CREATE POLICY "qli draft sales update" ON public.quote_line_items
  FOR UPDATE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  )
  WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  );

CREATE POLICY "qli draft sales delete" ON public.quote_line_items
  FOR DELETE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status = 'draft'
    )
  );
