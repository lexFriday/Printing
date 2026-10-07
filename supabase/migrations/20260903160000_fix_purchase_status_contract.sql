-- purchase_requests.status is text in the canonical schema; do not cast to a missing enum.
CREATE OR REPLACE FUNCTION public.receive_purchase_request(
  p_request_id UUID, p_quantity NUMERIC, p_idempotency_key TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.purchase_requests%ROWTYPE; v_id UUID; v_existing public.inventory_movements%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR COALESCE(trim(p_idempotency_key),'') = '' THEN RAISE EXCEPTION 'quantity and idempotency key are required'; END IF;
  SELECT * INTO r FROM public.purchase_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status = 'cancelled' THEN RAISE EXCEPTION 'purchase request unavailable'; END IF;
  SELECT * INTO v_existing FROM public.inventory_movements WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN v_existing.id; END IF;
  IF p_quantity > r.requested_quantity-r.received_quantity THEN RAISE EXCEPTION 'receipt exceeds remaining quantity'; END IF;
  v_id := public.record_inventory_movement(r.material_id,r.job_order_id,'receipt',p_quantity,p_idempotency_key);
  INSERT INTO public.material_receipts(purchase_request_id,quantity,received_by,reference_key) VALUES(p_request_id,p_quantity,auth.uid(),p_idempotency_key) ON CONFLICT (reference_key) DO NOTHING;
  UPDATE public.purchase_requests SET received_quantity=received_quantity+p_quantity,status=CASE WHEN received_quantity+p_quantity>=requested_quantity THEN 'received' ELSE 'partially_received' END,updated_at=now() WHERE id=p_request_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.receive_purchase_request(UUID,NUMERIC,TEXT) TO authenticated;
