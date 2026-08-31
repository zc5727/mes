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
  local file="${MES_RUNTIME_COMPOSE_FILE:-$ROOT_DIR/backend/docker-compose.yml}"
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
  local file="${MES_RUNTIME_COMPOSE_FILE:-$ROOT_DIR/backend/docker-compose.yml}"
  if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
    echo "BLOCKED: Docker Compose 不可用。" >&2
    return 2
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "BLOCKED: Docker Engine 不可用。" >&2
    return 2
  fi
  [[ -f "$file" ]] || { echo "BLOCKED: Compose 文件不存在：$file" >&2; return 2; }
  if ! compose config >/dev/null; then
    echo "BLOCKED: Compose 配置校验失败：$file" >&2
    return 2
  fi
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

wait_postgres() {
  for _ in $(seq 1 30); do
    if compose exec -T postgres pg_isready -U mes -d mes >/dev/null 2>&1; then
      echo "PostgreSQL healthcheck 已通过"
      return 0
    fi
    sleep 1
  done
  echo "BLOCKED: PostgreSQL 容器未通过 healthcheck，请执行 compose logs postgres 诊断。" >&2
  return 2
}

wait_minio() {
  for _ in $(seq 1 30); do
    if curl --fail --silent http://localhost:9000/minio/health/live >/dev/null 2>&1; then
      echo "MinIO readiness 已通过"
      return 0
    fi
    sleep 1
  done
  echo "BLOCKED: MinIO 未通过 readiness，请执行 compose logs minio 诊断。" >&2
  return 2
}

ready() {
  preflight
  for port in 5432 1883; do wait_tcp "$port"; done
  wait_postgres
  if [[ "$OBJECT_STORAGE" == true ]]; then
    wait_tcp 9000
    wait_minio
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
  if ! compose --profile infra up -d postgres mqtt; then
    echo "BLOCKED: PostgreSQL/MQTT 启动失败，请执行 compose logs postgres mqtt 诊断。" >&2
    return 2
  fi
  wait_tcp 5432
  wait_postgres
  if [[ "$OBJECT_STORAGE" == true ]] && ! compose --profile object-storage up -d minio; then
    echo "BLOCKED: MinIO 启动失败，请执行 compose logs minio 诊断。" >&2
    return 2
  fi
  [[ "$OBJECT_STORAGE" != true ]] || wait_minio
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
  if ! compose --profile infra restart postgres mqtt; then
    echo "BLOCKED: PostgreSQL/MQTT 重启失败，请执行 compose logs postgres mqtt 诊断。" >&2
    return 2
  fi
  if [[ "$OBJECT_STORAGE" == true ]] && ! compose --profile object-storage restart minio; then
    echo "BLOCKED: MinIO 重启失败，请执行 compose logs minio 诊断。" >&2
    return 2
  fi
  wait_postgres
  [[ "$OBJECT_STORAGE" != true ]] || wait_minio
  "$ROOT_DIR/scripts/dev-down.sh"
  npm --prefix "$ROOT_DIR/backend" run db:init
  DATABASE_URL="${DATABASE_URL:-postgresql://mes:mes_dev@localhost:5432/mes}" npm --prefix "$ROOT_DIR/backend" run db:verify-runtime
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
