-- Phase 5: reusable BOMs remain immutable once selected for a Job Order.
-- Template maintenance creates a fresh version; it never edits components in place.

ALTER TABLE public.bom_templates
  ADD COLUMN IF NOT EXISTS creation_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bom_templates_creation_idempotency_key_unique
  ON public.bom_templates(creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_bom_template_version(
  p_name TEXT,
  p_components JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := trim(COALESCE(p_name, ''));
  v_template_id UUID;
  v_next_version INTEGER;
  v_component_count INTEGER;
BEGIN
  IF NOT (app_private.has_role(auth.uid(), 'admin') OR app_private.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'owner or admin BOM template management required';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'BOM template name is required';
  END IF;
  IF COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;
  IF jsonb_typeof(p_components) <> 'array' OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'a BOM template needs at least one material';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(lower(v_name)));

  SELECT id INTO v_template_id
  FROM public.bom_templates
  WHERE creation_idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_template_id;
  END IF;

  SELECT count(*) INTO v_component_count
  FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC);
  IF v_component_count <> jsonb_array_length(p_components) THEN
    RAISE EXCEPTION 'each BOM component needs a material and quantity';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC)
    WHERE material_id IS NULL OR quantity IS NULL OR quantity <= 0
  ) THEN
    RAISE EXCEPTION 'BOM component quantities must be positive';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC)
    GROUP BY material_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate material is not allowed in a BOM template';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC)
    LEFT JOIN public.materials material ON material.id = component.material_id
    WHERE material.id IS NULL OR material.is_active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'BOM components must use active materials';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
  FROM public.bom_templates
  WHERE lower(name) = lower(v_name);

  -- Historical versions remain readable for released Job Orders, but only one
  -- version per logical template is offered for new production plans.
  UPDATE public.bom_templates SET is_active = false
  WHERE lower(name) = lower(v_name) AND is_active = true;

  INSERT INTO public.bom_templates(name, version, is_active, creation_idempotency_key)
  VALUES (v_name, v_next_version, true, p_idempotency_key)
  RETURNING id INTO v_template_id;

  INSERT INTO public.bom_template_components(bom_template_id, material_id, quantity)
  SELECT v_template_id, component.material_id, component.quantity
  FROM jsonb_to_recordset(p_components) AS component(material_id UUID, quantity NUMERIC);

  RETURN v_template_id;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.bom_templates, public.bom_template_components FROM authenticated;
DROP POLICY IF EXISTS bom_admin_write ON public.bom_templates;
DROP POLICY IF EXISTS bom_component_admin_write ON public.bom_template_components;

GRANT EXECUTE ON FUNCTION public.save_bom_template_version(TEXT, JSONB, TEXT) TO authenticated;
