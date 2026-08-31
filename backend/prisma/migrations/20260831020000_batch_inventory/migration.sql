CREATE TABLE IF NOT EXISTS "batch_inventories" (
  "id" VARCHAR(40) NOT NULL,
  "tenant_id" VARCHAR(40) NOT NULL,
  "material_code" VARCHAR(40) NOT NULL,
  "batch_no" VARCHAR(80) NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "unit" VARCHAR(20),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "batch_inventories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_inventories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "batch_inventories_tenant_id_material_code_batch_no_key" ON "batch_inventories"("tenant_id", "material_code", "batch_no");
CREATE INDEX IF NOT EXISTS "batch_inventories_tenant_id_material_code_idx" ON "batch_inventories"("tenant_id", "material_code");
