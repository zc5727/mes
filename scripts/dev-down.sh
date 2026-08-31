#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${MES_RUNTIME_DIR:-$ROOT_DIR/.runtime}"
for pid_file in "$RUNTIME_DIR"/*.pid; do
  [[ -e "$pid_file" ]] || continue
  pid="$(cat "$pid_file")"
  name="$(basename "$pid_file" .pid)"
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ -n "$command_line" && "$command_line" != *"$ROOT_DIR"* ]]; then
    echo "$name PID 已被其他进程占用，跳过清理：$pid"
    rm -f "$pid_file"
    continue
  fi
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL "$pid" 2>/dev/null || true
    echo "$name 已终止，PID=$pid"
  else
    echo "$name 已不在运行"
  fi
  rm -f "$pid_file"
done
if [[ "${1:-}" == "--infra" ]]; then
  compose_file="${MES_RUNTIME_COMPOSE_FILE:-$ROOT_DIR/backend/docker-compose.yml}"
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$compose_file" down
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$compose_file" down
  else
    docker stop mes-postgres mes-mqtt mes-minio 2>/dev/null || true
  fi
fi
