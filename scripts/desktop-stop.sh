#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime/desktop"
PID_FILE="$RUNTIME_DIR/desktop-runtime.pid"
LOCK_DIR="$RUNTIME_DIR/session.lock"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid"
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
  fi
  rm -f "$PID_FILE"
fi

if [[ -d "$LOCK_DIR" ]]; then
  echo "桌面运行时锁仍存在，未强制删除：$LOCK_DIR" >&2
  exit 1
fi
echo "桌面演示已停止；本会话资源按逆序清理完成"
