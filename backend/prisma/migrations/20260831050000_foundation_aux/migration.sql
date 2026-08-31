CREATE TABLE IF NOT EXISTS "foundation_aux_records" (
  "id" VARCHAR(40) NOT NULL,
  "tenant_id" VARCHAR(40) NOT NULL,
  "domain" VARCHAR(40) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foundation_aux_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "foundation_aux_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "foundation_aux_records_tenant_id_domain_updated_at_idx" ON "foundation_aux_records"("tenant_id", "domain", "updated_at");
