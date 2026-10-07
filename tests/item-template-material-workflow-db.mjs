import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

const container = `njl-template-workflow-${process.pid}`;
const current = readFileSync(
  new URL("../supabase/migrations/20260903110000_item_template_material_versioning.sql", import.meta.url),
  "utf8",
);
const hardeningPath = new URL(
  "../supabase/migrations/20260910120000_harden_item_template_material_workflow.sql",
  import.meta.url,
);
const currentFunctions = current.slice(current.indexOf("CREATE OR REPLACE FUNCTION public.save_item_template_material_version("));
const hardening = existsSync(hardeningPath) ? readFileSync(hardeningPath, "utf8") : "";
const sql = String.raw`
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TYPE public.material_component_basis AS ENUM ('per_item','per_sqft','fixed_per_line');
CREATE TYPE public.pricing_mode AS ENUM ('sqft','fixed');
CREATE TYPE public.unit_of_measure AS ENUM ('inches','feet','millimeters','centimeters','meters');
CREATE TABLE public.item_templates(id uuid PRIMARY KEY, is_active boolean NOT NULL);
CREATE TABLE public.materials(id uuid PRIMARY KEY, name text NOT NULL, unit text NOT NULL, is_active boolean NOT NULL);
CREATE TABLE public.item_template_materials(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_template_id uuid NOT NULL REFERENCES public.item_templates,
  material_id uuid NOT NULL REFERENCES public.materials, quantity numeric NOT NULL CHECK(quantity>0),
  basis public.material_component_basis NOT NULL, version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX item_template_materials_version_key ON public.item_template_materials(item_template_id,material_id,basis,version);
CREATE TABLE public.quotations(id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.quote_line_items(
  id uuid PRIMARY KEY, quotation_id uuid NOT NULL REFERENCES public.quotations,
  item_template_id uuid REFERENCES public.item_templates, item_template_version integer DEFAULT 1,
  description text, pricing_mode public.pricing_mode, unit_of_measure public.unit_of_measure, width numeric, height numeric,
  rate_per_sqft numeric, quantity numeric NOT NULL, computed_sqft numeric, unit_price numeric,
  line_total numeric, no_charge boolean DEFAULT false, adjustment_label text, adjustment_amount numeric, sort_order integer
);
CREATE TABLE public.quote_attachments(id uuid PRIMARY KEY, quote_line_item_id uuid REFERENCES public.quote_line_items);
CREATE TABLE public.quote_material_estimates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES public.quotations,
  quote_line_item_id uuid NOT NULL REFERENCES public.quote_line_items, item_template_id uuid REFERENCES public.item_templates,
  item_template_version integer NOT NULL, material_id uuid NOT NULL REFERENCES public.materials,
  material_name text NOT NULL, unit text NOT NULL, basis public.material_component_basis NOT NULL,
  component_quantity numeric NOT NULL CHECK(component_quantity>0), estimated_quantity numeric NOT NULL CHECK(estimated_quantity>0)
);
CREATE TABLE public.job_orders(id uuid PRIMARY KEY, quotation_id uuid NOT NULL REFERENCES public.quotations);
CREATE TABLE public.job_order_line_items(
  id uuid PRIMARY KEY, job_order_id uuid NOT NULL REFERENCES public.job_orders,
  quote_line_item_id uuid NOT NULL REFERENCES public.quote_line_items
);
CREATE TABLE public.job_boms(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_order_id uuid NOT NULL UNIQUE REFERENCES public.job_orders,
  template_version integer, released_at timestamptz, released_by uuid
);
CREATE TABLE public.job_bom_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_bom_id uuid NOT NULL REFERENCES public.job_boms,
  job_order_line_item_id uuid REFERENCES public.job_order_line_items, material_id uuid NOT NULL REFERENCES public.materials,
  planned_quantity numeric NOT NULL, unit text NOT NULL,
  UNIQUE(job_bom_id,job_order_line_item_id,material_id)
);
CREATE TABLE public.production_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_order_id uuid NOT NULL UNIQUE REFERENCES public.job_orders,
  job_type text NOT NULL, status text NOT NULL, updated_at timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.role',true) IN ('owner','admin') $$;
${currentFunctions}
${hardening}
CREATE OR REPLACE FUNCTION public.release_production_from_quote(p_job_order_id uuid, p_idempotency_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $release$
DECLARE v_bom uuid; v_quote uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'owner or admin release required'; END IF;
  SELECT quotation_id INTO v_quote FROM public.job_orders WHERE id=p_job_order_id FOR UPDATE;
  IF v_quote IS NULL OR NOT EXISTS (SELECT 1 FROM public.quotations WHERE id=v_quote AND status='approved') THEN RAISE EXCEPTION 'approved quote required'; END IF;
  INSERT INTO public.job_boms(job_order_id,template_version,released_at,released_by)
  VALUES(p_job_order_id,1,now(),auth.uid()) ON CONFLICT(job_order_id) DO UPDATE SET job_order_id=EXCLUDED.job_order_id RETURNING id INTO v_bom;
  INSERT INTO public.job_bom_items(job_bom_id,job_order_line_item_id,material_id,planned_quantity,unit)
  SELECT v_bom,jol.id,qme.material_id,qme.estimated_quantity,qme.unit
  FROM public.quote_material_estimates qme
  JOIN public.job_order_line_items jol ON jol.job_order_id=p_job_order_id AND jol.quote_line_item_id=qme.quote_line_item_id
  WHERE qme.quotation_id=v_quote ON CONFLICT DO NOTHING;
  RETURN v_bom;
END $release$;

INSERT INTO public.item_templates VALUES ('00000000-0000-0000-0000-000000000010',true),('00000000-0000-0000-0000-000000000011',false);
INSERT INTO public.materials VALUES
 ('00000000-0000-0000-0000-000000000020','Plywood','sheet',true),
 ('00000000-0000-0000-0000-000000000021','Inactive paint','gal',false);
SELECT set_config('test.role','owner',false);

DO $$
DECLARE
  template_id uuid := '00000000-0000-0000-0000-000000000010';
  material_id uuid := '00000000-0000-0000-0000-000000000020';
  components jsonb := '[{"material_id":"00000000-0000-0000-0000-000000000020","quantity":2,"basis":"per_item"}]';
  first_version integer;
BEGIN
  first_version := public.save_item_template_material_version(template_id,components,'same-request');
  IF public.save_item_template_material_version(template_id,components,'same-request') <> first_version THEN
    RAISE EXCEPTION 'same idempotency key did not return the original version';
  END IF;
  IF (SELECT count(DISTINCT version) FROM public.item_template_materials WHERE item_template_id=template_id) <> 1 THEN
    RAISE EXCEPTION 'retry created another recipe version';
  END IF;
  IF (SELECT count(DISTINCT version) FROM public.item_template_materials WHERE item_template_id=template_id AND active) <> 1 THEN
    RAISE EXCEPTION 'recipe has more than one active version';
  END IF;

  BEGIN
    PERFORM public.save_item_template_material_version(template_id,'[{"material_id":"00000000-0000-0000-0000-000000000021","quantity":1,"basis":"per_item"}]','inactive-material');
    RAISE EXCEPTION 'inactive material was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.save_item_template_material_version(template_id,components || components,'duplicates');
    RAISE EXCEPTION 'duplicate component was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.save_item_template_material_version(template_id,'[{"material_id":"00000000-0000-0000-0000-000000000020","quantity":"NaN","basis":"per_item"}]','nan-quantity');
    RAISE EXCEPTION 'NaN quantity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.save_item_template_material_version(template_id,'[{"material_id":"00000000-0000-0000-0000-000000000020","quantity":1}]','missing-basis');
    RAISE EXCEPTION 'missing basis was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM set_config('test.role','staff',true);
  BEGIN
    PERFORM public.save_item_template_material_version(template_id,components,'staff-save');
    RAISE EXCEPTION 'unauthorized save was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('test.role','owner',true);

  INSERT INTO public.quotations VALUES ('00000000-0000-0000-0000-000000000030','draft');
  INSERT INTO public.quote_line_items(id,quotation_id,item_template_id,item_template_version,quantity,computed_sqft)
  VALUES ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000030',template_id,1,3,12);
  PERFORM public.snapshot_quote_materials('00000000-0000-0000-0000-000000000030');
  IF NOT EXISTS (SELECT 1 FROM public.quote_material_estimates WHERE item_template_version=first_version AND component_quantity=2 AND estimated_quantity=6) THEN
    RAISE EXCEPTION 'quote snapshot did not record the exact recipe version and quantity';
  END IF;

  PERFORM public.save_item_template_material_version(template_id,'[{"material_id":"00000000-0000-0000-0000-000000000020","quantity":5,"basis":"per_item"}]','new-recipe');
  UPDATE public.quotations SET status='pending_manager_approval' WHERE id='00000000-0000-0000-0000-000000000030';
  BEGIN
    PERFORM public.snapshot_quote_materials('00000000-0000-0000-0000-000000000030');
    RAISE EXCEPTION 'submitted quote snapshot was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.quote_material_estimates WHERE item_template_version=first_version AND component_quantity=2) THEN
    RAISE EXCEPTION 'later recipe edit changed the submitted quote snapshot';
  END IF;

  UPDATE public.quotations SET status='approved' WHERE id='00000000-0000-0000-0000-000000000030';
  INSERT INTO public.job_orders VALUES ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000030');
  INSERT INTO public.job_order_line_items VALUES ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000031');
  PERFORM public.release_production_from_quote('00000000-0000-0000-0000-000000000040','release-once');
  IF NOT EXISTS (SELECT 1 FROM public.job_bom_items WHERE planned_quantity=6) THEN
    RAISE EXCEPTION 'Job BOM did not copy the frozen quote estimate';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_bom_items WHERE planned_quantity<>6) THEN
    RAISE EXCEPTION 'later template edit altered the released Job BOM';
  END IF;

  UPDATE public.quotations SET status='draft' WHERE id='00000000-0000-0000-0000-000000000030';
  PERFORM public.replace_quote_lines_and_snapshot(
    '00000000-0000-0000-0000-000000000030',
    '[{"id":"00000000-0000-0000-0000-000000000031","item_template_id":"00000000-0000-0000-0000-000000000010","description":"Kiosk","pricing_mode":"fixed","quantity":4,"computed_sqft":null,"unit_price":100,"line_total":400,"no_charge":false,"adjustment_label":"Adjustment","adjustment_amount":0,"sort_order":0}]'
  );
  IF NOT EXISTS (SELECT 1 FROM public.quote_material_estimates WHERE estimated_quantity=20 AND item_template_version=2) THEN
    RAISE EXCEPTION 'atomic line replacement did not rebuild the exact material snapshot';
  END IF;

  CREATE OR REPLACE FUNCTION reject_quote_material() RETURNS trigger LANGUAGE plpgsql AS $trigger$
  BEGIN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='forced snapshot failure'; END $trigger$;
  CREATE TRIGGER reject_quote_material BEFORE INSERT ON public.quote_material_estimates FOR EACH ROW EXECUTE FUNCTION reject_quote_material();
  BEGIN
    PERFORM public.replace_quote_lines_and_snapshot(
      '00000000-0000-0000-0000-000000000030',
      '[{"id":"00000000-0000-0000-0000-000000000031","item_template_id":"00000000-0000-0000-0000-000000000010","description":"Must roll back","pricing_mode":"fixed","quantity":9,"computed_sqft":null,"unit_price":100,"line_total":900,"no_charge":false,"adjustment_label":"Adjustment","adjustment_amount":0,"sort_order":0}]'
    );
    RAISE EXCEPTION 'forced snapshot failure was swallowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.quote_line_items WHERE description='Must roll back' OR quantity=9) THEN
    RAISE EXCEPTION 'line changes survived a failed material snapshot';
  END IF;
END $$;
`;

try {
  execFileSync("docker", ["run", "--detach", "--rm", "--name", container, "-e", "POSTGRES_PASSWORD=local-test-only", "public.ecr.aws/supabase/postgres:17.6.1.165"], { stdio: "pipe" });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      execFileSync("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { stdio: "pipe" });
      ready = true;
      break;
    } catch {
      await setTimeout(1000);
    }
  }
  assert.ok(ready, "Local PostgreSQL did not become ready");
  execFileSync("docker", ["exec", "-i", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
  console.log("PASS: item-template recipe retries, validation, exact quote snapshots, and snapshot locking");
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  execFileSync("docker", ["stop", container], { stdio: "pipe" });
}
