#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
用法：scripts/mes-runtime.sh <verify|start|ready|smoke|restart|stop>
verify  执行真实依赖、迁移、故障、恢复、WebSocket、桌面和清理全链路门禁
start   启动真实 PostgreSQL/MQTT/MinIO、后端、模拟器和前端
ready   检查真实依赖、API readiness、前端和托管进程
smoke   执行 API、MQTT、故障、数字孪生、WebSocket 和桌面 smoke
restart 重启真实基础设施及应用，再执行 readiness
stop    停止所有托管服务并确认端口/PID/Compose 清理
EOF
}

compose() {
  local file="$ROOT_DIR/backend/docker-compose.yml"
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$file" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$file" "$@"
  else
    echo "BLOCKED: Docker Compose 不可用，真实运行时门禁无法执行。" >&2
    return 2
  fi
}

wait_tcp() {
  local port="$1"
  for _ in $(seq 1 30); do
    nc -z localhost "$port" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "BLOCKED: localhost:$port 未就绪。" >&2
  return 2
}

ready() {
  for port in 5432 1883 9000; do wait_tcp "$port"; done
  compose exec -T postgres pg_isready -U mes -d mes >/dev/null
  curl --fail --silent --show-error http://localhost:9000/minio/health/live >/dev/null
  local readiness
  readiness="$(curl -fsS http://localhost:3000/api/v1/health/readiness)"
  echo "$readiness" | grep -q '"enabled":true' || { echo "FAIL: DATABASE_ENABLED 未启用：$readiness" >&2; return 1; }
  echo "$readiness" | grep -q '"status":"ready"' || { echo "FAIL: PostgreSQL 未 ready：$readiness" >&2; return 1; }
  curl -fsS http://localhost:5173 >/dev/null
  "$ROOT_DIR/scripts/dev-status.sh"
}

start() {
  compose config >/dev/null
  compose up -d postgres mqtt minio
  DATABASE_ENABLED=true MQTT_ENABLED=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt
  ready
}

smoke() {
  ready
  node "$ROOT_DIR/scripts/browser-smoke.mjs"
  MES_BASE_URL=http://127.0.0.1:3000 npm --prefix "$ROOT_DIR/backend" run smoke:api -- --no-start
  npm --prefix "$ROOT_DIR/backend" run smoke:mqtt
  npm --prefix "$ROOT_DIR/backend" run smoke:fault
  npm --prefix "$ROOT_DIR/backend" run smoke:digital-twin
  REALTIME_URL="${REALTIME_URL:-}" node "$ROOT_DIR/scripts/websocket-smoke.mjs"
  node "$ROOT_DIR/scripts/desktop-smoke.mjs" --app-dir "$ROOT_DIR/desktop"
}

stop() {
  "$ROOT_DIR/scripts/dev-down.sh" --infra
  for port in 3000 5173 5432 1883 9000; do
    if nc -z localhost "$port" >/dev/null 2>&1; then
      echo "FAIL: 停止后端口仍监听：$port" >&2
      return 1
    fi
  done
  if compgen -G "$ROOT_DIR/.runtime/*.pid" >/dev/null; then
    echo "FAIL: 停止后仍有 PID 文件" >&2
    return 1
  fi
  echo "PASS runtime stop cleanup"
}

restart() {
  compose restart postgres mqtt minio
  "$ROOT_DIR/scripts/dev-down.sh"
  DATABASE_ENABLED=true MQTT_ENABLED=true "$ROOT_DIR/scripts/dev-up.sh" --mqtt
  ready
}

case "${1:-}" in
  start) start ;;
  ready) ready ;;
  smoke) smoke ;;
  restart) restart ;;
  stop) stop ;;
  verify) "$ROOT_DIR/scripts/verify-runtime.sh" ;;
  *) usage; exit 2 ;;
esac
