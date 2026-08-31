#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
run npm --prefix "$ROOT_DIR/third_party/threejs-factory-demo" run build
run node "$ROOT_DIR/scripts/frontend-contract-smoke.mjs"
run node "$ROOT_DIR/scripts/desktop-smoke.mjs" --app-dir "$ROOT_DIR/desktop"

echo "代码级验证全部通过。真实 PostgreSQL/MQTT 启停恢复和 DOM/Tauri 交互需执行 scripts/verify-runtime.sh。"
