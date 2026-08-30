#!/usr/bin/env bash
set -Eeuo pipefail

# The demo runtime is deliberately separate from the business services.  It
# owns only the processes and containers it starts in this desktop session.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts"
RUNTIME_DIR="${MES_RUNTIME_DIR:-$ROOT_DIR/.runtime/desktop}"
LOG_DIR="$RUNTIME_DIR/logs"
LOCK_DIR="$RUNTIME_DIR/session.lock"
STATE_FILE="$RUNTIME_DIR/state.env"
SUPERVISOR_LOG="$LOG_DIR/desktop-runtime.log"
MODE="demo"
START_INFRA=true
HOLD=true
SELF_TEST=false
REPO_ROOT="$ROOT_DIR"
INFRA_STARTED_FILE="$RUNTIME_DIR/infra-started"
STARTED_SERVICE_FILES=()
STOPPING=false

usage() {
  cat <<'USAGE'
用法：
  scripts/desktop-runtime.sh [--mode=demo|dev] [--repo-root=PATH]
                             [--no-infra] [--once] [--self-test]

说明：
  demo       启动本地演示依赖、Backend、Simulator 并持续监管（默认）。
  dev        与 demo 相同，但由 desktop-run.sh 负责启动 Tauri dev。
  --once     readiness 通过后退出，仅用于 smoke/诊断，不负责托管窗口。
  --no-infra 使用已经运行的 PostgreSQL/MQTT，不创建或停止容器。
USAGE
}

log() {
  local level="$1" event="$2" detail="${3:-}"
  mkdir -p "$LOG_DIR"
  # %q gives a stable, shell-parseable key/value record without logging env
  # values such as passwords or tokens.
  printf 'timestamp=%q level=%q event=%q detail=%q\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$level" "$event" "$detail" \
    | tee -a "$SUPERVISOR_LOG"
}

write_state() {
  local status="$1" stage="$2" message="$3" remedy="$4"
  mkdir -p "$RUNTIME_DIR"
  {
    printf 'status=%q\n' "$status"
    printf 'stage=%q\n' "$stage"
    printf 'message=%q\n' "$message"
    printf 'remedy=%q\n' "$remedy"
    printf 'updated_at=%q\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } >"$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
}

fail_stage() {
  local stage="$1" message="$2" remedy="$3"
  write_state failed "$stage" "$message" "$remedy"
  log ERROR "stage_failed" "stage=$stage message=$message remedy=$remedy"
  printf '\nMES 桌面演示启动失败\n阶段：%s\n原因：%s\n处理：%s\n日志：%s\n\n' \
    "$stage" "$message" "$remedy" "$SUPERVISOR_LOG" >&2
  if [[ "${MES_DESKTOP_NO_DIALOG:-0}" != "1" && "$(uname -s)" == "Darwin" ]]; then
    /usr/bin/osascript - "$stage" "$message" "$remedy" "$SUPERVISOR_LOG" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set stageName to item 1 of argv
  set reason to item 2 of argv
  set remedy to item 3 of argv
  set logPath to item 4 of argv
  display dialog "MES 演示启动失败\n阶段：" & stageName & "\n原因：" & reason & "\n处理：" & remedy & "\n日志：" & logPath buttons {"知道了"} default button "知道了" with icon stop
end run
APPLESCRIPT
  fi
  return 1
}

die_usage() {
  echo "未知参数：$1" >&2
  usage >&2
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --mode=demo) MODE="demo" ;;
    --mode=dev) MODE="dev" ;;
    --repo-root=*) REPO_ROOT="${arg#*=}" ;;
    --no-infra) START_INFRA=false ;;
    --once) HOLD=false ;;
    --self-test) SELF_TEST=true; HOLD=false; START_INFRA=false ;;
    --help|-h) usage; exit 0 ;;
    *) die_usage "$arg" ;;
  esac
done

if [[ ! -d "$REPO_ROOT/backend" || ! -d "$REPO_ROOT/simulator" ]]; then
  fail_stage "配置读取" "演示运行目录不可用：未找到 backend 或 simulator" \
    "请用 --repo-root 指向 MES 仓库，或重新安装包含演示运行目录的版本。"
  exit 1
fi

if [[ "$SELF_TEST" == true ]]; then
  write_state ready self-test "桌面编排自检通过" ""
  log INFO "self_test_passed" "runtime=$RUNTIME_DIR"
  exit 0
fi

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  old_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    fail_stage "单实例检查" "桌面演示已在运行（PID=$old_pid）" \
      "请关闭已有 MES 桌面窗口后重试。"
    exit 1
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
printf '%s\n' "$$" >"$LOCK_DIR/pid"

container_id() {
  local service="$1" fallback_name="$2" id
  if command -v docker >/dev/null 2>&1; then
    id="$(docker compose -f "$REPO_ROOT/backend/docker-compose.yml" ps -q "$service" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$id" ]]; then
      printf '%s\n' "$id"
      return 0
    fi
    id="$(docker ps -aq --filter "name=^/${fallback_name}$" | head -n 1 || true)"
    [[ -n "$id" ]] && printf '%s\n' "$id"
  fi
}

is_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" == "true" ]]
}

snapshot_infra() {
  local service fallback id state
  : >"$RUNTIME_DIR/infra-before"
  for service in postgres mqtt minio; do
    case "$service" in
      postgres) fallback="mes-postgres" ;;
      mqtt) fallback="mes-mqtt" ;;
      minio) fallback="mes-minio" ;;
    esac
    id="$(container_id "$service" "$fallback")"
    [[ -n "$id" ]] || continue
    state="false"
    is_running "$id" && state="true"
    printf '%s %s %s\n' "$service" "$id" "$state" >>"$RUNTIME_DIR/infra-before"
  done
}

record_new_infra() {
  local service fallback id before_state
  : >"$INFRA_STARTED_FILE"
  while read -r service id before_state; do
    [[ -n "$service" ]] || continue
    current_id="$id"
    [[ "$before_state" == "true" ]] && continue
    is_running "$current_id" && printf '%s %s\n' "$service" "$current_id" >>"$INFRA_STARTED_FILE"
  done <"$RUNTIME_DIR/infra-before"
  for service in postgres mqtt minio; do
    case "$service" in
      postgres) fallback="mes-postgres" ;;
      mqtt) fallback="mes-mqtt" ;;
      minio) fallback="mes-minio" ;;
    esac
    id="$(container_id "$service" "$fallback")"
    [[ -n "$id" ]] || continue
    if ! awk -v wanted="$id" '$2 == wanted { found=1 } END { exit !found }' "$RUNTIME_DIR/infra-before"; then
      is_running "$id" && printf '%s %s\n' "$service" "$id" >>"$INFRA_STARTED_FILE"
    fi
  done
}

stop_pid_file() {
  local pid_file="$1" name pid command_line
  [[ -f "$pid_file" ]] || return 0
  name="$(basename "$pid_file" .pid)"
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then
    rm -f "$pid_file"
    return 0
  fi
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ -n "$command_line" && "$command_line" != *"$REPO_ROOT"* ]]; then
    log WARN "skip_unowned_process" "name=$name pid=$pid"
    rm -f "$pid_file"
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    log INFO "stop_process" "name=$name pid=$pid"
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

stop_started_infra() {
  local service id
  [[ -f "$INFRA_STARTED_FILE" ]] || return 0
  while read -r service id; do
    [[ -n "$id" ]] || continue
    if is_running "$id"; then
      log INFO "stop_container" "service=$service container=$id"
      docker stop "$id" >/dev/null 2>&1 || log WARN "container_stop_failed" "service=$service container=$id"
    fi
  done < <(tac "$INFRA_STARTED_FILE" 2>/dev/null || tail -r "$INFRA_STARTED_FILE" 2>/dev/null || cat "$INFRA_STARTED_FILE")
}

cleanup() {
  local exit_code=$?
  [[ "$STOPPING" == true ]] && return "$exit_code"
  STOPPING=true
  trap - EXIT INT TERM
  write_state stopping shutdown "正在按逆序清理桌面会话资源" ""
  log INFO "cleanup_started" "exit_code=$exit_code"
  # Reverse of the start order: simulator -> frontend -> backend -> infra.
  stop_pid_file "$RUNTIME_DIR/simulator.pid"
  stop_pid_file "$RUNTIME_DIR/frontend.pid"
  stop_pid_file "$RUNTIME_DIR/backend.pid"
  stop_started_infra
  rm -f "$RUNTIME_DIR/infra-before" "$INFRA_STARTED_FILE" "$STATE_FILE"
  rm -rf "$LOCK_DIR"
  log INFO "cleanup_finished" "exit_code=$exit_code"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

write_state starting "单实例检查" "正在准备 MES 演示会话" ""
log INFO "startup_started" "mode=$MODE repo_root=$REPO_ROOT"

if [[ "$START_INFRA" == true ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    fail_stage "依赖启动" "未找到 Docker，无法启动本地 PostgreSQL/MQTT" \
      "启动 Docker Desktop，或使用 --no-infra 连接已运行的测试依赖。"
    exit 1
  fi
  snapshot_infra
fi

write_state starting "服务编排" "正在启动本地演示服务" ""
log INFO "stage_started" "stage=服务编排"
service_command=("$SCRIPT_DIR/dev-up.sh")
[[ "$START_INFRA" == true ]] && service_command+=(--infra --mqtt)
service_command+=(--no-frontend)
if ! MES_RUNTIME_DIR="$RUNTIME_DIR" "${service_command[@]}" >>"$SUPERVISOR_LOG" 2>&1; then
  fail_stage "服务编排" "Backend、Simulator 或本地依赖启动失败" \
    "查看桌面诊断日志和 backend.log、simulator.log，修复端口或依赖后重试。"
  exit 1
fi
[[ "$START_INFRA" == true ]] && record_new_infra

if [[ ! -f "$RUNTIME_DIR/backend.pid" ]] || ! kill -0 "$(cat "$RUNTIME_DIR/backend.pid")" 2>/dev/null; then
  fail_stage "后端启动" "Backend readiness 通过后进程未保持运行" \
    "查看 $LOG_DIR/backend.log，确认 3000 端口和数据库配置。"
  exit 1
fi
if [[ ! -f "$RUNTIME_DIR/simulator.pid" ]] || ! kill -0 "$(cat "$RUNTIME_DIR/simulator.pid")" 2>/dev/null; then
  fail_stage "模拟器启动" "Simulator 进程未保持运行" \
    "查看 $LOG_DIR/simulator.log，确认 MQTT 和 tenant-demo 配置。"
  exit 1
fi

write_state ready readiness "Backend health 和演示数据源已就绪" ""
log INFO "readiness_passed" "backend=http://localhost:3000/api/v1/health simulator=running"
if [[ "$HOLD" == false ]]; then
  exit 0
fi

while true; do
  if ! kill -0 "$(cat "$RUNTIME_DIR/backend.pid")" 2>/dev/null; then
    fail_stage "后端运行" "Backend 在桌面会话中途退出" "查看 $LOG_DIR/backend.log 后重新启动桌面演示。"
    exit 1
  fi
  if ! kill -0 "$(cat "$RUNTIME_DIR/simulator.pid")" 2>/dev/null; then
    fail_stage "模拟器运行" "Simulator 在桌面会话中途退出" "查看 $LOG_DIR/simulator.log 后重新启动桌面演示。"
    exit 1
  fi
  sleep 1
done
