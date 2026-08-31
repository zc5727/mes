#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[LOCAL] 代码级门禁"
"$ROOT_DIR/scripts/verify-all.sh"

echo "[LOCAL] 真实依赖运行时门禁"
echo "[LOCAL] PostgreSQL/MQTT 不可用时将失败，不使用 Mock 替代。"
DATABASE_ENABLED=true MQTT_ENABLED=true "$ROOT_DIR/scripts/verify-runtime.sh"

echo "LOCAL VERIFICATION PASS"
