BEGIN;

-- Older environments may have created workflow_drafts before optimistic
-- concurrency support was added. Restore the column without replacing data.
ALTER TABLE public.workflow_drafts
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

UPDATE public.workflow_drafts
SET version = 1
WHERE version IS NULL;

COMMIT;
