# Project rules

- Apply schema changes through the Lovable migration tool (drizzle/migrations); treat files in supabase/migrations as source material to review and adapt, never bulk-apply them, because many were written for a different database and conflict with the live schema.
- The signup trigger (public.handle_new_user) must check public.profiles under an advisory lock and never read auth.* tables, because trigger code without auth-schema access breaks signup with "permission denied for schema auth".
- SECURITY DEFINER functions must be owned by postgres, because other owners cannot evaluate auth.uid().
- Account requests and approvals run through the existing request-account and manage-user-request backend functions; new signups stay inactive with no role until an owner/admin accepts them.
- Keep an index on every audit_logs foreign key to auth.users, because the audit history is large and account removal otherwise times out.
