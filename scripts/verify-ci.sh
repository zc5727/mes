#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${CI:-}" != "true" && "${CI:-}" != "1" ]]; then
  echo "BLOCKED: verify-ci.sh 只能在 CI=true 的非交互环境执行。" >&2
  exit 2
fi

echo "[CI] 代码级门禁"
"$ROOT_DIR/scripts/verify-all.sh"

echo "[CI] 真实 PostgreSQL/MQTT 运行时门禁"
echo "[CI] 未检测到真实依赖时必须失败；Mock 仅可用于单元测试，不作为运行时通过。"
DATABASE_ENABLED=true MQTT_ENABLED=true "$ROOT_DIR/scripts/verify-runtime.sh"

echo "CI VERIFICATION PASS"
