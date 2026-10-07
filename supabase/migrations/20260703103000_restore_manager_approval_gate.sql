ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'pending_manager_approval';
ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'pending_customer_approval';

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ;

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
    IF NOT (
      reopening
      AND old_status IN ('pending_manager_approval', 'sent', 'approved')
      AND new_status = 'draft'
    ) THEN
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
    IF old_status = 'draft' AND new_status <> 'pending_manager_approval' THEN
      RAISE EXCEPTION 'Draft quotations must be submitted for manager approval.';
    END IF;

    IF old_status = 'pending_manager_approval'
      AND NOT (new_status = 'sent' OR (reopening AND new_status = 'draft')) THEN
      RAISE EXCEPTION 'Manager approval is required before customer approval.';
    END IF;

    IF old_status = 'sent'
      AND NOT (new_status IN ('approved', 'rejected') OR (reopening AND new_status = 'draft')) THEN
      RAISE EXCEPTION 'Sent quotations can only be approved, rejected, or reopened for correction.';
    END IF;

    IF old_status IN ('approved', 'rejected') THEN
      IF NOT (reopening AND old_status = 'approved' AND new_status = 'draft') THEN
        RAISE EXCEPTION 'Final quotation statuses cannot be changed.';
      END IF;
    END IF;

    IF new_status IN ('pending_manager_approval', 'sent', 'approved') AND NEW.total_amount <= 0 THEN
      RAISE EXCEPTION 'Quote total must be greater than zero.';
    END IF;

    IF new_status = 'pending_manager_approval' AND OLD.status = 'draft' THEN
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

    IF new_status = 'sent' AND old_status = 'pending_manager_approval' THEN
      NEW.manager_approved_at := COALESCE(NEW.manager_approved_at, now());
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

  IF q.status::text NOT IN ('pending_manager_approval', 'sent', 'approved') THEN
    RAISE EXCEPTION 'Only submitted, sent, or approved quotations can be reopened for correction.';
  END IF;

  IF q.status::text IN ('pending_manager_approval', 'sent')
    AND actor_role NOT IN ('owner', 'admin', 'sales', 'staff') THEN
    RAISE EXCEPTION 'Only sales, owner, or admin staff can reopen this quotation.';
  END IF;

  IF q.status::text = 'approved' AND actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owner or admin staff can reopen approved quotations.';
  END IF;

  IF q.status::text = 'approved'
    AND EXISTS (SELECT 1 FROM public.job_orders jo WHERE jo.quotation_id = q.id) THEN
    RAISE EXCEPTION 'This quotation already has a job order and cannot be reopened.';
  END IF;

  PERFORM set_config('app.reopen_quote_for_correction', 'on', true);

  UPDATE public.quotations
  SET
    status = 'draft',
    sent_at = NULL,
    manager_approved_at = NULL,
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

NOTIFY pgrst, 'reload schema';
