#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts"
RUNTIME_DIR="$ROOT_DIR/.runtime/desktop"
LOCK_DIR="$RUNTIME_DIR/session.lock"
mkdir -p "$RUNTIME_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "桌面演示已在运行（PID=$lock_pid），拒绝重复启动" >&2
    exit 1
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
printf '%s\n' "$$" >"$LOCK_DIR/pid"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  MES_RUNTIME_DIR="$RUNTIME_DIR" "$SCRIPT_DIR/dev-down.sh" >/dev/null 2>&1 || true
  rm -rf "$LOCK_DIR"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

MES_RUNTIME_DIR="$RUNTIME_DIR" "$SCRIPT_DIR/dev-up.sh" --infra --mqtt --no-frontend
cd "$ROOT_DIR/desktop"
npm exec -- tauri dev
