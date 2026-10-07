-- Enforce manager approval at the database boundary.
-- Owner/Admin is the existing approval authority; the client cannot choose the approver.
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
  manager_approval_transition BOOLEAN :=
    old_status = 'pending_manager_approval' AND new_status = 'sent';
BEGIN
  IF manager_approval_transition AND NOT app_private.can_manage_users(auth.uid()) THEN
    RAISE EXCEPTION 'Only owner or admin staff can approve quotations.';
  END IF;

  IF NOT manager_approval_transition
    AND NOT (reopening AND old_status IN ('pending_manager_approval', 'sent', 'approved') AND new_status = 'draft')
    AND (
      NEW.manager_approved_at IS DISTINCT FROM OLD.manager_approved_at
      OR NEW.manager_approved_by_user_id IS DISTINCT FROM OLD.manager_approved_by_user_id
    ) THEN
    RAISE EXCEPTION 'Manager approval fields are controlled by the approval workflow.';
  END IF;

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

    IF manager_approval_transition THEN
      NEW.manager_approved_at := COALESCE(OLD.manager_approved_at, now());
      NEW.manager_approved_by_user_id := auth.uid();
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

NOTIFY pgrst, 'reload schema';

-- Keep direct API contact selection aligned with the active-contact rule.
CREATE OR REPLACE FUNCTION public.snapshot_quotation_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_contact public.customer_contacts%ROWTYPE;
BEGIN
  IF NEW.customer_contact_id IS NOT NULL THEN
    SELECT *
    INTO selected_contact
    FROM public.customer_contacts
    WHERE id = NEW.customer_contact_id
      AND customer_id = NEW.customer_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected contact does not belong to this customer or is inactive';
    END IF;

    NEW.contact_name_snapshot := selected_contact.contact_name;
    NEW.contact_department_snapshot := selected_contact.department;
    NEW.contact_phone_snapshot := selected_contact.phone;
    NEW.contact_email_snapshot := selected_contact.email;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
