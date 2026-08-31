#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="${VERIFY_REPORT_DIR:-$ROOT_DIR/.runtime/reports}"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${VERIFY_REPORT_FILE:-$REPORT_DIR/verify-all-$(date +%Y%m%d-%H%M%S).log}"
exec > >(tee "$REPORT_FILE") 2>&1

on_exit() {
  local exit_code=$?
  if (( exit_code == 0 )); then
    echo "VERIFY-ALL REPORT: $REPORT_FILE"
  else
    echo "VERIFY-ALL FAILED (exit $exit_code). Report: $REPORT_FILE" >&2
  fi
  exit "$exit_code"
}
trap on_exit EXIT

run() {
  echo "+ $*"
  "$@"
}

run git -C "$ROOT_DIR" diff --check
run npm --prefix "$ROOT_DIR/backend" run verify:env
run npm --prefix "$ROOT_DIR/backend" run verify:mock
run npm --prefix "$ROOT_DIR/backend" test -- --runInBand
run npm --prefix "$ROOT_DIR/backend" run test:e2e -- --runInBand
run npm --prefix "$ROOT_DIR/backend" run build
run npm --prefix "$ROOT_DIR/backend" run db:validate
run npm --prefix "$ROOT_DIR/simulator" run check
run npm --prefix "$ROOT_DIR/simulator-ui" run build
run npm --prefix "$ROOT_DIR/third_party/threejs-factory-demo" run build
run node "$ROOT_DIR/scripts/frontend-contract-smoke.mjs"
run node "$ROOT_DIR/scripts/desktop-smoke.mjs" --app-dir "$ROOT_DIR/desktop"

echo "代码级验证全部通过。真实 PostgreSQL/MQTT 启停恢复和 DOM/Tauri 交互需执行 scripts/verify-runtime.sh。"
