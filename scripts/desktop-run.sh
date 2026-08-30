#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts"
RUNTIME_DIR="$ROOT_DIR/.runtime/desktop"
mkdir -p "$RUNTIME_DIR"
SUPERVISOR_PID_FILE="$RUNTIME_DIR/desktop-runtime.pid"
SUPERVISOR_LOG="$RUNTIME_DIR/logs/desktop-run.log"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -f "$SUPERVISOR_PID_FILE" ]]; then
    supervisor_pid="$(cat "$SUPERVISOR_PID_FILE" 2>/dev/null || true)"
    if [[ "$supervisor_pid" =~ ^[0-9]+$ ]] && kill -0 "$supervisor_pid" 2>/dev/null; then
      kill -TERM "$supervisor_pid" 2>/dev/null || true
      wait "$supervisor_pid" 2>/dev/null || true
    fi
    rm -f "$SUPERVISOR_PID_FILE"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

mkdir -p "$(dirname "$SUPERVISOR_LOG")"
MES_RUNTIME_DIR="$RUNTIME_DIR" MES_DESKTOP_NO_DIALOG=1 \
  "$SCRIPT_DIR/desktop-runtime.sh" --mode=dev --repo-root="$ROOT_DIR" \
  >"$SUPERVISOR_LOG" 2>&1 &
supervisor_pid=$!
printf '%s\n' "$supervisor_pid" >"$SUPERVISOR_PID_FILE"

for _ in $(seq 1 60); do
  if [[ -f "$RUNTIME_DIR/state.env" ]]; then
    status="$(grep '^status=' "$RUNTIME_DIR/state.env" | cut -d= -f2- | tr -d "'" || true)"
    stage="$(grep '^stage=' "$RUNTIME_DIR/state.env" | cut -d= -f2- | tr -d "'" || true)"
    [[ "$status" == "ready" ]] && break
    if [[ "$status" == "failed" ]]; then
      echo "桌面演示启动失败（阶段：$stage），日志：$SUPERVISOR_LOG" >&2
      exit 1
    fi
  fi
  kill -0 "$supervisor_pid" 2>/dev/null || { echo "桌面运行时监督器异常退出，日志：$SUPERVISOR_LOG" >&2; exit 1; }
  sleep 1
done
[[ "${status:-}" == "ready" ]] || { echo "桌面运行时 readiness 超时，日志：$SUPERVISOR_LOG" >&2; exit 1; }

cd "$ROOT_DIR/desktop"
export MES_DESKTOP_MANAGED=0
npm exec -- tauri dev
