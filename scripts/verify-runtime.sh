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

"$ROOT_DIR/scripts/dev-up.sh" --infra --mqtt
STARTED=true

node "$ROOT_DIR/scripts/browser-smoke.mjs"
npm --prefix "$ROOT_DIR/backend" run smoke:api
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

echo "RUNTIME SMOKE PASS"
echo "注意：当前 DATABASE_ENABLED=false 时只证明数据库服务重启后可用，不证明业务状态持久化恢复。"
