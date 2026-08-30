#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime/desktop"
STATE_FILE="$RUNTIME_DIR/state.env"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "桌面演示状态：未运行"
  exit 0
fi

status="unknown"
stage="unknown"
message=""
while IFS='=' read -r key value; do
  value="${value#\'}"
  value="${value%\'}"
  case "$key" in
    status) status="$value" ;;
    stage) stage="$value" ;;
    message) message="$value" ;;
  esac
done <"$STATE_FILE"

printf '桌面演示状态：%s\n阶段：%s\n消息：%s\n日志：%s/logs/desktop-runtime.log\n' "$status" "$stage" "$message" "$RUNTIME_DIR"
[[ "$status" == "ready" ]] || exit 1
