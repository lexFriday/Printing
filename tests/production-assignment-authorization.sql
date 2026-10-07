\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE assignment_test_job AS
SELECT line.job_order_id AS id
FROM public.job_order_line_items line
JOIN public.production_tasks task ON task.job_order_line_item_id = line.id
JOIN public.job_orders job ON job.id = line.job_order_id
GROUP BY line.job_order_id, job.created_at
HAVING COUNT(DISTINCT line.id) > 1
ORDER BY job.created_at DESC LIMIT 1;
CREATE TEMP TABLE assignment_test_line AS
SELECT line.id FROM public.job_order_line_items line
WHERE line.job_order_id=(SELECT id FROM assignment_test_job)
  AND EXISTS (SELECT 1 FROM public.production_tasks task WHERE task.job_order_line_item_id=line.id)
ORDER BY line.sort_order, line.created_at LIMIT 1;
CREATE TEMP TABLE assignment_test_other_line AS
SELECT line.id FROM public.job_order_line_items line
WHERE line.job_order_id=(SELECT id FROM assignment_test_job)
  AND line.id<>(SELECT id FROM assignment_test_line)
  AND EXISTS (SELECT 1 FROM public.production_tasks task WHERE task.job_order_line_item_id=line.id)
ORDER BY line.sort_order, line.created_at LIMIT 1;
CREATE TEMP TABLE assignment_test_task AS
SELECT id FROM public.production_tasks
WHERE job_order_line_item_id=(SELECT id FROM assignment_test_line)
ORDER BY task_order LIMIT 1;

INSERT INTO auth.users(id,email,aud,role,created_at,updated_at) VALUES
  ('11111111-1111-4111-8111-111111111111','worker-one@local.test','authenticated','authenticated',now(),now()),
  ('22222222-2222-4222-8222-222222222222','worker-two@local.test','authenticated','authenticated',now(),now()),
  ('33333333-3333-4333-8333-333333333333','production-admin@local.test','authenticated','authenticated',now(),now());
UPDATE public.profiles SET status='active' WHERE id IN (
  '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
);
INSERT INTO public.user_roles(user_id,role) VALUES
  ('11111111-1111-4111-8111-111111111111','production'),
  ('22222222-2222-4222-8222-222222222222','production'),
  ('33333333-3333-4333-8333-333333333333','admin');

SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SELECT public.set_production_item_assignments(
  (SELECT id FROM assignment_test_line),
  ARRAY['11111111-1111-4111-8111-111111111111'::UUID],
  ARRAY[]::UUID[]
);
-- A retried or duplicate request is idempotent.
SELECT public.set_production_item_assignments(
  (SELECT id FROM assignment_test_line),
  ARRAY['11111111-1111-4111-8111-111111111111'::UUID, '11111111-1111-4111-8111-111111111111'::UUID],
  ARRAY['11111111-1111-4111-8111-111111111111'::UUID]
);
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.production_item_assignments WHERE job_order_line_item_id=(SELECT id FROM assignment_test_line) AND removed_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Duplicate active assignment was created';
  END IF;
END; $$;

SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.production_workspace_queue()) <> 1 THEN
    RAISE EXCEPTION 'Assigned worker queue mismatch';
  END IF;
  IF public.get_production_job((SELECT id FROM assignment_test_job)) IS NULL THEN
    RAISE EXCEPTION 'Assigned worker cannot read assigned production record';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_job_document((SELECT id FROM assignment_test_job))) THEN
    RAISE EXCEPTION 'Assigned worker cannot read assigned production document';
  END IF;
  IF (SELECT COUNT(*) FROM public.production_job_line_items((SELECT id FROM assignment_test_job))) <> 1 THEN
    RAISE EXCEPTION 'Assigned worker received unassigned line items';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ensure_production_tasks((SELECT id FROM assignment_test_job)) task
    WHERE task.job_order_line_item_id <> (SELECT id FROM assignment_test_line)
  ) THEN
    RAISE EXCEPTION 'Assigned worker received unassigned production tasks';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.production_item_readiness((SELECT id FROM assignment_test_job)) readiness
    WHERE readiness.job_order_line_item_id <> (SELECT id FROM assignment_test_line)
  ) THEN
    RAISE EXCEPTION 'Assigned worker received unassigned item readiness';
  END IF;
END;
$$;
-- The assigned worker can read the scoped usage ledger, but cannot post an
-- arbitrary material that is not part of an assigned BOM item.
SELECT COUNT(*) FROM public.production_material_activity((SELECT id FROM assignment_test_job));
DO $$
BEGIN
  PERFORM public.record_production_material_activity(
    gen_random_uuid(),
    (SELECT id FROM assignment_test_job),
    'consumption',
    1,
    gen_random_uuid()::TEXT
  );
  RAISE EXCEPTION 'Assigned worker posted an unrelated material';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE 'Production workers can only record materials for assigned items%' THEN RAISE; END IF;
END;
$$;
SELECT public.update_production_task((SELECT id FROM assignment_test_task), 'on_hold', 'Authorization contract test');

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.production_workspace_queue()) <> 0 THEN
    RAISE EXCEPTION 'Unassigned worker received another worker''s Job Order';
  END IF;
  IF public.get_production_job((SELECT id FROM assignment_test_job)) IS NOT NULL THEN
    RAISE EXCEPTION 'Unassigned worker read production record directly';
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_job_document((SELECT id FROM assignment_test_job))) THEN
    RAISE EXCEPTION 'Unassigned worker read production document directly';
  END IF;
END;
$$;
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.production_material_activity((SELECT id FROM assignment_test_job))) <> 0 THEN
    RAISE EXCEPTION 'Unassigned worker read production material activity';
  END IF;
END; $$;
DO $$
BEGIN
  PERFORM public.update_production_task((SELECT id FROM assignment_test_task), 'not_started', NULL);
  RAISE EXCEPTION 'Unassigned worker task update unexpectedly succeeded';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE 'Production workers can only update assigned items%' THEN RAISE; END IF;
END;
$$;
DO $$
BEGIN
  PERFORM public.set_production_item_assignments(
    (SELECT id FROM assignment_test_line),
    ARRAY['22222222-2222-4222-8222-222222222222'::UUID],
    ARRAY[]::UUID[]
  );
  RAISE EXCEPTION 'Worker assignment RPC unexpectedly succeeded';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE 'Only Owner or Admin%' THEN RAISE; END IF;
END;
$$;

-- A stale manager cannot overwrite a newer assignment set.
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
DO $$
BEGIN
  PERFORM public.set_production_item_assignments(
    (SELECT id FROM assignment_test_line),
    ARRAY['22222222-2222-4222-8222-222222222222'::UUID],
    ARRAY[]::UUID[]
  );
  RAISE EXCEPTION 'Stale assignment update unexpectedly succeeded';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE 'Assignments changed since you opened this item%' THEN RAISE; END IF;
END;
$$;

-- A second assigned worker receives the same project.
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SELECT public.set_production_item_assignments(
  (SELECT id FROM assignment_test_line),
  ARRAY['11111111-1111-4111-8111-111111111111'::UUID, '22222222-2222-4222-8222-222222222222'::UUID],
  ARRAY['11111111-1111-4111-8111-111111111111'::UUID]
);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.production_workspace_queue()) <> 1 THEN
    RAISE EXCEPTION 'Second assigned worker queue mismatch';
  END IF;
END; $$;

-- Reassignment removes access but retains the historical assignment row.
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SELECT public.set_production_item_assignments(
  (SELECT id FROM assignment_test_line),
  ARRAY['22222222-2222-4222-8222-222222222222'::UUID],
  ARRAY['11111111-1111-4111-8111-111111111111'::UUID, '22222222-2222-4222-8222-222222222222'::UUID]
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.production_item_assignments WHERE job_order_line_item_id=(SELECT id FROM assignment_test_line) AND user_id='11111111-1111-4111-8111-111111111111' AND removed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Removed assignment history was not retained';
  END IF;
END; $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
  IF public.can_access_production_item(auth.uid(), (SELECT id FROM assignment_test_line)) THEN
    RAISE EXCEPTION 'Removed worker retained access';
  END IF;
END; $$;

-- Deactivation immediately removes effective access.
UPDATE public.profiles SET status='inactive' WHERE id='22222222-2222-4222-8222-222222222222';
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN
  IF public.can_access_production_job(auth.uid(), (SELECT id FROM assignment_test_job)) THEN
    RAISE EXCEPTION 'Inactive worker retained access';
  END IF;
END; $$;

-- Changing the assigned account away from Production also removes access.
UPDATE public.profiles SET status='active' WHERE id='22222222-2222-4222-8222-222222222222';
UPDATE public.user_roles SET role='viewer' WHERE user_id='22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  IF public.can_access_production_job(auth.uid(), (SELECT id FROM assignment_test_job)) THEN
    RAISE EXCEPTION 'Non-Production user retained assignment access';
  END IF;
END; $$;

ROLLBACK;
