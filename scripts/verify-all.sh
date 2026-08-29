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
run npm --prefix "$ROOT_DIR/simulator" run check
run npm --prefix "$ROOT_DIR/third_party/threejs-factory-demo" run build

echo "基础验证全部通过。MQTT/浏览器验收需按 docs/阶段9非Nanobot真实运行闭环实施清单.md 手工执行。"
