BEGIN;

-- Some installations already had the legacy suppliers table when the
-- canonical supplier migration ran. CREATE TABLE IF NOT EXISTS therefore did
-- not add the canonical columns expected by Purchasing. Add them without
-- deleting the legacy columns, and migrate existing values only when each
-- canonical column did not previously exist.
DO $$
DECLARE
  v_had_name BOOLEAN;
  v_had_active BOOLEAN;
  v_had_phone BOOLEAN;
  v_had_tin_number BOOLEAN;
BEGIN
  IF to_regclass('public.suppliers') IS NULL THEN
    RAISE EXCEPTION 'public.suppliers does not exist; apply the supplier foundation migration first';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'name'
  ) INTO v_had_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'active'
  ) INTO v_had_active;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'phone'
  ) INTO v_had_phone;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'tin_number'
  ) INTO v_had_tin_number;

  ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS contact_person TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS tin_number TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

  IF NOT v_had_name AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'supplier_name'
  ) THEN
    EXECUTE 'UPDATE public.suppliers SET name = NULLIF(trim(supplier_name), '''') WHERE name IS NULL';
  END IF;

  IF NOT v_had_active AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'is_active'
  ) THEN
    EXECUTE 'UPDATE public.suppliers SET active = COALESCE(is_active, TRUE)';
  END IF;

  IF NOT v_had_phone AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'contact_number'
  ) THEN
    EXECUTE 'UPDATE public.suppliers SET phone = contact_number WHERE phone IS NULL';
  END IF;

  IF NOT v_had_tin_number AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'tin'
  ) THEN
    EXECUTE 'UPDATE public.suppliers SET tin_number = tin WHERE tin_number IS NULL';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE name IS NULL OR length(trim(name)) = 0
  ) THEN
    RAISE EXCEPTION 'Supplier migration stopped: every existing supplier needs a non-empty name';
  END IF;
END;
$$;

UPDATE public.suppliers
SET active = COALESCE(active, TRUE),
    created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now())
WHERE active IS NULL OR created_at IS NULL OR updated_at IS NULL;

ALTER TABLE public.suppliers
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN active SET DEFAULT TRUE,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.suppliers'::regclass
      AND conname = 'suppliers_name_nonblank_check'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_name_nonblank_check CHECK (length(trim(name)) > 0);
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
