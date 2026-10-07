BEGIN;

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS prepared_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS prepared_by_signature_url_snapshot text,
  ADD COLUMN IF NOT EXISTS approved_by_signature_url_snapshot text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-signatures', 'user-signatures', false, 524288, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=524288, allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "user signatures read" ON storage.objects;
CREATE POLICY "user signatures read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='user-signatures' AND app_private.is_active_user(auth.uid()));
DROP POLICY IF EXISTS "user signatures upload" ON storage.objects;
CREATE POLICY "user signatures upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='user-signatures' AND app_private.is_active_user(auth.uid()) AND
  ((storage.foldername(name))[1]=auth.uid()::text OR app_private.can_manage_users(auth.uid())));

CREATE OR REPLACE FUNCTION public.set_user_signature(p_target_user_id uuid, p_object_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE v_old text;
BEGIN
  IF NOT app_private.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Active account required'; END IF;
  IF p_target_user_id<>auth.uid() AND NOT app_private.can_manage_users(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_object_path IS NOT NULL THEN
    IF split_part(p_object_path,'/',1)<>p_target_user_id::text OR NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE bucket_id='user-signatures' AND name=p_object_path
    ) THEN RAISE EXCEPTION 'Invalid signature object'; END IF;
  END IF;
  SELECT signature_url INTO v_old FROM public.profiles WHERE id=p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  UPDATE public.profiles SET signature_url=p_object_path WHERE id=p_target_user_id;
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,new_values,old_values)
  VALUES(auth.uid(),CASE WHEN p_object_path IS NULL THEN 'user.signature_removed' ELSE 'user.signature_uploaded' END,
    'user',p_target_user_id,jsonb_build_object('has_signature',p_object_path IS NOT NULL),jsonb_build_object('has_signature',v_old IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.set_user_signature(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_signature(uuid,text) TO authenticated;

DROP TRIGGER IF EXISTS profiles_fill_empty_document_signatures ON public.profiles;
DROP FUNCTION IF EXISTS public.fill_empty_document_signatures_from_profile();
DROP TRIGGER IF EXISTS job_expenses_snapshot_signature ON public.job_expenses;
DROP FUNCTION IF EXISTS public.snapshot_expense_signature();

CREATE OR REPLACE FUNCTION public.snapshot_quotation_sales_agent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_name text; v_signature text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status::text<>'draft' AND (
    NEW.sales_agent_user_id IS DISTINCT FROM OLD.sales_agent_user_id OR
    NEW.sales_agent_signature_url_snapshot IS DISTINCT FROM OLD.sales_agent_signature_url_snapshot
  ) THEN RAISE EXCEPTION 'Finalized quotation signer and signature are immutable'; END IF;
  IF NEW.sales_agent_user_id IS NULL THEN
    IF NEW.status::text<>'draft' THEN RAISE EXCEPTION 'Select a Sales Agent before submitting the quotation'; END IF;
    RETURN NEW;
  END IF;
  SELECT display_name,signature_url INTO v_name,v_signature FROM public.profiles
  WHERE id=NEW.sales_agent_user_id AND status::text='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected Sales Agent is not active'; END IF;
  NEW.sales_agent:=v_name;
  IF TG_OP='INSERT' OR NEW.status::text='draft' THEN NEW.sales_agent_signature_url_snapshot:=NULL; END IF;
  IF NEW.status::text<>'draft' AND (TG_OP='INSERT' OR OLD.status::text='draft') THEN
    IF v_signature IS NULL THEN RAISE EXCEPTION 'Selected Sales Agent must upload a signature before submission'; END IF;
    NEW.sales_agent_signature_url_snapshot:=v_signature;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_snapshot_quotation_sales_agent ON public.quotations;
CREATE TRIGGER trg_snapshot_quotation_sales_agent BEFORE INSERT OR UPDATE OF sales_agent_user_id,status
ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.snapshot_quotation_sales_agent();

CREATE OR REPLACE FUNCTION public.snapshot_job_order_signatures()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    IF NEW.prepared_by_user_id IS DISTINCT FROM OLD.prepared_by_user_id OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id
      THEN RAISE EXCEPTION 'Job Order signer identity is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.prepared_by_user_id IS NULL OR NEW.approved_by_user_id IS NULL THEN RAISE EXCEPTION 'Job Order signers are required'; END IF;
  SELECT display_name,signature_url INTO NEW.prepared_by_name_snapshot,NEW.prepared_by_signature_url_snapshot
  FROM public.profiles WHERE id=NEW.prepared_by_user_id AND status::text='active';
  SELECT display_name,signature_url INTO NEW.approved_by_name,NEW.approved_by_signature_url_snapshot
  FROM public.profiles WHERE id=NEW.approved_by_user_id AND status::text='active';
  IF NEW.prepared_by_signature_url_snapshot IS NULL OR NEW.approved_by_signature_url_snapshot IS NULL
    THEN RAISE EXCEPTION 'Both Job Order signers must upload signatures first'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS job_orders_snapshot_signatures ON public.job_orders;
CREATE TRIGGER job_orders_snapshot_signatures BEFORE INSERT OR UPDATE OF prepared_by_user_id,approved_by_user_id
ON public.job_orders FOR EACH ROW EXECUTE FUNCTION public.snapshot_job_order_signatures();

NOTIFY pgrst,'reload schema';
COMMIT;
