CREATE TABLE IF NOT EXISTS "device_profiles" (
  "key" VARCHAR(120) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "protocol" VARCHAR(40) NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "device_profiles_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "device_profiles_protocol_verified_idx"
  ON "device_profiles"("protocol", "verified");

CREATE TABLE IF NOT EXISTS "device_connections" (
  "id" VARCHAR(80) NOT NULL,
  "tenant_id" VARCHAR(40) NOT NULL,
  "device_id" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "profile_key" VARCHAR(120),
  "driver_verification" VARCHAR(30) NOT NULL,
  "endpoint" VARCHAR(500) NOT NULL,
  "config" JSONB NOT NULL,
  "capabilities" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" VARCHAR(30) NOT NULL,
  "health" JSONB NOT NULL,
  "last_error" VARCHAR(500),
  "last_error_code" VARCHAR(80),
  "last_event_at" TIMESTAMP(3),
  "last_heartbeat_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "device_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_connections_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "device_connections_tenant_id_device_id_type_key"
  ON "device_connections"("tenant_id", "device_id", "type");
CREATE INDEX IF NOT EXISTS "device_connections_tenant_id_status_idx"
  ON "device_connections"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "device_connections_tenant_id_profile_key_idx"
  ON "device_connections"("tenant_id", "profile_key");

CREATE TABLE IF NOT EXISTS "device_connection_status_events" (
  "id" VARCHAR(80) NOT NULL,
  "tenant_id" VARCHAR(40) NOT NULL,
  "connection_id" VARCHAR(80) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "event_time" TIMESTAMP(3) NOT NULL,
  "error_code" VARCHAR(80),
  "details" JSONB NOT NULL,
  CONSTRAINT "device_connection_status_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_connection_status_events_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "device_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "device_connection_status_events_tenant_id_connection_id_event_time_idx"
  ON "device_connection_status_events"("tenant_id", "connection_id", "event_time");
