-- NJL production workflow. The Job Order owns the frozen BOM; production_jobs
-- stores execution status only. Inventory remains the movement-ledger SSOT.
DO $$ BEGIN
  CREATE TYPE public.production_status AS ENUM ('not_started','preparing','partially_reserved','ready_to_start','in_progress','for_reconciliation','awaiting_approval','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- BOM snapshots are created before production can start. Keep the template
-- reference optional because quotation snapshots are also valid BOM sources.
CREATE TABLE IF NOT EXISTS public.job_boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL UNIQUE REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  bom_template_id UUID REFERENCES public.bom_templates(id) ON DELETE RESTRICT,
  template_version INTEGER NOT NULL DEFAULT 1,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.job_boms ALTER COLUMN bom_template_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS public.job_bom_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_bom_id UUID NOT NULL REFERENCES public.job_boms(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  planned_quantity NUMERIC NOT NULL CHECK (planned_quantity > 0),
  unit TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_bom_id, material_id)
);
ALTER TABLE public.job_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_bom_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.job_boms, public.job_bom_items TO authenticated;
DROP POLICY IF EXISTS job_boms_read ON public.job_boms;
DROP POLICY IF EXISTS job_bom_items_read ON public.job_bom_items;
CREATE POLICY job_boms_read ON public.job_boms FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY job_bom_items_read ON public.job_bom_items FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

CREATE TABLE IF NOT EXISTS public.production_jobs (
  job_order_id UUID PRIMARY KEY REFERENCES public.job_orders(id) ON DELETE RESTRICT,
  status public.production_status NOT NULL DEFAULT 'not_started',
  job_type TEXT NOT NULL DEFAULT 'general',
  responsible_user_id UUID REFERENCES auth.users(id),
  notes TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.production_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.production_jobs TO authenticated;
GRANT ALL ON public.production_jobs TO service_role;
DROP POLICY IF EXISTS production_jobs_read ON public.production_jobs;
DROP POLICY IF EXISTS production_jobs_write ON public.production_jobs;
DROP POLICY IF EXISTS production_jobs_update ON public.production_jobs;
CREATE POLICY production_jobs_read ON public.production_jobs FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY production_jobs_write ON public.production_jobs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY production_jobs_update ON public.production_jobs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff'));

CREATE OR REPLACE FUNCTION public.create_production_plan(p_job_order_id UUID, p_job_type TEXT, p_responsible_user_id UUID DEFAULT NULL)
RETURNS public.production_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE v_job public.job_orders%ROWTYPE; v_result public.production_jobs%ROWTYPE; BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO v_job FROM public.job_orders WHERE id=p_job_order_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF v_job.status::text IN ('cancelled','completed') THEN RAISE EXCEPTION 'job cannot enter production'; END IF;
  INSERT INTO public.production_jobs(job_order_id,job_type,responsible_user_id,status) VALUES(p_job_order_id,COALESCE(NULLIF(trim(p_job_type),''),'general'),p_responsible_user_id,'preparing') ON CONFLICT (job_order_id) DO UPDATE SET job_type=EXCLUDED.job_type,responsible_user_id=COALESCE(EXCLUDED.responsible_user_id,production_jobs.responsible_user_id),updated_at=now() RETURNING * INTO v_result; RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_production_plan(UUID,TEXT,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_production(p_job_order_id UUID, p_template_id UUID, p_idempotency_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE v_bom UUID; v_version INTEGER; v_job public.job_orders%ROWTYPE; v_existing_template UUID; BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin release required'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key='' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  SELECT * INTO v_job FROM public.job_orders WHERE id=p_job_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job order not found'; END IF;
  IF v_job.status::text <> 'open' THEN RAISE EXCEPTION 'only open job orders can be released'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotations WHERE id=v_job.quotation_id AND status='approved') THEN RAISE EXCEPTION 'job order quotation must be approved'; END IF;
  SELECT version INTO v_version FROM public.bom_templates WHERE id=p_template_id AND active=true; IF NOT FOUND THEN RAISE EXCEPTION 'active BOM template not found'; END IF;
  SELECT bom_template_id INTO v_existing_template FROM public.job_boms WHERE job_order_id=p_job_order_id;
  IF v_existing_template IS NOT NULL AND v_existing_template <> p_template_id THEN RAISE EXCEPTION 'released BOM cannot be replaced'; END IF;
  INSERT INTO public.job_boms(job_order_id,bom_template_id,template_version,released_at,released_by) VALUES(p_job_order_id,p_template_id,v_version,now(),auth.uid()) ON CONFLICT (job_order_id) DO UPDATE SET id=job_boms.id RETURNING id INTO v_bom;
  INSERT INTO public.job_bom_items(job_bom_id,material_id,planned_quantity,unit) SELECT v_bom,c.material_id,c.quantity,m.unit FROM public.bom_template_components c JOIN public.materials m ON m.id=c.material_id WHERE c.bom_template_id=p_template_id ON CONFLICT DO NOTHING;
  INSERT INTO public.production_jobs(job_order_id,job_type,status) SELECT p_job_order_id,COALESCE(j.job_type,'general'),'partially_reserved' FROM public.job_orders j WHERE j.id=p_job_order_id ON CONFLICT (job_order_id) DO UPDATE SET status=CASE WHEN production_jobs.status='not_started' THEN 'partially_reserved' ELSE production_jobs.status END,updated_at=now();
  UPDATE public.production_jobs SET status='partially_reserved',updated_at=now() WHERE job_order_id=p_job_order_id AND status='not_started'; RETURN v_bom;
END; $$;
GRANT EXECUTE ON FUNCTION public.release_production(UUID,UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_production_job(p_job_order_id UUID)
RETURNS public.production_jobs LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p FROM public.production_jobs p WHERE p.job_order_id = p_job_order_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_production_job(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.receive_purchase_request(p_request_id UUID, p_quantity NUMERIC, p_idempotency_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE r public.purchase_requests%ROWTYPE; v_id UUID; BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
  SELECT * INTO r FROM public.purchase_requests WHERE id=p_request_id FOR UPDATE; IF NOT FOUND OR r.status::text='cancelled' THEN RAISE EXCEPTION 'purchase request unavailable'; END IF;
  IF p_quantity > r.requested_quantity-r.received_quantity THEN RAISE EXCEPTION 'receipt exceeds remaining quantity'; END IF;
  v_id := public.record_inventory_movement(r.material_id,r.job_order_id,'receipt',p_quantity,p_idempotency_key);
  UPDATE public.purchase_requests SET received_quantity=received_quantity+p_quantity,status=(CASE WHEN received_quantity+p_quantity>=requested_quantity THEN 'received' ELSE 'partially_received' END)::purchase_request_status,updated_at=now() WHERE id=p_request_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.receive_purchase_request(UUID,NUMERIC,TEXT) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_requests_job_material_unique ON public.purchase_requests(job_order_id,material_id) WHERE job_order_id IS NOT NULL AND status <> 'cancelled';
CREATE OR REPLACE FUNCTION public.create_shortage_request(p_job_order_id UUID,p_material_id UUID,p_idempotency_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE planned NUMERIC; v_available NUMERIC; pack NUMERIC; requested NUMERIC; v_id UUID; BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key='' THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  SELECT COALESCE(SUM(i.planned_quantity),0) INTO planned FROM public.job_bom_items i JOIN public.job_boms b ON b.id=i.job_bom_id WHERE b.job_order_id=p_job_order_id AND i.material_id=p_material_id;
  SELECT b.available INTO v_available FROM public.inventory_balance(p_material_id) b; SELECT COALESCE(pack_size,1) INTO pack FROM public.materials WHERE id=p_material_id;
  requested := CEIL(GREATEST(0,planned-v_available)/pack)*pack; IF requested<=0 THEN RAISE EXCEPTION 'no shortage exists'; END IF;
  SELECT id INTO v_id FROM public.purchase_requests WHERE job_order_id=p_job_order_id AND material_id=p_material_id AND status::text <> 'cancelled' LIMIT 1 FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO public.purchase_requests(material_id,job_order_id,requested_quantity,received_quantity,status,requested_by) VALUES(p_material_id,p_job_order_id,requested,0,'requested',auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.purchase_requests SET requested_quantity=GREATEST(requested_quantity,requested),updated_at=now() WHERE id=v_id;
  END IF;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_shortage_request(UUID,UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_production(p_job_order_id UUID,p_decision TEXT,p_reason TEXT DEFAULT NULL)
RETURNS public.production_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE v_result public.production_jobs%ROWTYPE; v_planned NUMERIC; v_consumed NUMERIC; BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_decision NOT IN ('accept','request_approval') THEN RAISE EXCEPTION 'invalid reconciliation decision'; END IF;
  SELECT COALESCE(SUM(i.planned_quantity),0) INTO v_planned FROM public.job_bom_items i JOIN public.job_boms b ON b.id=i.job_bom_id WHERE b.job_order_id=p_job_order_id;
  SELECT COALESCE(SUM(CASE WHEN movement_type IN ('consumption','waste') THEN quantity WHEN movement_type='return' THEN -quantity ELSE 0 END),0) INTO v_consumed FROM public.inventory_movements WHERE job_order_id=p_job_order_id;
  IF v_consumed>v_planned AND p_decision<>'request_approval' AND NOT public.has_role(auth.uid(),'admin') AND NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'over-consumption requires owner approval'; END IF;
  UPDATE public.production_jobs SET status=(CASE WHEN p_decision='request_approval' OR v_consumed>v_planned THEN 'awaiting_approval' ELSE 'for_reconciliation' END)::production_status,notes=COALESCE(NULLIF(trim(p_reason),''),notes),updated_at=now() WHERE job_order_id=p_job_order_id RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'production plan not found'; END IF; RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.reconcile_production(UUID,TEXT,TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS public.production_material_exceptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE RESTRICT,
 material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), submitted_by UUID NOT NULL REFERENCES auth.users(id),
 decided_by UUID REFERENCES auth.users(id), decision_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
ALTER TABLE public.production_material_exceptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.production_material_exceptions TO authenticated;
DROP POLICY IF EXISTS production_exception_read ON public.production_material_exceptions;
DROP POLICY IF EXISTS production_exception_insert ON public.production_material_exceptions;
DROP POLICY IF EXISTS production_exception_update ON public.production_material_exceptions;
CREATE POLICY production_exception_read ON public.production_material_exceptions FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY production_exception_insert ON public.production_material_exceptions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY production_exception_update ON public.production_material_exceptions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));

CREATE OR REPLACE FUNCTION public.submit_material_exception(p_job_order_id UUID,p_material_id UUID,p_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE v_id UUID; BEGIN
 IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'reason is required'; END IF;
 INSERT INTO public.production_material_exceptions(job_order_id,material_id,reason,submitted_by) VALUES(p_job_order_id,p_material_id,trim(p_reason),auth.uid()) RETURNING id INTO v_id;
 UPDATE public.production_jobs SET status='awaiting_approval',updated_at=now() WHERE job_order_id=p_job_order_id; RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_material_exception(UUID,UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_material_exception(p_exception_id UUID,p_decision TEXT,p_reason TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE v_id UUID; v_job UUID; BEGIN
 IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin approval required'; END IF;
 IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
 SELECT job_order_id INTO v_job FROM public.production_material_exceptions WHERE id=p_exception_id AND status='pending' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'exception is unavailable'; END IF;
 UPDATE public.production_material_exceptions SET status=p_decision,decided_by=auth.uid(),decision_reason=NULLIF(trim(p_reason),''),decided_at=now() WHERE id=p_exception_id RETURNING id INTO v_id;
 IF p_decision='approved' AND NOT EXISTS (SELECT 1 FROM public.production_material_exceptions WHERE job_order_id=v_job AND status='pending') THEN UPDATE public.production_jobs SET status='for_reconciliation',updated_at=now() WHERE job_order_id=v_job; END IF;
 RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.approve_material_exception(UUID,TEXT,TEXT) TO authenticated;
