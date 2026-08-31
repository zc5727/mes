#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
missing_compose="$(mktemp -d)/missing-compose.yml"
set +e
output="$(MES_RUNTIME_COMPOSE_FILE="$missing_compose" "$ROOT_DIR/scripts/verify-runtime.sh" 2>&1)"
status=$?
set -e

printf '%s\n' "$output"
if (( status != 2 )) || [[ "$output" != *"BLOCKED:"* ]]; then
  echo "FAIL: runtime 门禁未对不可用依赖 fail-closed（exit=$status）" >&2
  exit 1
fi

echo "UNAVAILABLE GATE PASS: 依赖不可用时明确 BLOCKED，未将 Mock 结果计为通过。"
