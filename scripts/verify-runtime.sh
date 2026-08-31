#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MES_RUNTIME_COMPOSE_FILE:-$ROOT_DIR/backend/docker-compose.yml}"
export COMPOSE_PROJECT_NAME="${MES_RUNTIME_PROJECT_NAME:-mes-runtime-$$}"
POSTGRES_HOST_PORT="${MES_POSTGRES_HOST_PORT:-5432}"
MQTT_HOST_PORT="${MES_MQTT_HOST_PORT:-1883}"
MINIO_HOST_PORT="${MES_MINIO_HOST_PORT:-9000}"
export MES_POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT"
export MES_MQTT_HOST_PORT="$MQTT_HOST_PORT"
export MES_MINIO_HOST_PORT="$MINIO_HOST_PORT"
export MQTT_URL="${MQTT_URL:-mqtt://localhost:${MQTT_HOST_PORT}}"
export DATABASE_URL="${DATABASE_URL:-postgresql://mes:mes_dev@localhost:${POSTGRES_HOST_PORT}/mes}"
STARTED=false

wait_for_http() {
  local url="$1"
  local label="$2"

  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "BLOCKED: $label 未在 30 秒内就绪：$url" >&2
  return 1
}

cleanup() {
  local exit_code=$?
  if [[ "$STARTED" == true ]]; then
    MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" "$ROOT_DIR/scripts/dev-down.sh" --infra || true
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose -f "$COMPOSE_FILE")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose -f "$COMPOSE_FILE")
else
  echo "BLOCKED: Docker Compose 不可用，无法执行 PostgreSQL/MQTT 启停恢复验收。"
  echo "可重复命令：$ROOT_DIR/scripts/verify-runtime.sh"
  exit 2
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "BLOCKED: Docker Compose 文件不存在：$COMPOSE_FILE" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: Docker Engine 不可用，无法启动真实 PostgreSQL/MQTT。" >&2
  exit 2
fi

for port in 3000 5173 5174 "$POSTGRES_HOST_PORT" "$MQTT_HOST_PORT" "$MINIO_HOST_PORT"; do
  if nc -z localhost "$port" >/dev/null 2>&1; then
    echo "BLOCKED: localhost:$port 已被占用，无法保证本次 runtime 的实例隔离。" >&2
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    fi
    echo "请先执行：$ROOT_DIR/scripts/dev-down.sh --infra；确认端口属于本项目后再重试。" >&2
    exit 2
  fi
done

echo "检查 Docker Compose 配置"
if ! "${COMPOSE[@]}" config >/dev/null; then
  echo "BLOCKED: Compose 配置校验失败：$COMPOSE_FILE" >&2
  exit 2
fi
echo "启动真实 PostgreSQL/MQTT/对象存储服务（infra + object-storage profiles）"
if ! "${COMPOSE[@]}" --profile infra --profile object-storage up -d postgres mqtt minio; then
  echo "BLOCKED: 基础设施启动失败，请执行 ${COMPOSE[*]} logs postgres mqtt minio 诊断。" >&2
  exit 2
fi
STARTED=true
for port in "$POSTGRES_HOST_PORT" "$MQTT_HOST_PORT" "$MINIO_HOST_PORT"; do
  for _ in $(seq 1 30); do
    nc -z localhost "$port" >/dev/null 2>&1 && break
    sleep 1
  done
  nc -z localhost "$port" || {
    echo "BLOCKED: 真实服务 localhost:$port 未就绪。" >&2
    exit 2
  }
done

minio_ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "http://localhost:${MINIO_HOST_PORT}/minio/health/live" >/dev/null 2>&1; then
    minio_ready=true
    break
  fi
  sleep 1
done
if [[ "$minio_ready" != true ]]; then
  echo "BLOCKED: MinIO readiness 检查失败。" >&2
  exit 2
fi
echo "PASS MinIO object storage readiness"

postgres_ready=false
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U mes -d mes >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 1
done
if [[ "$postgres_ready" != true ]]; then
  echo "BLOCKED: PostgreSQL healthcheck 未通过。" >&2
  exit 2
fi
echo "PASS PostgreSQL protocol readiness"

echo "执行真实数据库迁移"
npm --prefix "$ROOT_DIR/backend" run db:init
npm --prefix "$ROOT_DIR/backend" run db:verify-runtime
"$ROOT_DIR/scripts/verify-migration-rollback.sh" "${COMPOSE[@]}"

if [[ -z "${MES_API_KEY:-}" && -f "$ROOT_DIR/backend/.env" ]]; then
  MES_API_KEY="$(sed -n 's/^MES_API_KEY=//p' "$ROOT_DIR/backend/.env" | head -n 1)"
fi
export MES_API_KEY

DATABASE_URL="$DATABASE_URL" \
MQTT_URL="$MQTT_URL" \
MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" DATABASE_ENABLED=true DATABASE_REQUIRED=true MQTT_ENABLED=true MES_OBJECT_STORAGE=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt

readiness="$(curl -fsS http://localhost:3000/api/v1/health/readiness)"
echo "$readiness" | grep -q '"enabled":true' || { echo "FAIL: 后端未启用真实数据库：$readiness" >&2; exit 1; }
echo "$readiness" | grep -q '"status":"ready"' || { echo "FAIL: PostgreSQL readiness 未达到 ready：$readiness" >&2; exit 1; }
echo "PASS backend readiness: DATABASE_ENABLED=true"

node "$ROOT_DIR/scripts/browser-smoke.mjs"
node "$ROOT_DIR/scripts/simulator-ui-smoke.mjs"
MES_BASE_URL=http://127.0.0.1:3000 MES_API_KEY="$MES_API_KEY" MES_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" npm --prefix "$ROOT_DIR/backend" run smoke:api -- --no-start
MES_BASE_URL=http://127.0.0.1:3000 MES_API_KEY="$MES_API_KEY" MES_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" npm --prefix "$ROOT_DIR/backend" run smoke:mqtt
MES_BASE_URL=http://127.0.0.1:3000 MES_API_KEY="$MES_API_KEY" MES_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" npm --prefix "$ROOT_DIR/backend" run smoke:fault
MES_BASE_URL=http://127.0.0.1:3000 MES_API_KEY="$MES_API_KEY" MES_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" npm --prefix "$ROOT_DIR/backend" run smoke:digital-twin
MES_BASE_URL=http://127.0.0.1:3000 MES_API_KEY="$MES_API_KEY" MES_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" MES_STRATEGY_SMOKE_STATE="$ROOT_DIR/.runtime/strategy-governance-smoke.json" MES_STRATEGY_SMOKE_MODE=write npm --prefix "$ROOT_DIR/backend" run smoke:strategy-runtime

echo "检查 PostgreSQL 重启后的 TCP/服务可用性"
"${COMPOSE[@]}" restart postgres
for _ in $(seq 1 30); do
  if nc -z localhost "$POSTGRES_HOST_PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
nc -z localhost "$POSTGRES_HOST_PORT"
"${COMPOSE[@]}" exec -T postgres pg_isready -U mes -d mes >/dev/null
wait_for_http "http://localhost:3000/api/v1/health" "PostgreSQL 重启后的后端健康检查"
echo "检查数据库迁移状态"
npm --prefix "$ROOT_DIR/backend" run db:migrate
echo "检查后端重启后的真实数据库 readiness"
backend_pid_file="$ROOT_DIR/.runtime/backend.pid"
backend_pid="$(cat "$backend_pid_file")"
pkill -TERM -P "$backend_pid" 2>/dev/null || true
kill "$backend_pid" 2>/dev/null || true
rm -f "$backend_pid_file"
for _ in $(seq 1 30); do
  if ! kill -0 "$backend_pid" 2>/dev/null; then break; fi
  sleep 1
done
DATABASE_URL="$DATABASE_URL" \
MQTT_URL="$MQTT_URL" \
MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" DATABASE_ENABLED=true DATABASE_REQUIRED=true MQTT_ENABLED=true MES_OBJECT_STORAGE=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt --no-frontend
readiness="$(curl -fsS http://localhost:3000/api/v1/health/readiness)"
echo "$readiness" | grep -q '"enabled":true' || { echo "FAIL: 数据库未以 enabled=true 运行：$readiness" >&2; exit 1; }
echo "$readiness" | grep -q '"status":"ready"' || { echo "FAIL: 后端重启后数据库未 ready：$readiness" >&2; exit 1; }
echo "PASS backend restart recovery: DATABASE_ENABLED=true"
MES_BASE_URL=http://127.0.0.1:3000 MES_API_KEY="$MES_API_KEY" MES_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" MES_STRATEGY_SMOKE_STATE="$ROOT_DIR/.runtime/strategy-governance-smoke.json" MES_STRATEGY_SMOKE_MODE=restore npm --prefix "$ROOT_DIR/backend" run smoke:strategy-runtime

echo "检查模拟器重启恢复"
simulator_pid_file="$ROOT_DIR/.runtime/simulator.pid"
simulator_pid="$(cat "$simulator_pid_file")"
pkill -TERM -P "$simulator_pid" 2>/dev/null || true
kill "$simulator_pid" 2>/dev/null || true
rm -f "$simulator_pid_file"
for _ in $(seq 1 30); do
  if ! kill -0 "$simulator_pid" 2>/dev/null; then break; fi
  sleep 1
done
MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" DATABASE_ENABLED=true MQTT_ENABLED=true MES_OBJECT_STORAGE=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt --no-frontend
simulator_pid="$(cat "$simulator_pid_file")"
kill -0 "$simulator_pid" 2>/dev/null || { echo "FAIL: 模拟器重启后进程未存活" >&2; exit 1; }
echo "PASS simulator restart recovery: PID=$simulator_pid"

echo "检查真实数字孪生实时推送（默认使用后端 SSE）"
REALTIME_PROTOCOL="${REALTIME_PROTOCOL:-sse}" \
REALTIME_URL="${REALTIME_URL:-http://127.0.0.1:3000/api/v1/digital-twin/stream}" \
REALTIME_API_KEY="$MES_API_KEY" \
REALTIME_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" \
node "$ROOT_DIR/scripts/websocket-smoke.mjs"

echo "检查 Tauri release smoke"
node "$ROOT_DIR/scripts/desktop-smoke.mjs" --app-dir "$ROOT_DIR/desktop"

echo "停止并验证服务清理"
MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" "$ROOT_DIR/scripts/dev-down.sh" --infra
if nc -z localhost 3000 >/dev/null 2>&1 || nc -z localhost 5173 >/dev/null 2>&1 || nc -z localhost 5174 >/dev/null 2>&1 || nc -z localhost "$MQTT_HOST_PORT" >/dev/null 2>&1 || nc -z localhost "$POSTGRES_HOST_PORT" >/dev/null 2>&1 || nc -z localhost "$MINIO_HOST_PORT" >/dev/null 2>&1; then
  echo "FAIL: 停止后仍有 MES 端口监听（3000/5173/5174/${MQTT_HOST_PORT}/${POSTGRES_HOST_PORT}/${MINIO_HOST_PORT}）" >&2
  exit 1
fi
if [[ -d "$ROOT_DIR/.runtime" ]] && compgen -G "$ROOT_DIR/.runtime/*.pid" >/dev/null; then
  echo "FAIL: 停止后仍有托管 PID 文件" >&2
  exit 1
fi
if [[ -n "$("${COMPOSE[@]}" ps -q 2>/dev/null)" ]]; then
  echo "FAIL: Docker Compose 服务未完全停止" >&2
  exit 1
fi
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null
STARTED=false
echo "PASS service stop cleanup"

echo "RUNTIME SMOKE PASS"
echo "已验证真实迁移、PostgreSQL 重启、后端重启及 DATABASE_ENABLED=true readiness。"
