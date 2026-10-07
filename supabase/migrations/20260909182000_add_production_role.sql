ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production';

NOTIFY pgrst, 'reload schema';
