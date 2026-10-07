-- Keep the purchase request's display snapshot aligned with the supplier
-- record chosen by the guarded supplier action.
CREATE OR REPLACE FUNCTION public.set_purchase_request_supplier(
  p_request_id UUID,
  p_supplier_id UUID DEFAULT NULL,
  p_new_supplier_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id UUID;
  v_supplier_name TEXT;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF (p_supplier_id IS NULL) = (NULLIF(trim(COALESCE(p_new_supplier_name, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Choose an existing supplier or enter one new supplier name';
  END IF;
  PERFORM 1 FROM public.purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase request unavailable';
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT id, supplier_name INTO v_supplier_id, v_supplier_name
    FROM public.suppliers
    WHERE id = p_supplier_id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'supplier unavailable';
    END IF;
  ELSE
    v_supplier_name := trim(p_new_supplier_name);
    SELECT id, supplier_name INTO v_supplier_id, v_supplier_name
    FROM public.suppliers
    WHERE lower(trim(supplier_name)) = lower(v_supplier_name)
    LIMIT 1;
    IF v_supplier_id IS NULL THEN
      v_supplier_name := trim(p_new_supplier_name);
      INSERT INTO public.suppliers(supplier_name, created_by)
      VALUES (v_supplier_name, auth.uid())
      RETURNING id INTO v_supplier_id;
    END IF;
  END IF;

  UPDATE public.purchase_requests
  SET supplier_id = v_supplier_id,
      supplier_name = v_supplier_name,
      updated_at = now()
  WHERE id = p_request_id;
  RETURN v_supplier_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_purchase_request_supplier(UUID, UUID, TEXT) TO authenticated;
