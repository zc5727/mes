#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"

mkdir -p "$RUNTIME_DIR/logs"

if [[ "${1:-}" == "--infra" ]]; then
  (cd "$ROOT_DIR/backend" && docker compose up -d)
fi

start_service() {
  local name="$1"
  local directory="$2"
  local command="$3"
  local pid_file="$RUNTIME_DIR/${name}.pid"

  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$name 已在运行，PID=$(cat "$pid_file")"
    return
  fi

  nohup bash -c "cd '$ROOT_DIR/$directory' && $command" \
    >"$RUNTIME_DIR/logs/${name}.log" 2>&1 &
  echo $! >"$pid_file"
  echo "$name 已启动，PID=$(cat "$pid_file")，日志：$RUNTIME_DIR/logs/${name}.log"
}

# 后端用生产模式运行，避免 Nest watch 子进程在终端关闭后被系统回收。
start_service backend backend "npm run build && npm run start:prod"
start_service frontend third_party/threejs-factory-demo "npm run dev"
start_service simulator simulator "npm run dev"

cat <<EOF

MES 演示环境已启动：
  前端：  http://localhost:5173
  后端：  http://localhost:3000/api/v1/health
  模拟器：默认输出 JSON，可通过日志查看

终止全部进程：
  $ROOT_DIR/scripts/dev-down.sh
EOF
