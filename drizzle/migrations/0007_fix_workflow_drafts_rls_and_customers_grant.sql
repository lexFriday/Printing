-- Ensure workflow_drafts RLS policies and explicit grants on workflow_drafts
-- and customers are in place on the live database, and reload PostgREST schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_drafts TO authenticated;
GRANT ALL ON public.workflow_drafts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;

ALTER TABLE public.workflow_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow drafts own select" ON public.workflow_drafts;
DROP POLICY IF EXISTS "workflow drafts own insert" ON public.workflow_drafts;
DROP POLICY IF EXISTS "workflow drafts own update" ON public.workflow_drafts;
DROP POLICY IF EXISTS "workflow drafts own delete" ON public.workflow_drafts;

CREATE POLICY "workflow drafts own select"
ON public.workflow_drafts FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "workflow drafts own insert"
ON public.workflow_drafts FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "workflow drafts own update"
ON public.workflow_drafts FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "workflow drafts own delete"
ON public.workflow_drafts FOR DELETE TO authenticated
USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
