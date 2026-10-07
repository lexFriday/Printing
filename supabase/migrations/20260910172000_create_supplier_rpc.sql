BEGIN;

CREATE OR REPLACE FUNCTION public.create_supplier(
  p_name TEXT,
  p_tin_number TEXT DEFAULT NULL,
  p_contact_person TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_supplier_id UUID;
  v_name TEXT := NULLIF(trim(p_name), '');
  v_tin TEXT := NULLIF(regexp_replace(COALESCE(p_tin_number, ''), '[^0-9]', '', 'g'), '');
  v_contact TEXT := NULLIF(trim(p_contact_person), '');
  v_address TEXT := NULLIF(trim(p_address), '');
  v_phone TEXT := NULLIF(trim(p_phone), '');
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchasing access is required to add suppliers';
  END IF;

  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Supplier name is required and must be 120 characters or fewer';
  END IF;
  IF v_tin IS NOT NULL AND v_tin !~ '^[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'TIN must contain 9 to 15 digits';
  END IF;
  IF v_phone IS NOT NULL AND (length(v_phone) < 7 OR length(v_phone) > 20) THEN
    RAISE EXCEPTION 'Enter a valid phone number';
  END IF;
  IF v_contact IS NOT NULL AND length(v_contact) > 120 THEN
    RAISE EXCEPTION 'Contact person must be 120 characters or fewer';
  END IF;
  IF v_address IS NOT NULL AND length(v_address) > 500 THEN
    RAISE EXCEPTION 'Address must be 500 characters or fewer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE lower(trim(name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A supplier with this name already exists';
  END IF;

  INSERT INTO public.suppliers(name, tin_number, contact_person, address, phone, active)
  VALUES(v_name, v_tin, v_contact, v_address, v_phone, TRUE)
  RETURNING id INTO v_supplier_id;

  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, new_values)
  VALUES(
    auth.uid(),
    'supplier.created',
    'supplier',
    v_supplier_id,
    jsonb_build_object(
      'name', v_name,
      'tin_number', v_tin,
      'contact_person', v_contact,
      'address', v_address,
      'phone', v_phone
    )
  );

  RETURN v_supplier_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_supplier(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_supplier(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
