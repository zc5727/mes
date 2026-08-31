ALTER TABLE "maintenance_work_orders"
  ADD COLUMN IF NOT EXISTS "inspection_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "inspection_status" VARCHAR(20) NOT NULL DEFAULT 'pending';
