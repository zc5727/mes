#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/desktop/src-tauri/target/release/bundle"
APP_PATH="${MES_DESKTOP_APP:-}"
DMG_PATH="${MES_DESKTOP_DMG:-}"

if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -type d -name '*.app' -print -quit 2>/dev/null || true)"
fi
if [[ -z "$DMG_PATH" ]]; then
  DMG_PATH="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -type f -name '*.dmg' -print -quit 2>/dev/null || true)"
fi

if [[ -z "$APP_PATH" || -z "$DMG_PATH" ]]; then
  echo "BLOCKED: 未找到 macOS .app/.dmg。先执行：npm --prefix desktop run build:mac" >&2
  exit 2
fi

exec "$ROOT_DIR/scripts/verify-desktop-release.sh" --app="$APP_PATH" --dmg="$DMG_PATH" "$@"
