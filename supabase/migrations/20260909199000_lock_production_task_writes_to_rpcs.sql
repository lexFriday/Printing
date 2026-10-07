BEGIN;

-- Task transitions and assignment must pass through the validated SECURITY
-- DEFINER RPCs. Row-level UPDATE alone cannot protect individual columns or
-- enforce step ordering, readiness, and hold-reason rules.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.production_tasks FROM anon, authenticated;

DROP POLICY IF EXISTS production_tasks_update ON public.production_tasks;

GRANT SELECT ON public.production_tasks TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
