#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACOS_BUNDLE_DIR="$ROOT_DIR/desktop/src-tauri/target/release/bundle/macos"
DMG_BUNDLE_DIR="$ROOT_DIR/desktop/src-tauri/target/release/bundle/dmg"
APP="$MACOS_BUNDLE_DIR/MES 智能制造运营平台.app"

[[ "$(uname -s)" == "Darwin" ]] || { echo "BLOCKED: desktop-rebuild 只支持 macOS .app/.dmg 构建" >&2; exit 2; }

if [[ -d "$APP" ]]; then
  pkill -f "$APP/Contents/MacOS/mes-desktop" 2>/dev/null || true
  for _ in $(seq 1 10); do
    pgrep -f "$APP/Contents/MacOS/mes-desktop" >/dev/null 2>&1 || break
    sleep 1
  done
  if pgrep -f "$APP/Contents/MacOS/mes-desktop" >/dev/null 2>&1; then
    echo "旧版桌面程序仍在运行，拒绝覆盖构建：$APP" >&2
    exit 1
  fi
fi

echo "正在重建 MES 本地桌面程序..."
npm --prefix "$ROOT_DIR/desktop" run build:mac

if [[ ! -d "$APP" ]]; then
  echo "桌面程序构建完成，但未找到应用包：$APP" >&2
  exit 1
fi

DMG="$(find "$DMG_BUNDLE_DIR" -maxdepth 1 -type f -name '*.dmg' -print -quit 2>/dev/null || true)"
if [[ ! -f "$DMG" ]]; then
  echo "桌面程序构建完成，但未找到 DMG：$DMG_BUNDLE_DIR" >&2
  exit 1
fi

open "$APP"
echo "已覆盖旧版并打开新版：$APP"
echo "DMG：$DMG"
