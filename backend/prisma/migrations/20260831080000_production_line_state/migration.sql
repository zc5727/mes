ALTER TABLE "production_lines"
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN "status_reason" VARCHAR(200);

UPDATE "production_lines"
SET "status" = CASE WHEN "active" THEN 'active' ELSE 'inactive' END
WHERE "status" = 'active';
