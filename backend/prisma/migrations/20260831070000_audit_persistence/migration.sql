CREATE TABLE "audit_events" (
    "id" VARCHAR(80) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "actor" VARCHAR(120) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "resource" VARCHAR(80) NOT NULL,
    "resource_id" VARCHAR(80),
    "details" JSONB NOT NULL,
    "operator" VARCHAR(120) NOT NULL,
    "object" VARCHAR(160) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(500) NOT NULL,
    "trace_id" VARCHAR(120) NOT NULL,
    "result" VARCHAR(20) NOT NULL,
    "prev_hash" VARCHAR(64),
    "hash" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_approvals" (
    "id" VARCHAR(80) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "resource" VARCHAR(80) NOT NULL,
    "resource_id" VARCHAR(160) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "comment" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(120),
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "audit_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_tenant_id_created_at_idx"
  ON "audit_events"("tenant_id", "created_at");
CREATE INDEX "audit_events_tenant_id_trace_id_idx"
  ON "audit_events"("tenant_id", "trace_id");
CREATE INDEX "audit_approvals_tenant_id_resource_resource_id_idx"
  ON "audit_approvals"("tenant_id", "resource", "resource_id");
CREATE INDEX "audit_approvals_tenant_id_status_created_at_idx"
  ON "audit_approvals"("tenant_id", "status", "created_at");

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_approvals"
  ADD CONSTRAINT "audit_approvals_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
