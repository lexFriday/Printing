ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS approved_by_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS prepared_by_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS prepared_by_signature_url_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_signature_url_snapshot TEXT;

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS prepared_by_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS prepared_by_signature_url_snapshot TEXT;

UPDATE public.job_orders jo
SET prepared_by_name_snapshot = p.display_name,
    prepared_by_signature_url_snapshot = p.signature_url
FROM public.profiles p
WHERE p.id = jo.prepared_by_user_id
  AND jo.prepared_by_signature_url_snapshot IS NULL;

UPDATE public.job_orders jo
SET approved_by_user_id = p.id,
    approved_by_signature_url_snapshot = p.signature_url
FROM public.profiles p
WHERE lower(trim(p.display_name)) = lower(trim(jo.approved_by_name))
  AND jo.approved_by_user_id IS NULL;

UPDATE public.job_expenses expense
SET prepared_by_name_snapshot = p.display_name,
    prepared_by_signature_url_snapshot = p.signature_url
FROM public.profiles p
WHERE p.id = expense.created_by
  AND expense.prepared_by_signature_url_snapshot IS NULL;

CREATE OR REPLACE FUNCTION public.snapshot_job_order_signatures()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.prepared_by_user_id IS DISTINCT FROM OLD.prepared_by_user_id THEN
    SELECT display_name, signature_url
    INTO NEW.prepared_by_name_snapshot, NEW.prepared_by_signature_url_snapshot
    FROM public.profiles WHERE id = NEW.prepared_by_user_id;
  END IF;

  IF NEW.approved_by_user_id IS NULL AND NEW.approved_by_name IS NOT NULL THEN
    SELECT id INTO NEW.approved_by_user_id
    FROM public.profiles
    WHERE lower(trim(display_name)) = lower(trim(NEW.approved_by_name))
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id THEN
    SELECT signature_url INTO NEW.approved_by_signature_url_snapshot
    FROM public.profiles WHERE id = NEW.approved_by_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_orders_snapshot_signatures ON public.job_orders;
CREATE TRIGGER job_orders_snapshot_signatures
BEFORE INSERT OR UPDATE OF prepared_by_user_id, approved_by_user_id, approved_by_name
ON public.job_orders
FOR EACH ROW EXECUTE FUNCTION public.snapshot_job_order_signatures();

CREATE OR REPLACE FUNCTION public.snapshot_expense_signature()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT display_name, signature_url
  INTO NEW.prepared_by_name_snapshot, NEW.prepared_by_signature_url_snapshot
  FROM public.profiles WHERE id = NEW.created_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_expenses_snapshot_signature ON public.job_expenses;
CREATE TRIGGER job_expenses_snapshot_signature
BEFORE INSERT OR UPDATE OF created_by ON public.job_expenses
FOR EACH ROW EXECUTE FUNCTION public.snapshot_expense_signature();
