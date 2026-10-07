BEGIN;

-- Fill only missing snapshots. Once a document has a signature snapshot it is
-- immutable, even if the user later replaces or removes their profile image.
ALTER TABLE public.quotations DISABLE TRIGGER trg_validate_quote_update;
UPDATE public.quotations quote
SET sales_agent_signature_url_snapshot = profile.signature_url
FROM public.profiles profile
WHERE quote.sales_agent_signature_url_snapshot IS NULL
  AND profile.signature_url IS NOT NULL
  AND (
    quote.sales_agent_user_id = profile.id
    OR (quote.sales_agent_user_id IS NULL AND lower(trim(quote.sales_agent)) = lower(trim(profile.display_name)))
  );
ALTER TABLE public.quotations ENABLE TRIGGER trg_validate_quote_update;

UPDATE public.job_orders job
SET prepared_by_user_id = quote.sales_agent_user_id,
    prepared_by_name_snapshot = profile.display_name,
    prepared_by_signature_url_snapshot = profile.signature_url
FROM public.quotations quote
JOIN public.profiles profile ON profile.id = quote.sales_agent_user_id
WHERE job.quotation_id = quote.id
  AND quote.sales_agent_user_id IS NOT NULL
  AND (
    job.prepared_by_user_id IS DISTINCT FROM quote.sales_agent_user_id
    OR job.prepared_by_name_snapshot IS DISTINCT FROM profile.display_name
    OR job.prepared_by_signature_url_snapshot IS DISTINCT FROM profile.signature_url
  );

UPDATE public.job_orders job
SET approved_by_user_id = COALESCE(job.approved_by_user_id, profile.id),
    approved_by_signature_url_snapshot = profile.signature_url
FROM public.profiles profile
WHERE job.approved_by_signature_url_snapshot IS NULL
  AND profile.signature_url IS NOT NULL
  AND (
    job.approved_by_user_id = profile.id
    OR (job.approved_by_user_id IS NULL AND lower(trim(job.approved_by_name)) = lower(trim(profile.display_name)))
  );

UPDATE public.job_expenses expense
SET prepared_by_name_snapshot = profile.display_name,
    prepared_by_signature_url_snapshot = profile.signature_url
FROM public.profiles profile
WHERE expense.prepared_by_signature_url_snapshot IS NULL
  AND expense.created_by = profile.id
  AND profile.signature_url IS NOT NULL;

-- The Sales Agent selected on the quotation owns the displayed identity.
-- Capture both fields together so the printed quotation remains historically stable.
CREATE OR REPLACE FUNCTION public.snapshot_quotation_sales_agent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sales_agent_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.display_name, profile.signature_url
  INTO NEW.sales_agent, NEW.sales_agent_signature_url_snapshot
  FROM public.profiles profile
  WHERE profile.id = NEW.sales_agent_user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_quotation_sales_agent ON public.quotations;
CREATE TRIGGER trg_snapshot_quotation_sales_agent
BEFORE INSERT OR UPDATE OF sales_agent_user_id ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.snapshot_quotation_sales_agent();

CREATE OR REPLACE FUNCTION public.fill_empty_document_signatures_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.signature_url IS NULL OR NEW.signature_url IS NOT DISTINCT FROM OLD.signature_url THEN
    RETURN NEW;
  END IF;

  UPDATE public.quotations quote
  SET sales_agent_signature_url_snapshot = NEW.signature_url
  WHERE quote.sales_agent_signature_url_snapshot IS NULL
    AND (quote.sales_agent_user_id = NEW.id
      OR (quote.sales_agent_user_id IS NULL AND lower(trim(quote.sales_agent)) = lower(trim(NEW.display_name))));

  UPDATE public.job_orders job
  SET prepared_by_name_snapshot = NEW.display_name,
      prepared_by_signature_url_snapshot = NEW.signature_url
  WHERE job.prepared_by_signature_url_snapshot IS NULL
    AND job.prepared_by_user_id = NEW.id;

  UPDATE public.job_orders job
  SET approved_by_user_id = COALESCE(job.approved_by_user_id, NEW.id),
      approved_by_signature_url_snapshot = NEW.signature_url
  WHERE job.approved_by_signature_url_snapshot IS NULL
    AND (job.approved_by_user_id = NEW.id
      OR (job.approved_by_user_id IS NULL AND lower(trim(job.approved_by_name)) = lower(trim(NEW.display_name))));

  UPDATE public.job_expenses expense
  SET prepared_by_name_snapshot = NEW.display_name,
      prepared_by_signature_url_snapshot = NEW.signature_url
  WHERE expense.prepared_by_signature_url_snapshot IS NULL
    AND expense.created_by = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_fill_empty_document_signatures ON public.profiles;
CREATE TRIGGER profiles_fill_empty_document_signatures
AFTER UPDATE OF signature_url ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.fill_empty_document_signatures_from_profile();

NOTIFY pgrst, 'reload schema';
COMMIT;
