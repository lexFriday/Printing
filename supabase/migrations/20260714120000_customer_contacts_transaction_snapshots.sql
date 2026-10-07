-- Reusable company contacts with immutable transaction snapshots.
CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  contact_name text NOT NULL,
  department text,
  phone text,
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_active
  ON public.customer_contacts(customer_id, is_active, contact_name);

GRANT SELECT, INSERT, UPDATE ON public.customer_contacts TO authenticated;
GRANT ALL ON public.customer_contacts TO service_role;
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer contacts read operations" ON public.customer_contacts;
CREATE POLICY "customer contacts read operations" ON public.customer_contacts
  FOR SELECT TO authenticated
  USING (app_private.can_view_sensitive_operations(auth.uid()));

DROP POLICY IF EXISTS "customer contacts write sales" ON public.customer_contacts;
CREATE POLICY "customer contacts write sales" ON public.customer_contacts
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_sales_work(auth.uid()) AND created_by = auth.uid());

DROP POLICY IF EXISTS "customer contacts update sales" ON public.customer_contacts;
CREATE POLICY "customer contacts update sales" ON public.customer_contacts
  FOR UPDATE TO authenticated
  USING (app_private.can_sales_work(auth.uid()))
  WITH CHECK (app_private.can_sales_work(auth.uid()));

DROP TRIGGER IF EXISTS trg_customer_contacts_touch ON public.customer_contacts;
CREATE TRIGGER trg_customer_contacts_touch
  BEFORE UPDATE ON public.customer_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS customer_contact_id uuid REFERENCES public.customer_contacts(id),
  ADD COLUMN IF NOT EXISTS contact_name_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_department_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_phone_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_email_snapshot text;

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS customer_contact_id uuid REFERENCES public.customer_contacts(id),
  ADD COLUMN IF NOT EXISTS contact_name_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_department_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_phone_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_email_snapshot text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_contact_id uuid REFERENCES public.customer_contacts(id),
  ADD COLUMN IF NOT EXISTS contact_name_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_department_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_phone_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_email_snapshot text;

CREATE INDEX IF NOT EXISTS idx_quotations_customer_contact
  ON public.quotations(customer_contact_id);
CREATE INDEX IF NOT EXISTS idx_job_orders_customer_contact
  ON public.job_orders(customer_contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_contact
  ON public.invoices(customer_contact_id);

-- One compatibility contact per existing customer. New contacts use the directory above.
INSERT INTO public.customer_contacts (customer_id, contact_name, phone, email)
SELECT c.id, c.contact_person, c.contact_number, c.email
FROM public.customers c
WHERE NOT EXISTS (
  SELECT 1 FROM public.customer_contacts cc WHERE cc.customer_id = c.id
);

-- Preserve the current displayed contact for existing records before new selection is used.
UPDATE public.quotations q
SET customer_contact_id = cc.id,
    contact_name_snapshot = COALESCE(q.contact_name_snapshot, cc.contact_name),
    contact_phone_snapshot = COALESCE(q.contact_phone_snapshot, cc.phone),
    contact_email_snapshot = COALESCE(q.contact_email_snapshot, cc.email)
FROM public.customer_contacts cc
WHERE q.customer_contact_id IS NULL AND cc.customer_id = q.customer_id;

UPDATE public.job_orders j
SET customer_contact_id = q.customer_contact_id,
    contact_name_snapshot = COALESCE(j.contact_name_snapshot, q.contact_name_snapshot),
    contact_department_snapshot = COALESCE(j.contact_department_snapshot, q.contact_department_snapshot),
    contact_phone_snapshot = COALESCE(j.contact_phone_snapshot, q.contact_phone_snapshot),
    contact_email_snapshot = COALESCE(j.contact_email_snapshot, q.contact_email_snapshot)
FROM public.quotations q
WHERE j.quotation_id = q.id AND j.customer_contact_id IS NULL;

UPDATE public.invoices i
SET customer_contact_id = j.customer_contact_id,
    contact_name_snapshot = COALESCE(i.contact_name_snapshot, j.contact_name_snapshot),
    contact_department_snapshot = COALESCE(i.contact_department_snapshot, j.contact_department_snapshot),
    contact_phone_snapshot = COALESCE(i.contact_phone_snapshot, j.contact_phone_snapshot),
    contact_email_snapshot = COALESCE(i.contact_email_snapshot, j.contact_email_snapshot)
FROM public.job_orders j
WHERE i.job_order_id = j.id AND i.customer_contact_id IS NULL;

-- Populate quote snapshots from the selected directory contact when the client saves a quote.
CREATE OR REPLACE FUNCTION public.snapshot_quotation_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cc public.customer_contacts%ROWTYPE;
BEGIN
  IF NEW.customer_contact_id IS NOT NULL THEN
    SELECT * INTO cc
    FROM public.customer_contacts
    WHERE id = NEW.customer_contact_id
      AND customer_id = NEW.customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected contact does not belong to this customer';
    END IF;
    NEW.contact_name_snapshot := cc.contact_name;
    NEW.contact_department_snapshot := cc.department;
    NEW.contact_phone_snapshot := cc.phone;
    NEW.contact_email_snapshot := cc.email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_quotation_contact ON public.quotations;
CREATE TRIGGER trg_snapshot_quotation_contact
  BEFORE INSERT OR UPDATE OF customer_id, customer_contact_id ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_quotation_contact();

NOTIFY pgrst, 'reload schema';
