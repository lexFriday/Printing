\set ON_ERROR_STOP on

BEGIN;

-- Make one assigned fixture deterministically short without leaving test data.
UPDATE public.job_bom_items
SET planned_quantity = planned_quantity + 100
WHERE job_order_line_item_id = '4995146c-9130-4a69-b9a1-812aee49540d'
  AND material_id = 'f7b6e7e3-a39e-4a60-ac41-cf7778108946';

INSERT INTO public.inventory_movements(material_id, movement_type, quantity, idempotency_key, notes)
VALUES ('f7b6e7e3-a39e-4a60-ac41-cf7778108946', 'receipt', 1, 'production-reservation-stock-test', 'Rollback-only authorization fixture');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a3c862a9-e913-400c-ac47-37074d76e7ef', true);

DO $$
DECLARE
  v_first RECORD;
  v_retry RECORD;
  v_count INTEGER;
BEGIN
  IF public.reserve_production_item_inventory(
    'daf3f8f5-377a-4280-a0b3-ef382ea4d59c',
    '4995146c-9130-4a69-b9a1-812aee49540d',
    'f7b6e7e3-a39e-4a60-ac41-cf7778108946',
    1,
    'production-item-reservation-test'
  ) IS NULL THEN
    RAISE EXCEPTION 'assigned Production did not reserve its item material';
  END IF;

  SELECT * INTO v_first
  FROM public.request_missing_production_materials(
    'daf3f8f5-377a-4280-a0b3-ef382ea4d59c',
    ARRAY['f7b6e7e3-a39e-4a60-ac41-cf7778108946']::UUID[],
    'production-request-authorization-test'
  );
  IF v_first.purchase_request_id IS NULL OR v_first.requested_quantity <= 0 THEN
    RAISE EXCEPTION 'assigned Production did not create a server-derived request';
  END IF;

  SELECT * INTO v_retry
  FROM public.request_missing_production_materials(
    'daf3f8f5-377a-4280-a0b3-ef382ea4d59c',
    ARRAY['f7b6e7e3-a39e-4a60-ac41-cf7778108946']::UUID[],
    'production-request-authorization-test'
  );
  IF v_retry.purchase_request_id IS DISTINCT FROM v_first.purchase_request_id THEN
    RAISE EXCEPTION 'retry created a different purchase request';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.purchase_requests
  WHERE job_order_id = 'daf3f8f5-377a-4280-a0b3-ef382ea4d59c'
    AND material_id = 'f7b6e7e3-a39e-4a60-ac41-cf7778108946'
    AND status IN ('requested', 'ordered', 'partially_received');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'retry must leave exactly one active request, found %', v_count;
  END IF;
END $$;

RESET ROLE;
UPDATE public.production_item_assignments
SET removed_at = now(), removed_by = assigned_by
WHERE user_id = 'a3c862a9-e913-400c-ac47-37074d76e7ef'
  AND job_order_line_item_id = '4995146c-9130-4a69-b9a1-812aee49540d'
  AND removed_at IS NULL;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a3c862a9-e913-400c-ac47-37074d76e7ef', true);
DO $$
BEGIN
  PERFORM public.reserve_production_item_inventory(
    'daf3f8f5-377a-4280-a0b3-ef382ea4d59c',
    '4995146c-9130-4a69-b9a1-812aee49540d',
    'f7b6e7e3-a39e-4a60-ac41-cf7778108946',
    1,
    'unassigned-reservation-test'
  );
  RAISE EXCEPTION 'unassigned Production reservation unexpectedly succeeded';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM public.request_missing_production_materials(
    'daf3f8f5-377a-4280-a0b3-ef382ea4d59c',
    ARRAY['f7b6e7e3-a39e-4a60-ac41-cf7778108946']::UUID[],
    'unassigned-production-test'
  );
  RAISE EXCEPTION 'unassigned Production request unexpectedly succeeded';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END $$;

SELECT set_config('request.jwt.claim.sub', '60a812d3-be05-4673-a63d-d2590928234c', true);
DO $$
BEGIN
  PERFORM public.request_missing_production_materials(
    'daf3f8f5-377a-4280-a0b3-ef382ea4d59c',
    ARRAY['f7b6e7e3-a39e-4a60-ac41-cf7778108946']::UUID[],
    'sales-request-test'
  );
  RAISE EXCEPTION 'Sales request unexpectedly succeeded';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END $$;

SELECT set_config('request.jwt.claim.sub', 'f8a5bba6-72b9-4dfe-b4e8-14c71ee4ac97', true);
DO $$
DECLARE v_request_id UUID;
BEGIN
  SELECT purchase_request_id INTO v_request_id
  FROM public.request_missing_production_materials(
    'daf3f8f5-377a-4280-a0b3-ef382ea4d59c',
    ARRAY['f7b6e7e3-a39e-4a60-ac41-cf7778108946']::UUID[],
    'admin-request-test'
  );
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Admin request did not return the active request';
  END IF;
END $$;

ROLLBACK;

SELECT 'production material request authorization: passed' AS result;
