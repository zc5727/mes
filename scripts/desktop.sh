#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  start)
    shift
    exec "$SCRIPT_DIR/dev-up.sh" "$@"
    ;;
  stop)
    shift
    exec "$SCRIPT_DIR/dev-down.sh" "$@"
    ;;
  status)
    shift
    [[ "$#" -eq 0 ]] || { echo "status 不接受参数：$*" >&2; exit 2; }
    exec "$SCRIPT_DIR/dev-status.sh"
    ;;
  *)
    cat >&2 <<'USAGE'
用法：
  scripts/desktop.sh start [--infra] [--mqtt]
  scripts/desktop.sh stop [--infra]
  scripts/desktop.sh status
USAGE
    exit 2
    ;;
esac
