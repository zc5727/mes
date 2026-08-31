-- Strategy history stores the immutable governance projection used to restore
-- results, approvals and audit metadata after a service restart.
ALTER TABLE "strategy_runs"
  ADD COLUMN IF NOT EXISTS "governance" JSONB;
