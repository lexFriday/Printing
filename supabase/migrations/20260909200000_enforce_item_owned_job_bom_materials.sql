BEGIN;

-- Job Order lines are created after the Job Order itself, so the legacy insert
-- trigger cannot know which item owns a material. Production now performs the
-- quote-to-BOM handoff explicitly after the line items exist.
DROP TRIGGER IF EXISTS trg_snapshot_job_order_materials ON public.job_orders;

-- Historical rows are safe to repair when the Job Order has exactly one item.
-- Multi-item rows remain unchanged because assigning them automatically would
-- invent ownership and could affect readiness or purchasing for the wrong item.
WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id, (ARRAY_AGG(line.id))[1] AS line_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
)
DELETE FROM public.job_bom_items AS legacy
USING single_item_boms AS owner
WHERE legacy.job_bom_id = owner.job_bom_id
  AND legacy.job_order_line_item_id IS NULL
  AND legacy.is_supplemental = FALSE
  AND EXISTS (
    SELECT 1
    FROM public.job_bom_items AS existing
    WHERE existing.job_bom_id = legacy.job_bom_id
      AND existing.job_order_line_item_id = owner.line_id
      AND existing.material_id = legacy.material_id
      AND existing.is_supplemental = FALSE
  );

WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
), ranked_legacy AS (
  SELECT material.id,
    ROW_NUMBER() OVER (
      PARTITION BY material.job_bom_id, material.material_id
      ORDER BY material.created_at, material.id
    ) AS occurrence,
    SUM(material.planned_quantity) OVER (
      PARTITION BY material.job_bom_id, material.material_id
    ) AS combined_quantity
  FROM public.job_bom_items AS material
  JOIN single_item_boms AS bom ON bom.job_bom_id = material.job_bom_id
  WHERE material.job_order_line_item_id IS NULL
    AND material.is_supplemental = FALSE
)
UPDATE public.job_bom_items AS material
SET planned_quantity = ranked.combined_quantity
FROM ranked_legacy AS ranked
WHERE material.id = ranked.id
  AND ranked.occurrence = 1;

WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
), ranked_legacy AS (
  SELECT material.id,
    ROW_NUMBER() OVER (
      PARTITION BY material.job_bom_id, material.material_id
      ORDER BY material.created_at, material.id
    ) AS occurrence
  FROM public.job_bom_items AS material
  JOIN single_item_boms AS bom ON bom.job_bom_id = material.job_bom_id
  WHERE material.job_order_line_item_id IS NULL
    AND material.is_supplemental = FALSE
)
DELETE FROM public.job_bom_items AS legacy
USING ranked_legacy AS ranked
WHERE legacy.id = ranked.id
  AND ranked.occurrence > 1;

WITH single_item_boms AS (
  SELECT bom.id AS job_bom_id, (ARRAY_AGG(line.id))[1] AS line_id
  FROM public.job_boms AS bom
  JOIN public.job_order_line_items AS line ON line.job_order_id = bom.job_order_id
  GROUP BY bom.id
  HAVING COUNT(line.id) = 1
)
UPDATE public.job_bom_items AS material
SET job_order_line_item_id = owner.line_id
FROM single_item_boms AS owner
WHERE material.job_bom_id = owner.job_bom_id
  AND material.job_order_line_item_id IS NULL;

-- NOT VALID preserves ambiguous historical rows while enforcing item ownership
-- for every new or subsequently updated BOM material row.
ALTER TABLE public.job_bom_items
  DROP CONSTRAINT IF EXISTS job_bom_items_require_line_owner;
ALTER TABLE public.job_bom_items
  ADD CONSTRAINT job_bom_items_require_line_owner
  CHECK (job_order_line_item_id IS NOT NULL) NOT VALID;

NOTIFY pgrst, 'reload schema';
COMMIT;
