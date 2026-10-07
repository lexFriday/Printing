ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS client_po_number text,
  ADD COLUMN IF NOT EXISTS project_manager text,
  ADD COLUMN IF NOT EXISTS dr_number text,
  ADD COLUMN IF NOT EXISTS installation_date date;
