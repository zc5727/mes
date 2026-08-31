#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${MES_RUNTIME_DIR:-$ROOT_DIR/.runtime}"
LOG_DIR="$RUNTIME_DIR/logs"
mkdir -p "$LOG_DIR"
INFRA=false
MQTT=false
FRONTEND=true
SIMULATOR_UI=true
for arg in "$@"; do
  case "$arg" in
    --infra) INFRA=true ;;
    --mqtt) MQTT=true ;;
    --no-frontend) FRONTEND=false ;;
    --no-simulator-ui) SIMULATOR_UI=false ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done
MQTT_URL="${MQTT_URL:-mqtt://localhost:1883}"
TENANT_ID="${MES_TENANT_ID:-tenant-demo}"
DATABASE_ENABLED_VALUE="${DATABASE_ENABLED:-false}"
DATABASE_REQUIRED_VALUE="${DATABASE_REQUIRED:-false}"
STARTED_PID_FILES=()

cleanup_on_failure() {
  local exit_code="${1:-$?}"
  [[ "$exit_code" -eq 0 ]] && return
  echo "启动失败（退出码 $exit_code），清理本次启动的应用进程" >&2
  for pid_file in "${STARTED_PID_FILES[@]}"; do
    [[ -f "$pid_file" ]] || continue
    local pid
    pid="$(cat "$pid_file")"
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
  done
}
trap cleanup_on_failure EXIT

docker_compose() {
  local compose_file="${MES_RUNTIME_COMPOSE_FILE:-$ROOT_DIR/backend/docker-compose.yml}"
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$compose_file" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$compose_file" "$@"
  else
    return 127
  fi
}
start_container_fallback() {
  local name="$1" image="$2" ports="$3" command="${4:-}"
  if docker ps --format '{{.Names}}' | grep -Fxq "$name"; then
    echo "基础设施 $name 已运行"
  elif docker ps -a --format '{{.Names}}' | grep -Fxq "$name"; then
    docker start "$name" >/dev/null
    echo "基础设施 $name 已启动"
  else
    # shellcheck disable=SC2086
    # shellcheck disable=SC2086
    if [[ -n "$command" ]]; then
      docker run -d --name "$name" $ports "$image" $command >/dev/null
    else
      docker run -d --name "$name" $ports "$image" >/dev/null
    fi
    echo "基础设施 $name 已创建并启动"
  fi
}
start_infra() {
  if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
    local compose_args=(--profile infra up -d postgres mqtt)
    [[ "${MES_OBJECT_STORAGE:-false}" == true ]] && compose_args=(--profile infra --profile object-storage up -d postgres mqtt minio)
    if ! docker_compose "${compose_args[@]}"; then
      echo "Docker Compose 启动基础设施失败，请检查 docker compose 日志" >&2
      return 1
    fi
    echo "基础设施已通过 Docker Compose 启动"
    return
  fi
  echo "Docker Compose 不可用，使用 Docker Engine 启动本地依赖" >&2
  start_container_fallback mes-postgres postgres:16-alpine '-p 5432:5432'
  start_container_fallback mes-mqtt eclipse-mosquitto:2 '-p 1883:1883 -p 9001:9001'
  if [[ "${MES_OBJECT_STORAGE:-false}" == true ]]; then
    start_container_fallback mes-minio minio/minio:latest '-p 9000:9000 -p 9002:9001' 'server /data --console-address :9001'
  fi
}
wait_for_tcp() {
  local host="$1" port="$2" label="$3" deadline=$((SECONDS + 30))
  until nc -z "$host" "$port" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then echo "$label 未就绪：$host:$port" >&2; return 1; fi
    sleep 1
  done
  echo "$label 已就绪：$host:$port"
}
wait_for_http() {
  # The backend may need to compile before it starts. Keep the readiness
  # window long enough for a cold workspace without masking a dead process.
  local url="$1" label="$2" pid_file="$3" log_name="$4" deadline=$((SECONDS + 120))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if [[ -f "$pid_file" ]] && ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "$label 进程已退出，查看日志：$LOG_DIR/$log_name.log" >&2
      return 1
    fi
    if (( SECONDS >= deadline )); then echo "$label 健康检查超时：$url" >&2; return 1; fi
    sleep 1
  done
  echo "$label 已就绪：$url"
}
if [[ "$INFRA" == true ]]; then
  start_infra
  [[ "$MQTT" == true ]] && wait_for_tcp localhost 1883 MQTT
  wait_for_tcp localhost 5432 PostgreSQL
fi
start_service() {
  local name="$1" directory="$2" command="$3" port="${4:-}"
  local pid_file="$RUNTIME_DIR/${name}.pid"
  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$name 已在运行，PID=$(cat "$pid_file")"
    return
  fi
  if [[ -n "$port" ]] && nc -z localhost "$port" >/dev/null 2>&1; then
    local existing_pid existing_command
    existing_pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)"
    existing_command="$(ps -p "$existing_pid" -o command= 2>/dev/null || true)"
    if [[ -n "$existing_pid" && "$existing_command" == *"$ROOT_DIR"* ]]; then
      printf '%s\n' "$existing_pid" >"$pid_file"
      echo "$name 已在运行，接管现有 PID=$existing_pid"
      return
    fi
    echo "$name 无法启动：localhost:$port 已被其他进程占用，拒绝创建第二实例" >&2
    return 1
  fi
  # Ignore the parent terminal hangup as well as nohup's own signal handling;
  # this keeps the managed service alive after dev-up exits.
  nohup bash -c "trap '' HUP; cd '$ROOT_DIR/$directory' && $command" </dev/null >"$LOG_DIR/${name}.log" 2>&1 &
  echo $! >"$pid_file"
  STARTED_PID_FILES+=("$pid_file")
  echo "$name 已启动，PID=$(cat "$pid_file")，日志：$LOG_DIR/${name}.log"
}
backend_command="DATABASE_ENABLED='$DATABASE_ENABLED_VALUE' DATABASE_REQUIRED='$DATABASE_REQUIRED_VALUE' npm run build && DATABASE_ENABLED='$DATABASE_ENABLED_VALUE' DATABASE_REQUIRED='$DATABASE_REQUIRED_VALUE' npm run start:prod"
simulator_command="npm run dev"
if [[ "$MQTT" == true ]]; then
  backend_command="DATABASE_ENABLED='$DATABASE_ENABLED_VALUE' DATABASE_REQUIRED='$DATABASE_REQUIRED_VALUE' MQTT_ENABLED=true MQTT_URL='$MQTT_URL' npm run build && DATABASE_ENABLED='$DATABASE_ENABLED_VALUE' DATABASE_REQUIRED='$DATABASE_REQUIRED_VALUE' MQTT_ENABLED=true MQTT_URL='$MQTT_URL' npm run start:prod"
  simulator_command="npm run dev -- --mqtt '$MQTT_URL' --tenant '$TENANT_ID'"
fi
start_service backend backend "$backend_command" 3000
wait_for_http http://localhost:3000/api/v1/health Backend "$RUNTIME_DIR/backend.pid" backend
if [[ "$FRONTEND" == true ]]; then
  start_service frontend third_party/threejs-factory-demo "npm run dev" 5173
  wait_for_http http://localhost:5173 Frontend "$RUNTIME_DIR/frontend.pid" frontend
fi
if [[ "$SIMULATOR_UI" == true ]]; then
  start_service simulator-ui simulator-ui "npm run dev -- --port 5174" 5174
  wait_for_http http://localhost:5174 "仿真控制台" "$RUNTIME_DIR/simulator-ui.pid" simulator-ui
fi
start_service simulator simulator "$simulator_command"
if [[ "$MQTT" == true ]]; then
  sleep 1
  if ! kill -0 "$(cat "$RUNTIME_DIR/simulator.pid")" 2>/dev/null; then
    echo "Simulator 启动失败，查看日志：$LOG_DIR/simulator.log" >&2
    exit 1
  fi
fi
cat <<EOF

MES 演示环境已启动并通过 readiness 检查：
  前端：  http://localhost:5173
  仿真控制台：http://localhost:5174
  后端：  http://localhost:3000/api/v1/health
  MQTT：  $([[ "$MQTT" == true ]] && echo "$MQTT_URL" || echo "未启用")
  日志：  $LOG_DIR

查看状态：
  $ROOT_DIR/scripts/dev-status.sh
终止进程：
  $ROOT_DIR/scripts/dev-down.sh
