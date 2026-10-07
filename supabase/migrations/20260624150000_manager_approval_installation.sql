ALTER TYPE public.expense_type ADD VALUE IF NOT EXISTS 'installation';

ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'pending_manager_approval';
ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'pending_customer_approval';

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS submitted_for_manager_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_decided_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.validate_quote_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, app_private AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
BEGIN
  IF old_status <> 'draft' THEN
    IF NEW.customer_id <> OLD.customer_id
      OR NEW.project_name <> OLD.project_name
      OR NEW.quote_date <> OLD.quote_date
      OR COALESCE(NEW.remarks, '') <> COALESCE(OLD.remarks, '')
      OR NEW.subtotal <> OLD.subtotal
      OR NEW.total_amount <> OLD.total_amount
      OR NEW.tax_type <> OLD.tax_type THEN
      RAISE EXCEPTION 'Only draft quotations can be edited.';
    END IF;
  END IF;

  IF new_status <> old_status THEN
    IF old_status = 'draft' AND new_status <> 'pending_manager_approval' THEN
      RAISE EXCEPTION 'Draft quotations must be submitted for manager approval.';
    END IF;

    IF old_status = 'pending_manager_approval' THEN
      IF new_status <> 'pending_customer_approval' THEN
        RAISE EXCEPTION 'Manager-approved quotations must move to customer approval.';
      END IF;
      IF NOT app_private.can_create_job_orders(auth.uid()) THEN
        RAISE EXCEPTION 'Only owner or admin staff can approve quotations for customer approval.';
      END IF;
    END IF;

    IF old_status IN ('pending_customer_approval', 'sent')
      AND new_status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Customer approval quotations can only be approved or rejected.';
    END IF;

    IF old_status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Final quotation statuses cannot be changed.';
    END IF;

    IF new_status IN ('pending_manager_approval', 'pending_customer_approval', 'approved')
      AND NEW.total_amount <= 0 THEN
      RAISE EXCEPTION 'Quote total must be greater than zero.';
    END IF;

    IF new_status = 'pending_manager_approval' THEN
      NEW.submitted_for_manager_at := COALESCE(NEW.submitted_for_manager_at, now());
    END IF;
    IF new_status = 'pending_customer_approval' THEN
      NEW.manager_approved_at := COALESCE(NEW.manager_approved_at, now());
    END IF;
    IF new_status IN ('approved', 'rejected') THEN
      NEW.customer_decided_at := COALESCE(NEW.customer_decided_at, now());
    END IF;
  END IF;

  RETURN NEW;
END; $$;
