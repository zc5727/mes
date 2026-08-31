#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if (( $# == 0 )); then
  echo "用法：verify-migration-rollback.sh <compose 命令及参数>" >&2
  exit 2
fi

COMPOSE=("$@")
if [[ "${COMPOSE[0]}" == "docker" && "${COMPOSE[1]:-}" == "compose" ]]; then
  if ! docker compose version >/dev/null 2>&1; then
    echo "BLOCKED: Docker Compose 不可用，无法执行真实迁移回滚演练。" >&2
    exit 2
  fi
elif [[ "${COMPOSE[0]}" == "docker-compose" ]]; then
  command -v docker-compose >/dev/null 2>&1 || { echo "BLOCKED: docker-compose 不可用，无法执行真实迁移回滚演练。" >&2; exit 2; }
else
  echo "BLOCKED: 未识别的 Compose 命令，无法执行真实迁移回滚演练。" >&2
  exit 2
fi
DATABASE_NAME="mes_rollback_${RANDOM}_$$"
cleanup() {
  "${COMPOSE[@]}" exec -T postgres psql -U mes -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$DATABASE_NAME\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "创建一次性迁移回滚数据库：$DATABASE_NAME"
"${COMPOSE[@]}" exec -T postgres psql -U mes -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$DATABASE_NAME\";" >/dev/null

echo "在一次性数据库执行真实迁移"
DATABASE_URL="postgresql://mes:mes_dev@localhost:5432/$DATABASE_NAME" \
  npm --prefix "$ROOT_DIR/backend" run db:migrate

echo "删除一次性数据库，完成回滚演练"
"${COMPOSE[@]}" exec -T postgres psql -U mes -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE \"$DATABASE_NAME\";" >/dev/null
trap - EXIT
echo "MIGRATION ROLLBACK REHEARSAL PASS"
