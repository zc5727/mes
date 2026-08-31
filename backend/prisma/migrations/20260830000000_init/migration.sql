-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('draft', 'released', 'in_progress', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('online', 'offline', 'maintenance', 'alarm');

-- CreateEnum
CREATE TYPE "AlarmLevel" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlarmStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "tenants" (
    "id" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factories" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "factory_id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "target_oee" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "line_id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "model" VARCHAR(80),
    "protocol" VARCHAR(40),
    "status" "DeviceStatus" NOT NULL DEFAULT 'offline',
    "status_reason" VARCHAR(200),
    "last_seen_at" TIMESTAMP(3),
    "metrics" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "order_no" VARCHAR(80) NOT NULL,
    "product_code" VARCHAR(80) NOT NULL,
    "product_name" VARCHAR(120) NOT NULL,
    "planned_qty" INTEGER NOT NULL,
    "completed_qty" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3) NOT NULL,
    "priority" "WorkOrderPriority" NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'planned',
    "external_id" VARCHAR(80),
    "external_system" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "order_id" VARCHAR(40),
    "order_no" VARCHAR(80) NOT NULL,
    "product_code" VARCHAR(80) NOT NULL,
    "product_name" VARCHAR(120) NOT NULL,
    "line_id" VARCHAR(40) NOT NULL,
    "planned_qty" INTEGER NOT NULL,
    "completed_qty" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3) NOT NULL,
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'normal',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'draft',
    "status_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "external_id" VARCHAR(80),
    "external_system" VARCHAR(40),
    "bom_id" VARCHAR(40),
    "routing_id" VARCHAR(40),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_reports" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "work_order_id" VARCHAR(40) NOT NULL,
    "device_id" VARCHAR(40),
    "quantity" INTEGER NOT NULL,
    "good_qty" INTEGER NOT NULL,
    "defect_qty" INTEGER NOT NULL,
    "source_trace_id" VARCHAR(100) NOT NULL,
    "batch_no" VARCHAR(80),
    "serial_numbers" JSONB,
    "operation_code" VARCHAR(40),
    "operator_id" VARCHAR(40),
    "quality_record_id" VARCHAR(40),
    "material_consumptions" JSONB,
    "reported_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_status_history" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "work_order_id" VARCHAR(40) NOT NULL,
    "from_status" "WorkOrderStatus",
    "to_status" "WorkOrderStatus" NOT NULL,
    "reason" VARCHAR(200) NOT NULL DEFAULT '',
    "operator_id" VARCHAR(40),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarms" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "line_id" VARCHAR(40),
    "device_id" VARCHAR(40),
    "code" VARCHAR(80) NOT NULL,
    "level" "AlarmLevel" NOT NULL,
    "status" "AlarmStatus" NOT NULL DEFAULT 'open',
    "message" VARCHAR(500) NOT NULL,
    "dedupe_key" VARCHAR(160),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alarms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mqtt_device_states" (
    "tenant_id" VARCHAR(40) NOT NULL,
    "line_id" VARCHAR(80) NOT NULL,
    "device_id" VARCHAR(80) NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mqtt_device_states_pkey" PRIMARY KEY ("tenant_id","line_id","device_id")
);

-- CreateTable
CREATE TABLE "mqtt_alarm_states" (
    "tenant_id" VARCHAR(40) NOT NULL,
    "alarm_id" VARCHAR(160) NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mqtt_alarm_states_pkey" PRIMARY KEY ("tenant_id","alarm_id")
);

-- CreateTable
CREATE TABLE "quality_records" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "form_key" VARCHAR(80) NOT NULL,
    "form_version" VARCHAR(40) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "work_order_id" VARCHAR(40),
    "batch_no" VARCHAR(80) NOT NULL,
    "line_id" VARCHAR(40) NOT NULL,
    "device_id" VARCHAR(40),
    "operator_id" VARCHAR(80) NOT NULL,
    "values" JSONB NOT NULL,
    "trace_id" VARCHAR(120) NOT NULL,
    "trace" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_work_orders" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "line_id" VARCHAR(40) NOT NULL,
    "device_id" VARCHAR(40) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "status" VARCHAR(30) NOT NULL,
    "planned_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_records" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "document_key" VARCHAR(120) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "extension" VARCHAR(20) NOT NULL,
    "size" INTEGER NOT NULL,
    "file_hash" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "supersedes_id" VARCHAR(40),
    "storage_key" VARCHAR(255) NOT NULL,
    "storage_provider" VARCHAR(40) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "line_id" VARCHAR(40),
    "work_order_id" VARCHAR(40),
    "product_code" VARCHAR(80),
    "uploaded_by" VARCHAR(80) NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "analysis_status" VARCHAR(30) NOT NULL,
    "analysisDraft" JSONB,
    "analysis_confirmed_by" VARCHAR(80),
    "analysis_confirmed_at" TIMESTAMP(3),
    "trace" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_events" (
    "id" VARCHAR(160) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "line_id" VARCHAR(80),
    "device_id" VARCHAR(80),
    "event_type" VARCHAR(40) NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "trace_id" VARCHAR(120),
    "quality" VARCHAR(40),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "current_states" (
    "tenant_id" VARCHAR(40) NOT NULL,
    "line_id" VARCHAR(80) NOT NULL,
    "device_id" VARCHAR(80) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "current_states_pkey" PRIMARY KEY ("tenant_id","line_id","device_id")
);

-- CreateTable
CREATE TABLE "connection_events" (
    "id" VARCHAR(160) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "gateway_id" VARCHAR(80),
    "status" VARCHAR(40) NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_runs" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "simulation_id" VARCHAR(80) NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_candidates" (
    "id" VARCHAR(40) NOT NULL,
    "strategy_run_id" VARCHAR(40) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "risk" VARCHAR(20) NOT NULL,
    "affected_orders" JSONB NOT NULL,
    "from_line" VARCHAR(40),
    "to_line" VARCHAR(40),
    "expected_finish_time" TIMESTAMP(3) NOT NULL,
    "expected_impact" VARCHAR(500) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "score" INTEGER NOT NULL,

    CONSTRAINT "strategy_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "unit" VARCHAR(20),
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "standard_seconds" INTEGER,
    "workstation" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boms" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "product_code" VARCHAR(40) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "items" JSONB NOT NULL,
    "operation_codes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routings" (
    "id" VARCHAR(40) NOT NULL,
    "tenant_id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "product_code" VARCHAR(40) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "operation_codes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "factories_tenant_id_idx" ON "factories"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "factories_tenant_id_code_key" ON "factories"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "production_lines_tenant_id_factory_id_idx" ON "production_lines"("tenant_id", "factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_lines_tenant_id_code_key" ON "production_lines"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "devices_tenant_id_line_id_status_idx" ON "devices"("tenant_id", "line_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_code_key" ON "devices"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "production_orders_tenant_id_status_due_at_idx" ON "production_orders"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_tenant_id_order_no_key" ON "production_orders"("tenant_id", "order_no");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_status_due_at_idx" ON "work_orders"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_line_id_status_idx" ON "work_orders"("tenant_id", "line_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenant_id_order_no_key" ON "work_orders"("tenant_id", "order_no");

-- CreateIndex
CREATE INDEX "work_order_reports_tenant_id_work_order_id_reported_at_idx" ON "work_order_reports"("tenant_id", "work_order_id", "reported_at");

-- CreateIndex
CREATE INDEX "work_order_reports_tenant_id_device_id_reported_at_idx" ON "work_order_reports"("tenant_id", "device_id", "reported_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_reports_tenant_id_source_trace_id_key" ON "work_order_reports"("tenant_id", "source_trace_id");

-- CreateIndex
CREATE INDEX "work_order_status_history_tenant_id_work_order_id_occurred__idx" ON "work_order_status_history"("tenant_id", "work_order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "alarms_tenant_id_status_level_occurred_at_idx" ON "alarms"("tenant_id", "status", "level", "occurred_at");

-- CreateIndex
CREATE INDEX "alarms_tenant_id_line_id_occurred_at_idx" ON "alarms"("tenant_id", "line_id", "occurred_at");

-- CreateIndex
CREATE INDEX "mqtt_device_states_tenant_id_event_time_idx" ON "mqtt_device_states"("tenant_id", "event_time");

-- CreateIndex
CREATE INDEX "mqtt_alarm_states_tenant_id_active_event_time_idx" ON "mqtt_alarm_states"("tenant_id", "active", "event_time");

-- CreateIndex
CREATE INDEX "quality_records_tenant_id_status_updated_at_idx" ON "quality_records"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "quality_records_tenant_id_trace_id_key" ON "quality_records"("tenant_id", "trace_id");

-- CreateIndex
CREATE INDEX "maintenance_work_orders_tenant_id_status_planned_at_idx" ON "maintenance_work_orders"("tenant_id", "status", "planned_at");

-- CreateIndex
CREATE INDEX "document_records_tenant_id_document_key_version_idx" ON "document_records"("tenant_id", "document_key", "version");

-- CreateIndex
CREATE INDEX "device_events_tenant_id_device_id_event_time_idx" ON "device_events"("tenant_id", "device_id", "event_time");

-- CreateIndex
CREATE INDEX "device_events_tenant_id_event_type_event_time_idx" ON "device_events"("tenant_id", "event_type", "event_time");

-- CreateIndex
CREATE INDEX "current_states_tenant_id_status_event_time_idx" ON "current_states"("tenant_id", "status", "event_time");

-- CreateIndex
CREATE INDEX "connection_events_tenant_id_event_time_idx" ON "connection_events"("tenant_id", "event_time");

-- CreateIndex
CREATE INDEX "strategy_runs_tenant_id_snapshot_at_idx" ON "strategy_runs"("tenant_id", "snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_runs_tenant_id_simulation_id_key" ON "strategy_runs"("tenant_id", "simulation_id");

-- CreateIndex
CREATE INDEX "strategy_candidates_strategy_run_id_score_idx" ON "strategy_candidates"("strategy_run_id", "score");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_code_key" ON "products"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "operations_tenant_id_code_key" ON "operations"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "boms_tenant_id_product_code_idx" ON "boms"("tenant_id", "product_code");

-- CreateIndex
CREATE UNIQUE INDEX "boms_tenant_id_code_version_key" ON "boms"("tenant_id", "code", "version");

-- CreateIndex
CREATE INDEX "routings_tenant_id_product_code_idx" ON "routings"("tenant_id", "product_code");

-- CreateIndex
CREATE UNIQUE INDEX "routings_tenant_id_code_version_key" ON "routings"("tenant_id", "code", "version");

-- AddForeignKey
ALTER TABLE "factories" ADD CONSTRAINT "factories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "production_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "production_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_reports" ADD CONSTRAINT "work_order_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_reports" ADD CONSTRAINT "work_order_reports_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_reports" ADD CONSTRAINT "work_order_reports_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_status_history" ADD CONSTRAINT "work_order_status_history_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "production_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_records" ADD CONSTRAINT "quality_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_records" ADD CONSTRAINT "document_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_candidates" ADD CONSTRAINT "strategy_candidates_strategy_run_id_fkey" FOREIGN KEY ("strategy_run_id") REFERENCES "strategy_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

