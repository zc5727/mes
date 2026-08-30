#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  start)
    shift
    exec "$SCRIPT_DIR/desktop-runtime.sh" --mode=demo "$@"
    ;;
  run)
    shift
    exec "$SCRIPT_DIR/desktop-run.sh" "$@"
    ;;
  rebuild)
    shift
    [[ "$#" -eq 0 ]] || { echo "rebuild 不接受参数：$*" >&2; exit 2; }
    exec "$SCRIPT_DIR/desktop-rebuild.sh"
    ;;
  stop)
    shift
    [[ "$#" -eq 0 ]] || { echo "stop 不接受参数：$*；桌面演示只清理本会话资源" >&2; exit 2; }
    exec "$SCRIPT_DIR/desktop-stop.sh"
    ;;
  status)
    shift
    [[ "$#" -eq 0 ]] || { echo "status 不接受参数：$*" >&2; exit 2; }
    exec "$SCRIPT_DIR/desktop-status.sh"
    ;;
  *)
    cat >&2 <<'USAGE'
用法：
  scripts/desktop.sh start [--no-infra]
  scripts/desktop.sh run
  scripts/desktop.sh rebuild
  scripts/desktop.sh stop
  scripts/desktop.sh status
USAGE
    exit 2
    ;;
esac
