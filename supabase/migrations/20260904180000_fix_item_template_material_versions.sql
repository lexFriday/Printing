-- Material recipes are versioned. The original unique key omitted version,
-- which made saving a new BOM version fail when it reused a material/basis.
ALTER TABLE public.item_template_materials
  DROP CONSTRAINT IF EXISTS item_template_materials_item_template_id_material_id_basis_key;

CREATE UNIQUE INDEX IF NOT EXISTS item_template_materials_version_key
  ON public.item_template_materials(item_template_id, material_id, basis, version);
