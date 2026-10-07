-- Restores the approved Money Out / Project Profitability schema for the preserved
-- Mitzy reports worktree. Additive only; no data is deleted or reset.
-- Create this table first because the historical foundation migration alters it.
BEGIN;
CREATE TABLE IF NOT EXISTS public.petty_cash_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custodian_name text NOT NULL CHECK (length(btrim(custodian_name)) > 0),
  cash_received numeric NOT NULL CHECK (cash_received > 0),
  funding_date date NOT NULL DEFAULT CURRENT_DATE,
  funding_source text NOT NULL CHECK (length(btrim(funding_source)) > 0),
  funding_reference text NOT NULL CHECK (length(btrim(funding_reference)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
COMMIT;

BEGIN;

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_expenses_supplier_id_idx ON public.job_expenses(supplier_id);
GRANT EXECUTE ON FUNCTION public.can_write_operations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated;

ALTER TABLE public.petty_cash_batches
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cv_reference_no text,
  ADD COLUMN IF NOT EXISTS cv_created_at timestamptz;
ALTER TABLE public.petty_cash_batches DROP CONSTRAINT IF EXISTS petty_cash_batches_status_check;
ALTER TABLE public.petty_cash_batches ADD CONSTRAINT petty_cash_batches_status_check CHECK (status IN ('open','closed','cv_created'));

CREATE TABLE IF NOT EXISTS public.petty_cash_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custodian_name text NOT NULL CHECK (length(btrim(custodian_name)) > 0),
  cash_received numeric NOT NULL CHECK (cash_received > 0),
  funding_date date NOT NULL DEFAULT CURRENT_DATE,
  funding_source text NOT NULL CHECK (length(btrim(funding_source)) > 0),
  funding_reference text NOT NULL CHECK (length(btrim(funding_reference)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS petty_cash_batch_id uuid REFERENCES public.petty_cash_batches(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.job_expense_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_expense_id uuid NOT NULL REFERENCES public.job_expenses(id) ON DELETE CASCADE,
  job_order_id uuid NOT NULL REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  allocated_amount numeric NOT NULL CHECK (allocated_amount > 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_expense_allocations_expense_idx
  ON public.job_expense_allocations(job_expense_id);
CREATE INDEX IF NOT EXISTS job_expense_allocations_job_idx
  ON public.job_expense_allocations(job_order_id);

ALTER TABLE public.petty_cash_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_expense_allocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.petty_cash_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_expense_allocations TO authenticated;

DROP POLICY IF EXISTS petty_cash_read ON public.petty_cash_batches;
DROP POLICY IF EXISTS petty_cash_write ON public.petty_cash_batches;
CREATE POLICY petty_cash_read ON public.petty_cash_batches FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
CREATE POLICY petty_cash_write ON public.petty_cash_batches FOR ALL TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (public.can_write_operations(auth.uid()));

DROP POLICY IF EXISTS expense_allocations_read ON public.job_expense_allocations;
DROP POLICY IF EXISTS expense_allocations_write ON public.job_expense_allocations;
CREATE POLICY expense_allocations_read ON public.job_expense_allocations FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
CREATE POLICY expense_allocations_write ON public.job_expense_allocations FOR ALL TO authenticated
  USING (public.can_write_operations(auth.uid()))
  WITH CHECK (public.can_write_operations(auth.uid()));

CREATE OR REPLACE FUNCTION public.validate_job_expense_allocations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source_amount numeric; total_allocated numeric;
BEGIN
  SELECT amount INTO source_amount FROM public.job_expenses
    WHERE id = COALESCE(NEW.job_expense_id, OLD.job_expense_id) FOR SHARE;
  SELECT COALESCE(SUM(allocated_amount), 0) INTO total_allocated
    FROM public.job_expense_allocations
    WHERE job_expense_id = COALESCE(NEW.job_expense_id, OLD.job_expense_id)
      AND id IS DISTINCT FROM COALESCE(NEW.id, OLD.id);
  IF TG_OP <> 'DELETE' THEN total_allocated := total_allocated + NEW.allocated_amount; END IF;
  IF source_amount IS NULL OR total_allocated > source_amount THEN
    RAISE EXCEPTION 'Allocation total cannot exceed the receipt amount.' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS validate_job_expense_allocations ON public.job_expense_allocations;
CREATE CONSTRAINT TRIGGER validate_job_expense_allocations
  AFTER INSERT OR UPDATE OR DELETE ON public.job_expense_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.validate_job_expense_allocations();

CREATE OR REPLACE FUNCTION public.replace_job_expense_allocations(
  p_expense_id uuid, p_allocations jsonb DEFAULT '[]'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source_amount numeric; allocation_total numeric;
BEGIN
  IF NOT public.can_write_operations(auth.uid()) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  SELECT amount INTO source_amount FROM public.job_expenses WHERE id = p_expense_id FOR UPDATE;
  IF source_amount IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  SELECT COALESCE(SUM((v->>'allocated_amount')::numeric), 0)
    INTO allocation_total FROM jsonb_array_elements(p_allocations) v;
  IF allocation_total <> 0 AND allocation_total <> source_amount THEN
    RAISE EXCEPTION 'Allocation total must equal the receipt amount.' USING ERRCODE = '23514';
  END IF;
  DELETE FROM public.job_expense_allocations WHERE job_expense_id = p_expense_id;
  INSERT INTO public.job_expense_allocations(job_expense_id, job_order_id, allocated_amount, created_by)
    SELECT p_expense_id, (v->>'job_order_id')::uuid, (v->>'allocated_amount')::numeric, auth.uid()
    FROM jsonb_array_elements(p_allocations) v;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_job_expense_allocations(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_job_expense_allocations(uuid, jsonb) TO authenticated;

COMMIT;



BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS job_expense_allocations_expense_job_unique
  ON public.job_expense_allocations(job_expense_id, job_order_id);

CREATE OR REPLACE FUNCTION public.replace_job_expense_allocations(
  p_expense_id uuid, p_allocations jsonb DEFAULT '[]'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  source_amount numeric;
  direct_job_order_id uuid;
  allocation_total numeric;
BEGIN
  IF NOT public.can_write_operations(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT amount, job_order_id INTO source_amount, direct_job_order_id
  FROM public.job_expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF source_amount IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  SELECT COALESCE(SUM((value->>'allocated_amount')::numeric), 0)
  INTO allocation_total
  FROM jsonb_array_elements(p_allocations) AS values(value);

  IF allocation_total > source_amount THEN
    RAISE EXCEPTION 'Allocation total cannot exceed the expense amount.' USING ERRCODE = '23514';
  END IF;

  IF allocation_total > 0 AND direct_job_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job Order allocations cannot be added to a directly linked expense.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.job_expense_allocations WHERE job_expense_id = p_expense_id;

  INSERT INTO public.job_expense_allocations(job_expense_id, job_order_id, allocated_amount, created_by)
    SELECT p_expense_id, (value->>'job_order_id')::uuid, (value->>'allocated_amount')::numeric, auth.uid()
    FROM jsonb_array_elements(p_allocations) AS values(value);
END;
$$;

DROP TRIGGER IF EXISTS capture_audit_log ON public.job_expense_allocations;
CREATE TRIGGER capture_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.job_expense_allocations
  FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log();

COMMIT;



BEGIN;

-- A cost affects Project Profitability only after a human Operations review.
-- These columns are the audit trail for that real business decision; reports derive
-- their totals from the original expense and allocation records.
ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS project_cost_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS project_cost_confirmed_by uuid REFERENCES auth.users(id);

ALTER TABLE public.job_expense_allocations
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS job_expenses_project_cost_confirmation_idx
  ON public.job_expenses (project_cost_confirmed_at)
  WHERE project_cost_confirmed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_expense_allocations_confirmation_idx
  ON public.job_expense_allocations (confirmed_at)
  WHERE confirmed_at IS NOT NULL;

-- Preserve the visibility of pre-existing local costs. New costs remain unconfirmed
-- until an Owner or Admin explicitly confirms them below.
UPDATE public.job_expenses
SET project_cost_confirmed_at = COALESCE(updated_at, created_at, now()),
    project_cost_confirmed_by = COALESCE(created_by, project_cost_confirmed_by)
WHERE job_order_id IS NOT NULL
  AND project_cost_confirmed_at IS NULL;

UPDATE public.job_expense_allocations
SET confirmed_at = COALESCE(created_at, now()),
    confirmed_by = COALESCE(created_by, confirmed_by)
WHERE confirmed_at IS NULL;

-- Editing either the direct project link/amount or an allocation requires a fresh
-- Operations review. The confirmation action itself updates only confirmation fields,
-- so it does not invalidate itself.
CREATE OR REPLACE FUNCTION public.invalidate_project_cost_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_expense_id := OLD.job_expense_id;
  ELSE
    v_expense_id := NEW.job_expense_id;
  END IF;
  UPDATE public.job_expenses
  SET project_cost_confirmed_at = NULL,
      project_cost_confirmed_by = NULL
  WHERE id = v_expense_id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_project_cost_confirmation_from_allocation
  ON public.job_expense_allocations;
CREATE TRIGGER invalidate_project_cost_confirmation_from_allocation
AFTER INSERT OR DELETE OR UPDATE OF job_order_id, allocated_amount
ON public.job_expense_allocations
FOR EACH ROW EXECUTE FUNCTION public.invalidate_project_cost_confirmation();

DROP TRIGGER IF EXISTS invalidate_project_cost_confirmation_from_expense
  ON public.job_expenses;
CREATE TRIGGER invalidate_project_cost_confirmation_from_expense
AFTER UPDATE OF job_order_id, amount
ON public.job_expenses
FOR EACH ROW EXECUTE FUNCTION public.invalidate_project_cost_confirmation();

CREATE OR REPLACE FUNCTION public.confirm_expense_project_cost(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_direct_job_order_id uuid;
  v_has_allocations boolean;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Owner or Admin confirmation is required.' USING ERRCODE = '42501';
  END IF;

  SELECT job_order_id INTO v_direct_job_order_id
  FROM public.job_expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.job_expense_allocations WHERE job_expense_id = p_expense_id
  ) INTO v_has_allocations;

  IF v_direct_job_order_id IS NULL AND NOT v_has_allocations THEN
    RAISE EXCEPTION 'Assign this expense to a Job Order before confirming it.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.job_expenses
  SET project_cost_confirmed_at = now(),
      project_cost_confirmed_by = auth.uid()
  WHERE id = p_expense_id;

  UPDATE public.job_expense_allocations
  SET confirmed_at = now(),
      confirmed_by = auth.uid()
  WHERE job_expense_id = p_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_expense_project_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_expense_project_cost(uuid) TO authenticated;

COMMIT;


