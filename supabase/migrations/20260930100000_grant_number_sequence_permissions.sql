-- Repair sequence permissions for petty cash, general expenses, and numbering sequences.
-- When sequences are created in environments without default sequence grants to `authenticated`,
-- direct inserts into tables whose column defaults call `nextval(...)` fail with:
-- "permission denied for sequence petty_cash_number_seq".
BEGIN;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT USAGE, SELECT ON SEQUENCE public.petty_cash_number_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.general_expense_number_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_request_number_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seq_customer_no TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seq_quote_no TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seq_job_no TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seq_invoice_no TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

