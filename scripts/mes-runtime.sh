#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
用法：scripts/mes-runtime.sh <verify|preflight|start|ready|smoke|restart|stop> [--object-storage]
verify  执行真实依赖、迁移、故障、恢复、WebSocket、桌面和清理全链路门禁
preflight 一键检测 Docker、Compose 和配置，缺失时退出码为 2
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

preflight() {
  local file="$ROOT_DIR/backend/docker-compose.yml"
  if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
    echo "BLOCKED: Docker Compose 不可用。" >&2
    return 2
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "BLOCKED: Docker Engine 不可用。" >&2
    return 2
  fi
  [[ -f "$file" ]] || { echo "BLOCKED: Compose 文件不存在：$file" >&2; return 2; }
  compose config >/dev/null
  echo "PASS runtime preflight: Docker/Compose/config"
}

COMMAND="${1:-}"
shift || true
OBJECT_STORAGE="${MES_OBJECT_STORAGE:-false}"
for arg in "$@"; do
  case "$arg" in
    --object-storage) OBJECT_STORAGE=true ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

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
  preflight
  for port in 5432 1883; do wait_tcp "$port"; done
  compose exec -T postgres pg_isready -U mes -d mes >/dev/null
  if [[ "$OBJECT_STORAGE" == true ]]; then
    wait_tcp 9000
    curl --fail --silent --show-error http://localhost:9000/minio/health/live >/dev/null || { echo "BLOCKED: MinIO healthcheck failed." >&2; return 2; }
  fi
  local readiness
  readiness="$(curl -fsS http://localhost:3000/api/v1/health/readiness)"
  echo "$readiness" | grep -q '"enabled":true' || { echo "FAIL: DATABASE_ENABLED 未启用：$readiness" >&2; return 1; }
  echo "$readiness" | grep -q '"status":"ready"' || { echo "FAIL: PostgreSQL 未 ready：$readiness" >&2; return 1; }
  curl -fsS http://localhost:5173 >/dev/null
  "$ROOT_DIR/scripts/dev-status.sh"
}

start() {
  preflight
  compose --profile infra up -d postgres mqtt
  wait_tcp 5432
  if [[ "$OBJECT_STORAGE" == true ]]; then compose --profile object-storage up -d minio; fi
  npm --prefix "$ROOT_DIR/backend" run db:init
  DATABASE_URL="${DATABASE_URL:-postgresql://mes:mes_dev@localhost:5432/mes}" npm --prefix "$ROOT_DIR/backend" run db:verify-runtime
  DATABASE_ENABLED=true DATABASE_REQUIRED=true MQTT_ENABLED=true MES_OBJECT_STORAGE="$OBJECT_STORAGE" "$ROOT_DIR/scripts/dev-up.sh" --mqtt
  ready
}

smoke() {
  ready
  node "$ROOT_DIR/scripts/browser-smoke.mjs"
  MES_BASE_URL=http://127.0.0.1:3000 npm --prefix "$ROOT_DIR/backend" run smoke:api -- --no-start
  npm --prefix "$ROOT_DIR/backend" run smoke:mqtt
  npm --prefix "$ROOT_DIR/backend" run smoke:fault
  npm --prefix "$ROOT_DIR/backend" run smoke:digital-twin
  if [[ -z "${REALTIME_URL:-}" ]]; then
    echo "BLOCKED: 未配置 REALTIME_URL，无法验证真实 WebSocket 推送。" >&2
    return 2
  fi
  REALTIME_URL="$REALTIME_URL" node "$ROOT_DIR/scripts/websocket-smoke.mjs"
  node "$ROOT_DIR/scripts/desktop-smoke.mjs" --app-dir "$ROOT_DIR/desktop"
}

stop() {
  "$ROOT_DIR/scripts/dev-down.sh" --infra
  local ports=(3000 5173 5432 1883)
  [[ "$OBJECT_STORAGE" == true ]] && ports+=(9000)
  for port in "${ports[@]}"; do
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
  preflight
  compose --profile infra restart postgres mqtt
  if [[ "$OBJECT_STORAGE" == true ]]; then compose --profile object-storage restart minio; fi
  "$ROOT_DIR/scripts/dev-down.sh"
  npm --prefix "$ROOT_DIR/backend" run db:init
  DATABASE_ENABLED=true DATABASE_REQUIRED=true MQTT_ENABLED=true MES_OBJECT_STORAGE="$OBJECT_STORAGE" "$ROOT_DIR/scripts/dev-up.sh" --mqtt
  ready
}

case "$COMMAND" in
  preflight) preflight ;;
  start) start ;;
  ready) ready ;;
  smoke) smoke ;;
  restart) restart ;;
  stop) stop ;;
  verify) "$ROOT_DIR/scripts/verify-runtime.sh" ;;
  *) usage; exit 2 ;;
esac
