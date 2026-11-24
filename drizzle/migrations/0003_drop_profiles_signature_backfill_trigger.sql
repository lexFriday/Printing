-- Remove legacy trigger on public.profiles that tried to backfill
-- signature snapshots on existing job_orders, which conflicts with
-- job_orders_snapshot_signatures ("Job Order signer identity and signatures are immutable").
DROP TRIGGER IF EXISTS profiles_fill_empty_document_signatures ON public.profiles;
DROP FUNCTION IF EXISTS public.fill_empty_document_signatures_from_profile();
