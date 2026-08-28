#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"

for pid_file in "$RUNTIME_DIR"/*.pid; do
  [[ -e "$pid_file" ]] || continue
  pid="$(cat "$pid_file")"
  name="$(basename "$pid_file" .pid)"

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
    echo "$name 已终止，PID=$pid"
  else
    echo "$name 已不在运行"
  fi

  rm -f "$pid_file"
done

if [[ "${1:-}" == "--infra" ]]; then
  (cd "$ROOT_DIR/backend" && docker compose down)
fi
