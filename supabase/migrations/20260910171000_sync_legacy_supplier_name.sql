BEGIN;

-- Transitional compatibility for databases whose original suppliers table
-- still requires supplier_name. New Purchasing code owns the canonical name
-- column, while this trigger keeps legacy readers and constraints consistent.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS name TEXT;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'suppliers'
      AND column_name = 'supplier_name'
  ) THEN
    EXECUTE $sql$
      UPDATE public.suppliers
      SET name = COALESCE(NULLIF(trim(name), ''), NULLIF(trim(supplier_name), '')),
          supplier_name = COALESCE(NULLIF(trim(name), ''), NULLIF(trim(supplier_name), ''))
    $sql$;

    IF EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE name IS NULL OR length(trim(name)) = 0
    ) THEN
      RAISE EXCEPTION 'Supplier migration stopped: every supplier needs a non-empty name';
    END IF;

    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public.sync_supplier_name_columns()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $function$
      BEGIN
        IF TG_OP = 'UPDATE' AND NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
          AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
          NEW.name := NEW.supplier_name;
          NEW.name := NULLIF(trim(NEW.name), '');
        ELSE
          NEW.name := COALESCE(NULLIF(trim(NEW.name), ''), NULLIF(trim(NEW.supplier_name), ''));
        END IF;

        IF NEW.name IS NULL THEN
          RAISE EXCEPTION 'Supplier name is required';
        END IF;

        NEW.supplier_name := NEW.name;
        RETURN NEW;
      END;
      $function$
    $sql$;

    DROP TRIGGER IF EXISTS sync_supplier_name_columns ON public.suppliers;
    CREATE TRIGGER sync_supplier_name_columns
      BEFORE INSERT OR UPDATE OF name, supplier_name ON public.suppliers
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_supplier_name_columns();
  END IF;
END;
$migration$;

ALTER TABLE public.suppliers
  ALTER COLUMN name SET NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
