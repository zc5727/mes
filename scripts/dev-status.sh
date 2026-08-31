#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${MES_RUNTIME_DIR:-$ROOT_DIR/.runtime}"
FAILURES=0
check_process() {
  local name="$1" pid_file="$RUNTIME_DIR/$1.pid"
  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "PASS $name process PID=$(cat "$pid_file")"
  elif [[ -f "$pid_file" ]]; then
    echo "INFO $name stale PID file removed: $pid_file"
    rm -f "$pid_file"
  else
    echo "INFO $name process is not managed by dev-up.sh"
  fi
}
check_http() {
  local name="$1" url="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "PASS $name $url"
  else
    echo "DOWN $name $url"
    FAILURES=$((FAILURES + 1))
  fi
}
check_tcp() {
  local name="$1" port="$2"
  if nc -z localhost "$port" >/dev/null 2>&1; then
    echo "PASS $name localhost:$port"
  else
    echo "DOWN $name localhost:$port"
    FAILURES=$((FAILURES + 1))
  fi
}
check_process backend
check_process frontend
check_process simulator
check_process simulator-ui
check_http backend http://localhost:3000/api/v1/health
check_http frontend http://localhost:5173
if [[ -f "$RUNTIME_DIR/simulator-ui.pid" ]]; then
  check_http simulator-ui http://localhost:5174
fi
check_tcp mqtt 1883
check_tcp postgres 5432

if (( FAILURES > 0 )); then
  echo "服务状态：失败（$FAILURES 项未通过）" >&2
  exit 1
fi
echo "服务状态：全部可用"
