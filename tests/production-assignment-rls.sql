\set ON_ERROR_STOP on
BEGIN;
SELECT line.job_order_id AS job_id
FROM public.job_order_line_items line
JOIN public.job_orders job ON job.id=line.job_order_id
JOIN public.production_jobs production ON production.job_order_id=job.id
ORDER BY job.created_at DESC LIMIT 1 \gset
SELECT id AS line_id FROM public.job_order_line_items WHERE job_order_id=:'job_id' ORDER BY sort_order, created_at LIMIT 1 \gset

INSERT INTO auth.users(id,email,aud,role,created_at,updated_at) VALUES
  ('11111111-1111-4111-8111-111111111111','assigned-rls@local.test','authenticated','authenticated',now(),now()),
  ('22222222-2222-4222-8222-222222222222','unassigned-rls@local.test','authenticated','authenticated',now(),now());
UPDATE public.profiles SET status='active' WHERE id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
INSERT INTO public.user_roles(user_id,role) VALUES
  ('11111111-1111-4111-8111-111111111111','production'),
  ('22222222-2222-4222-8222-222222222222','production');
INSERT INTO public.production_item_assignments(job_order_line_item_id,user_id,assigned_by)
VALUES (:'line_id','11111111-1111-4111-8111-111111111111','f8a5bba6-72b9-4dfe-b4e8-14c71ee4ac97');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT 1 / (SELECT COUNT(*) FROM public.production_jobs WHERE job_order_id=:'job_id') AS assigned_visible;
SELECT 1 / (1 - (SELECT COUNT(*) FROM public.job_orders WHERE id=:'job_id')) AS commercial_hidden;
SELECT 1 / (1 - CASE WHEN has_table_privilege('authenticated', 'public.production_tasks', 'UPDATE') THEN 1 ELSE 0 END)
  AS direct_task_update_denied;

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SELECT 1 / (1 - (SELECT COUNT(*) FROM public.production_jobs WHERE job_order_id=:'job_id')) AS unassigned_hidden;

RESET ROLE;
ROLLBACK;
