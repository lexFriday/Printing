-- Derived customer metrics for the customer detail screen.
-- This view keeps customer financial summaries efficient without storing duplicate state.

CREATE OR REPLACE VIEW public.customer_operational_summaries
WITH (security_invoker = true) AS
SELECT
  c.id AS customer_id,
  COALESCE(q.total_quotes, 0)::integer AS total_quotes,
  COALESCE(j.active_jobs, 0)::integer AS active_jobs,
  COALESCE(i.outstanding_balance, 0)::numeric(14, 2) AS outstanding_balance,
  COALESCE(i.lifetime_revenue, 0)::numeric(14, 2) AS lifetime_revenue
FROM public.customers c
LEFT JOIN (
  SELECT customer_id, COUNT(*) AS total_quotes
  FROM public.quotations
  GROUP BY customer_id
) q ON q.customer_id = c.id
LEFT JOIN (
  SELECT customer_id, COUNT(*) FILTER (WHERE status = 'open') AS active_jobs
  FROM public.job_orders
  GROUP BY customer_id
) j ON j.customer_id = c.id
LEFT JOIN (
  SELECT
    customer_id,
    SUM(invoice_amount) FILTER (WHERE status = 'issued') AS outstanding_balance,
    SUM(invoice_amount) AS lifetime_revenue
  FROM public.invoices
  GROUP BY customer_id
) i ON i.customer_id = c.id
;

GRANT SELECT ON public.customer_operational_summaries TO authenticated;

CREATE OR REPLACE VIEW public.customer_active_job_summaries
WITH (security_invoker = true) AS
SELECT
  j.id,
  j.customer_id,
  j.job_number,
  j.project_name,
  j.quoted_amount,
  j.status,
  COALESCE(e.expenses, 0)::numeric(14, 2) AS expenses,
  (j.quoted_amount - COALESCE(e.expenses, 0))::numeric(14, 2) AS profit,
  j.created_at
FROM public.job_orders j
LEFT JOIN (
  SELECT job_order_id, SUM(amount) AS expenses
  FROM public.job_expenses
  GROUP BY job_order_id
) e ON e.job_order_id = j.id
WHERE j.status = 'open';

GRANT SELECT ON public.customer_active_job_summaries TO authenticated;
