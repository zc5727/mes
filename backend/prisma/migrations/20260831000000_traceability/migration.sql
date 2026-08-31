-- Traceability fields for production reports. IF NOT EXISTS keeps this safe for
-- installations that already applied the equivalent schema changes manually.
ALTER TABLE "work_order_reports"
  ADD COLUMN IF NOT EXISTS "batch_no" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "serial_numbers" JSONB,
  ADD COLUMN IF NOT EXISTS "operation_code" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "operator_id" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "quality_record_id" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "material_consumptions" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "work_order_reports_tenant_id_source_trace_id_key"
  ON "work_order_reports"("tenant_id", "source_trace_id");

CREATE INDEX IF NOT EXISTS "work_order_reports_tenant_id_work_order_id_reported_at_idx"
  ON "work_order_reports"("tenant_id", "work_order_id", "reported_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_order_reports_quantity_integrity_chk'
  ) THEN
    ALTER TABLE "work_order_reports"
      ADD CONSTRAINT "work_order_reports_quantity_integrity_chk"
      CHECK ("quantity" > 0 AND "good_qty" >= 0 AND "defect_qty" >= 0 AND "good_qty" + "defect_qty" = "quantity");
  END IF;
END $$;
