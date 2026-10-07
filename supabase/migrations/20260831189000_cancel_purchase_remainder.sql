CREATE OR REPLACE FUNCTION public.cancel_purchase_request_remainder(p_request_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.purchase_requests%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'staff')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO v_request FROM public.purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase request unavailable';
  END IF;
  IF v_request.status::TEXT = 'cancelled' THEN
    RETURN v_request.id;
  END IF;
  IF v_request.received_quantity >= v_request.requested_quantity THEN
    RAISE EXCEPTION 'fully received requests cannot be cancelled';
  END IF;
  UPDATE public.purchase_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_request_id;
  RETURN p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_purchase_request_remainder(UUID) TO authenticated;
