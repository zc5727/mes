ALTER TABLE "document_records"
  ADD COLUMN IF NOT EXISTS "security_scan_status" VARCHAR(20) NOT NULL DEFAULT 'not_scanned',
  ADD COLUMN IF NOT EXISTS "security_scan_provider" VARCHAR(80) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "security_scan_message" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "security_scanned_at" TIMESTAMP(3);
