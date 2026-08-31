#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/backend/docker-compose.yml"
STARTED=false

cleanup() {
  local exit_code=$?
  if [[ "$STARTED" == true ]]; then
    "$ROOT_DIR/scripts/dev-down.sh" --infra || true
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

echo "检查 Docker Compose 配置"
"${COMPOSE[@]}" config >/dev/null
echo "启动真实 PostgreSQL/MQTT 服务"
"${COMPOSE[@]}" up -d postgres mqtt
STARTED=true
for port in 5432 1883; do
  for _ in $(seq 1 30); do
    nc -z localhost "$port" >/dev/null 2>&1 && break
    sleep 1
  done
  nc -z localhost "$port" || {
    echo "BLOCKED: 真实服务 localhost:$port 未就绪。" >&2
    exit 2
  }
done

echo "执行真实数据库迁移"
npm --prefix "$ROOT_DIR/backend" run db:migrate

if [[ -z "${MES_API_KEY:-}" && -f "$ROOT_DIR/backend/.env" ]]; then
  MES_API_KEY="$(sed -n 's/^MES_API_KEY=//p' "$ROOT_DIR/backend/.env" | head -n 1)"
fi
export MES_API_KEY

DATABASE_ENABLED=true MQTT_ENABLED=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt

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
curl -fsS http://localhost:3000/api/v1/health >/dev/null
echo "检查数据库迁移状态"
npm --prefix "$ROOT_DIR/backend" run db:migrate
echo "检查后端重启后的真实数据库 readiness"
backend_pid_file="$ROOT_DIR/.runtime/backend.pid"
backend_pid="$(cat "$backend_pid_file")"
kill "$backend_pid"
rm -f "$backend_pid_file"
for _ in $(seq 1 30); do
  if ! kill -0 "$backend_pid" 2>/dev/null; then break; fi
  sleep 1
done
DATABASE_ENABLED=true MQTT_ENABLED=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt --no-frontend
readiness="$(curl -fsS http://localhost:3000/api/v1/health/readiness)"
echo "$readiness" | grep -q '"enabled":true' || { echo "FAIL: 数据库未以 enabled=true 运行：$readiness" >&2; exit 1; }
echo "$readiness" | grep -q '"status":"ready"' || { echo "FAIL: 后端重启后数据库未 ready：$readiness" >&2; exit 1; }

echo "RUNTIME SMOKE PASS"
echo "已验证真实迁移、PostgreSQL 重启、后端重启及 DATABASE_ENABLED=true readiness。"
