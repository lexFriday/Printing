-- Production query indexes for the existing operational workflows.
-- These support the current list/detail/report reads without changing data ownership.

CREATE INDEX IF NOT EXISTS idx_customers_created_at
  ON public.customers(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotations_status_created_at
  ON public.quotations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotations_created_at
  ON public.quotations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_orders_customer
  ON public.job_orders(customer_id);

CREATE INDEX IF NOT EXISTS idx_job_orders_status_created_at
  ON public.job_orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_orders_created_at
  ON public.job_orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_expenses_created_at
  ON public.job_expenses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_customer
  ON public.invoices(customer_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status_created_at
  ON public.invoices(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_created_at
  ON public.invoices(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type_created_at
  ON public.audit_logs(entity_type, created_at DESC);
