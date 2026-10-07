// Runs only in a disposable local PostgreSQL container; never accepts a database URL.
// Regression: removing the recipe audit trigger must make this test fail.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const container = `njl-audit-test-${process.pid}`;
const migration = new URL('../supabase/migrations/20260910090000_audit_item_template_materials.sql', import.meta.url);
const foundation = readFileSync(new URL('../docs/lovable-cloud-one-paste-migrations.sql', import.meta.url), 'utf8');
const audit = foundation.slice(foundation.indexOf('CREATE OR REPLACE FUNCTION app_private.capture_audit_log()'), foundation.indexOf('DO $$', foundation.indexOf('CREATE OR REPLACE FUNCTION app_private.capture_audit_log()')));
const versioning = readFileSync(new URL('../supabase/migrations/20260903110000_item_template_material_versioning.sql', import.meta.url), 'utf8');
const saveRecipe = versioning.slice(versioning.indexOf('CREATE OR REPLACE FUNCTION public.save_item_template_material_version('), versioning.indexOf('UPDATE public.item_template_materials SET active = true'));
const sql = `
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS auth;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('CREATE ROLE %I',role_name); END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.audit_logs (id uuid DEFAULT gen_random_uuid(),user_id uuid,action text,entity_type text,entity_id uuid,old_values jsonb,new_values jsonb);
CREATE TYPE public.material_component_basis AS ENUM ('per_item','per_sqft','fixed_per_line');
CREATE TABLE public.item_template_materials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_template_id uuid NOT NULL,material_id uuid NOT NULL,quantity numeric NOT NULL CHECK(quantity>0),basis public.material_component_basis,version integer,active boolean);
${audit}
${saveRecipe}
${existsSync(migration) ? readFileSync(migration, 'utf8') : ''}
DO $$
DECLARE template_id uuid := '00000000-0000-0000-0000-000000000002';
  component_id uuid; audit_count integer;
  components jsonb := '[{"material_id":"00000000-0000-0000-0000-000000000003","quantity":2,"basis":"per_item"}]';
BEGIN
  PERFORM public.save_item_template_material_version(template_id,components,'first');
  SELECT id INTO component_id FROM public.item_template_materials WHERE active;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=component_id AND entity_type='item_template_materials' AND action='insert' AND old_values IS NULL AND new_values->>'quantity'='2' AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Recipe save did not create its audit entry';
  END IF;
  PERFORM public.save_item_template_material_version(template_id,components,'second');
  IF (SELECT count(*) FROM public.audit_logs)<>3 THEN RAISE EXCEPTION 'Expected insert, deactivate, insert audit entries'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='update' AND entity_id=component_id AND old_values->>'active'='true' AND new_values->>'active'='false') THEN RAISE EXCEPTION 'Missing before/after version audit'; END IF;
  SELECT count(*) INTO audit_count FROM public.audit_logs;
  -- Force an audit insertion failure, not a business-table failure.
  -- Allow the old version's deactivation audit, then reject the new row's audit.
  ALTER TABLE public.audit_logs ADD CONSTRAINT test_reject_audit CHECK (action <> 'insert') NOT VALID;
  BEGIN
    PERFORM public.save_item_template_material_version(template_id,components,'must-rollback');
    RAISE EXCEPTION 'Audit failure was swallowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.item_template_materials)<>2 OR NOT EXISTS(SELECT 1 FROM public.item_template_materials WHERE version=2 AND active) OR (SELECT count(*) FROM public.audit_logs)<>audit_count THEN
    RAISE EXCEPTION 'Audit failure did not roll back the whole recipe save';
  END IF;
  ALTER TABLE public.audit_logs DROP CONSTRAINT test_reject_audit;
  DELETE FROM public.item_template_materials WHERE id=component_id;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='delete' AND entity_id=component_id AND old_values IS NOT NULL AND new_values IS NULL) THEN RAISE EXCEPTION 'Missing delete audit'; END IF;
END $$;
`;
try {
  execFileSync('docker', ['run','--detach','--rm','--name',container,'-e','POSTGRES_PASSWORD=local-test-only','public.ecr.aws/supabase/postgres:17.6.1.165'], {stdio:'pipe'});
  let ready = false;
  for (let attempt=0; attempt<30; attempt++) {
    // TCP excludes the image's temporary socket-only initialization server.
    try { execFileSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'pipe'}); ready=true; break; } catch { await setTimeout(1000); }
  }
  assert.ok(ready, 'Local PostgreSQL did not become ready');
  execFileSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,stdio:['pipe','pipe','pipe']});
  console.log('PASS: recipe insert/update/delete auditing and full rollback on audit failure (isolated PostgreSQL; auth stubbed, not an RLS test).');
} catch(error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode=1;
} finally {
  execFileSync('docker',['stop',container],{stdio:'pipe'});
}
