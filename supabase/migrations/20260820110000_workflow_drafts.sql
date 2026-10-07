CREATE TABLE IF NOT EXISTS public.workflow_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  project_name TEXT,
  source_record_id UUID,
  committed_record_id UUID,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE public.workflow_drafts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS workflow_drafts_owner_workflow_updated_idx ON public.workflow_drafts(user_id, workflow, updated_at DESC);
DROP POLICY IF EXISTS "workflow drafts own select" ON public.workflow_drafts;
DROP POLICY IF EXISTS "workflow drafts own insert" ON public.workflow_drafts;
DROP POLICY IF EXISTS "workflow drafts own update" ON public.workflow_drafts;
DROP POLICY IF EXISTS "workflow drafts own delete" ON public.workflow_drafts;
CREATE POLICY "workflow drafts own select" ON public.workflow_drafts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "workflow drafts own insert" ON public.workflow_drafts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "workflow drafts own update" ON public.workflow_drafts FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "workflow drafts own delete" ON public.workflow_drafts FOR DELETE TO authenticated USING (user_id = auth.uid());
