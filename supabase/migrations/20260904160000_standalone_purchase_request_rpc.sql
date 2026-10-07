CREATE OR REPLACE FUNCTION public.create_standalone_purchase_request(
  p_material_id UUID,
  p_quantity NUMERIC,
  p_supplier_id UUID
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be greater than zero'; END IF;
  IF p_supplier_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND active = true) THEN RAISE EXCEPTION 'supplier required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = p_material_id AND is_active = true) THEN RAISE EXCEPTION 'material unavailable'; END IF;
  INSERT INTO public.purchase_requests(material_id, requested_quantity, status, supplier_id, created_by)
  VALUES (p_material_id, p_quantity, 'requested', p_supplier_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_standalone_purchase_request(UUID, NUMERIC, UUID) TO authenticated;
