#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  start)
    shift
    exec "$SCRIPT_DIR/dev-up.sh" "$@"
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
    if [[ -d "$(cd "$SCRIPT_DIR/.." && pwd)/.runtime/desktop/session.lock" ]]; then
      MES_RUNTIME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.runtime/desktop" exec "$SCRIPT_DIR/dev-down.sh" "$@"
    else
      exec "$SCRIPT_DIR/dev-down.sh" "$@"
    fi
    ;;
  status)
    shift
    [[ "$#" -eq 0 ]] || { echo "status 不接受参数：$*" >&2; exit 2; }
    if [[ -d "$(cd "$SCRIPT_DIR/.." && pwd)/.runtime/desktop/session.lock" ]]; then
      MES_RUNTIME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.runtime/desktop" exec "$SCRIPT_DIR/dev-status.sh"
    else
      exec "$SCRIPT_DIR/dev-status.sh"
    fi
    ;;
  *)
    cat >&2 <<'USAGE'
用法：
  scripts/desktop.sh start [--infra] [--mqtt]
  scripts/desktop.sh run
  scripts/desktop.sh rebuild
  scripts/desktop.sh stop [--infra]
  scripts/desktop.sh status
USAGE
    exit 2
    ;;
esac
