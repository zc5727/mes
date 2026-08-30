#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT_DIR/desktop/src-tauri/target/release/bundle/macos/MES 智能制造运营平台.app"

if [[ -d "$APP" ]]; then
  pkill -f "$APP/Contents/MacOS/mes-desktop" 2>/dev/null || true
fi

echo "正在重建 MES 本地桌面程序..."
npm --prefix "$ROOT_DIR/desktop" run build

if [[ ! -d "$APP" ]]; then
  echo "桌面程序构建完成，但未找到应用包：$APP" >&2
  exit 1
fi

open "$APP"
echo "已覆盖旧版并打开新版：$APP"
