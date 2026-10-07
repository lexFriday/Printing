CREATE OR REPLACE FUNCTION public.create_replenishment_request(p_material_id UUID, p_quantity NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be greater than zero'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id=p_material_id AND is_active=true) THEN RAISE EXCEPTION 'material unavailable'; END IF;
  SELECT id INTO v_id FROM public.purchase_requests WHERE material_id=p_material_id AND job_order_id IS NULL AND status IN ('requested','ordered','partially_received') LIMIT 1 FOR UPDATE;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.purchase_requests(material_id, requested_quantity, status, created_by) VALUES (p_material_id,p_quantity,'requested',auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
