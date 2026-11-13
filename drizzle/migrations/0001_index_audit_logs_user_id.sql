-- Removing an account must check the large activity history for references to that
-- account; without this index every account removal scans the whole history and times out.
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON public.audit_logs (user_id);
