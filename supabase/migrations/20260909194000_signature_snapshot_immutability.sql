BEGIN;

CREATE OR REPLACE FUNCTION public.snapshot_quotation_sales_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_signature text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status::text <> 'draft' AND (
    NEW.sales_agent_user_id IS DISTINCT FROM OLD.sales_agent_user_id OR
    NEW.sales_agent IS DISTINCT FROM OLD.sales_agent OR
    NEW.sales_agent_signature_url_snapshot IS DISTINCT FROM OLD.sales_agent_signature_url_snapshot
  ) THEN
    RAISE EXCEPTION 'Finalized quotation signer and signature are immutable';
  END IF;

  IF NEW.sales_agent_user_id IS NULL THEN
    IF NEW.status::text <> 'draft' THEN
      RAISE EXCEPTION 'Select a Sales Agent before submitting the quotation';
    END IF;
    NEW.sales_agent := NULL;
    NEW.sales_agent_signature_url_snapshot := NULL;
    RETURN NEW;
  END IF;

  SELECT display_name, signature_url
  INTO v_name, v_signature
  FROM public.profiles
  WHERE id = NEW.sales_agent_user_id AND status::text = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected Sales Agent is not active';
  END IF;

  NEW.sales_agent := v_name;
  IF TG_OP = 'INSERT' OR NEW.status::text = 'draft' THEN
    NEW.sales_agent_signature_url_snapshot := NULL;
  END IF;
  IF NEW.status::text <> 'draft' AND (TG_OP = 'INSERT' OR OLD.status::text = 'draft') THEN
    IF v_signature IS NULL THEN
      RAISE EXCEPTION 'Selected Sales Agent must upload a signature before submission';
    END IF;
    NEW.sales_agent_signature_url_snapshot := v_signature;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_snapshot_quotation_sales_agent ON public.quotations;
CREATE TRIGGER trg_snapshot_quotation_sales_agent
BEFORE INSERT OR UPDATE OF sales_agent_user_id, status, sales_agent, sales_agent_signature_url_snapshot
ON public.quotations
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_quotation_sales_agent();

CREATE OR REPLACE FUNCTION public.snapshot_job_order_signatures()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.prepared_by_user_id IS DISTINCT FROM OLD.prepared_by_user_id OR
       NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id OR
       NEW.prepared_by_name_snapshot IS DISTINCT FROM OLD.prepared_by_name_snapshot OR
       NEW.approved_by_name IS DISTINCT FROM OLD.approved_by_name OR
       NEW.prepared_by_signature_url_snapshot IS DISTINCT FROM OLD.prepared_by_signature_url_snapshot OR
       NEW.approved_by_signature_url_snapshot IS DISTINCT FROM OLD.approved_by_signature_url_snapshot THEN
      RAISE EXCEPTION 'Job Order signer identity and signatures are immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.prepared_by_user_id IS NULL OR NEW.approved_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Job Order signers are required';
  END IF;

  SELECT display_name, signature_url
  INTO NEW.prepared_by_name_snapshot, NEW.prepared_by_signature_url_snapshot
  FROM public.profiles
  WHERE id = NEW.prepared_by_user_id AND status::text = 'active';

  SELECT display_name, signature_url
  INTO NEW.approved_by_name, NEW.approved_by_signature_url_snapshot
  FROM public.profiles
  WHERE id = NEW.approved_by_user_id AND status::text = 'active';

  IF NEW.prepared_by_signature_url_snapshot IS NULL OR
     NEW.approved_by_signature_url_snapshot IS NULL THEN
    RAISE EXCEPTION 'Both Job Order signers must upload signatures first';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS job_orders_snapshot_signatures ON public.job_orders;
CREATE TRIGGER job_orders_snapshot_signatures
BEFORE INSERT OR UPDATE OF prepared_by_user_id, approved_by_user_id,
  prepared_by_name_snapshot, approved_by_name,
  prepared_by_signature_url_snapshot, approved_by_signature_url_snapshot
ON public.job_orders
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_job_order_signatures();

NOTIFY pgrst, 'reload schema';
COMMIT;
