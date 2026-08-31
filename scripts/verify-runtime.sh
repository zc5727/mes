#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MES_RUNTIME_COMPOSE_FILE:-$ROOT_DIR/backend/docker-compose.yml}"
STARTED=false

cleanup() {
  local exit_code=$?
  if [[ "$STARTED" == true ]]; then
    MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" "$ROOT_DIR/scripts/dev-down.sh" --infra || true
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
for port in 5432 1883 9000; do
  for _ in $(seq 1 30); do
    nc -z localhost "$port" >/dev/null 2>&1 && break
    sleep 1
  done
  nc -z localhost "$port" || {
    echo "BLOCKED: 真实服务 localhost:$port 未就绪。" >&2
    exit 2
  }
done

if ! curl --fail --silent --show-error http://localhost:9000/minio/health/live >/dev/null; then
  echo "BLOCKED: MinIO readiness 检查失败。" >&2
  exit 2
fi
echo "PASS MinIO object storage readiness"

if ! "${COMPOSE[@]}" exec -T postgres pg_isready -U mes -d mes >/dev/null; then
  echo "BLOCKED: PostgreSQL healthcheck 未通过。" >&2
  exit 2
fi
echo "PASS PostgreSQL protocol readiness"

echo "执行真实数据库迁移"
npm --prefix "$ROOT_DIR/backend" run db:migrate
DATABASE_URL="${DATABASE_URL:-postgresql://mes:mes_dev@localhost:5432/mes}" npm --prefix "$ROOT_DIR/backend" run db:verify-runtime
"$ROOT_DIR/scripts/verify-migration-rollback.sh" "${COMPOSE[@]}"

if [[ -z "${MES_API_KEY:-}" && -f "$ROOT_DIR/backend/.env" ]]; then
  MES_API_KEY="$(sed -n 's/^MES_API_KEY=//p' "$ROOT_DIR/backend/.env" | head -n 1)"
fi
export MES_API_KEY

MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" DATABASE_ENABLED=true DATABASE_REQUIRED=true MQTT_ENABLED=true MES_OBJECT_STORAGE=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt

readiness="$(curl -fsS http://localhost:3000/api/v1/health/readiness)"
echo "$readiness" | grep -q '"enabled":true' || { echo "FAIL: 后端未启用真实数据库：$readiness" >&2; exit 1; }
echo "$readiness" | grep -q '"status":"ready"' || { echo "FAIL: PostgreSQL readiness 未达到 ready：$readiness" >&2; exit 1; }
echo "PASS backend readiness: DATABASE_ENABLED=true"

node "$ROOT_DIR/scripts/browser-smoke.mjs"
MES_BASE_URL=http://127.0.0.1:3000 MES_API_KEY="${MES_API_KEY:-}" MES_TENANT_ID="${MES_TENANT_ID:-tenant-demo}" npm --prefix "$ROOT_DIR/backend" run smoke:api -- --no-start
npm --prefix "$ROOT_DIR/backend" run smoke:mqtt
npm --prefix "$ROOT_DIR/backend" run smoke:fault
npm --prefix "$ROOT_DIR/backend" run smoke:digital-twin

echo "检查 PostgreSQL 重启后的 TCP/服务可用性"
"${COMPOSE[@]}" restart postgres
for _ in $(seq 1 30); do
  if nc -z localhost 5432 >/dev/null 2>&1; then break; fi
  sleep 1
done
nc -z localhost 5432
"${COMPOSE[@]}" exec -T postgres pg_isready -U mes -d mes >/dev/null
curl -fsS http://localhost:3000/api/v1/health >/dev/null
echo "检查数据库迁移状态"
npm --prefix "$ROOT_DIR/backend" run db:migrate
echo "检查后端重启后的真实数据库 readiness"
backend_pid_file="$ROOT_DIR/.runtime/backend.pid"
backend_pid="$(cat "$backend_pid_file")"
pkill -TERM -P "$backend_pid" 2>/dev/null || true
kill "$backend_pid"
rm -f "$backend_pid_file"
for _ in $(seq 1 30); do
  if ! kill -0 "$backend_pid" 2>/dev/null; then break; fi
  sleep 1
done
MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" DATABASE_ENABLED=true DATABASE_REQUIRED=true MQTT_ENABLED=true MES_OBJECT_STORAGE=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt --no-frontend
readiness="$(curl -fsS http://localhost:3000/api/v1/health/readiness)"
echo "$readiness" | grep -q '"enabled":true' || { echo "FAIL: 数据库未以 enabled=true 运行：$readiness" >&2; exit 1; }
echo "$readiness" | grep -q '"status":"ready"' || { echo "FAIL: 后端重启后数据库未 ready：$readiness" >&2; exit 1; }
echo "PASS backend restart recovery: DATABASE_ENABLED=true"

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

echo "检查真实 WebSocket 推送"
if [[ -z "${REALTIME_URL:-}" ]]; then
  echo "BLOCKED: 未配置 REALTIME_URL，无法验证真实 WebSocket 推送。" >&2
  exit 2
fi
REALTIME_URL="$REALTIME_URL" node "$ROOT_DIR/scripts/websocket-smoke.mjs"

echo "检查 Tauri release smoke"
node "$ROOT_DIR/scripts/desktop-smoke.mjs" --app-dir "$ROOT_DIR/desktop"

echo "停止并验证服务清理"
MES_RUNTIME_COMPOSE_FILE="$COMPOSE_FILE" "$ROOT_DIR/scripts/dev-down.sh" --infra
STARTED=false
if nc -z localhost 3000 >/dev/null 2>&1 || nc -z localhost 1883 >/dev/null 2>&1 || nc -z localhost 5432 >/dev/null 2>&1 || nc -z localhost 9000 >/dev/null 2>&1; then
  echo "FAIL: 停止后仍有 MES 端口监听（3000/1883/5432/9000）" >&2
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
echo "PASS service stop cleanup"

echo "RUNTIME SMOKE PASS"
echo "已验证真实迁移、PostgreSQL 重启、后端重启及 DATABASE_ENABLED=true readiness。"
