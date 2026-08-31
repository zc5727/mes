#!/usr/bin/env bash
set -Eeuo pipefail

# Real release verification. Missing artifacts, Apple tools or notarization
# credentials are BLOCKED, never a green result.
APP_PATH=""
DMG_PATH=""
NOTARY_PROFILE="${MES_NOTARY_PROFILE:-}"
FAILURES=0
BLOCKED=0

usage() {
  cat <<'USAGE'
用法：scripts/verify-desktop-release.sh --app=PATH --dmg=PATH [--notary-profile=NAME]
在 macOS 上检查 .app/.dmg、代码签名、Gatekeeper 和公证配置。
缺少 artifact、Apple 工具、签名或公证凭据时返回 2。
USAGE
}
blocked() { echo "BLOCKED  $*"; BLOCKED=$((BLOCKED + 1)); }
failed() { echo "FAIL     $*"; FAILURES=$((FAILURES + 1)); }
passed() { echo "PASS     $*"; }

for arg in "$@"; do
  case "$arg" in
    --app=*) APP_PATH="${arg#*=}" ;;
    --dmg=*) DMG_PATH="${arg#*=}" ;;
    --notary-profile=*) NOTARY_PROFILE="${arg#*=}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数：$arg" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || { blocked "需要在 macOS 上执行"; exit 2; }
[[ -n "$APP_PATH" ]] || blocked "缺少 --app=PATH"
[[ -n "$DMG_PATH" ]] || blocked "缺少 --dmg=PATH"
if [[ -n "$APP_PATH" ]]; then [[ -d "$APP_PATH" ]] && passed "app exists: $APP_PATH" || blocked "app 不存在：$APP_PATH"; fi
if [[ -n "$DMG_PATH" ]]; then [[ -f "$DMG_PATH" ]] && passed "dmg exists: $DMG_PATH" || blocked "dmg 不存在：$DMG_PATH"; fi

for tool in codesign spctl hdiutil; do
  command -v "$tool" >/dev/null 2>&1 && passed "tool available: $tool" || blocked "缺少工具：$tool"
done

ADHOC_SIGNATURE=false
if [[ -d "$APP_PATH" ]] && command -v codesign >/dev/null 2>&1; then
  signature_info="$(codesign -dv --verbose=2 "$APP_PATH" 2>&1 || true)"
  if grep -q '^Signature=adhoc$' <<<"$signature_info"; then
    ADHOC_SIGNATURE=true
    blocked "app 使用 ad-hoc 签名，未提供 Developer ID；不能宣称可分发或通过 Gatekeeper"
  elif codesign --verify --deep --strict --verbose=2 "$APP_PATH" >/tmp/mes-codesign.out 2>&1; then
    passed "codesign verify"
  else
    failed "codesign verify"
    sed -n '1,80p' /tmp/mes-codesign.out >&2 || true
  fi
fi
if [[ -d "$APP_PATH" ]] && command -v spctl >/dev/null 2>&1; then
  if [[ "$ADHOC_SIGNATURE" == true ]]; then
    blocked "跳过 Gatekeeper：app 未使用可验证的 Developer ID 签名"
  elif spctl --assess --type execute --verbose=4 "$APP_PATH" >/tmp/mes-spctl.out 2>&1; then
    passed "Gatekeeper assessment"
  else
    failed "Gatekeeper assessment"
    sed -n '1,80p' /tmp/mes-spctl.out >&2 || true
  fi
fi
if [[ -f "$DMG_PATH" ]] && command -v hdiutil >/dev/null 2>&1; then
  if hdiutil imageinfo "$DMG_PATH" >/tmp/mes-dmg.out 2>&1; then passed "DMG metadata"; else failed "DMG metadata"; fi
fi

if [[ -n "$NOTARY_PROFILE" ]]; then
  if ! command -v xcrun >/dev/null 2>&1; then
    blocked "缺少 xcrun，无法检查公证"
  elif [[ -f "$DMG_PATH" ]] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/tmp/mes-notary.out 2>&1; then
    passed "notarytool profile available: $NOTARY_PROFILE"
  else
    failed "notarytool profile 或公证记录不可用"
  fi
else
  blocked "未提供 --notary-profile，公证未验证"
fi

if (( FAILURES > 0 )); then echo "桌面发布验收：FAIL" >&2; exit 1; fi
if (( BLOCKED > 0 )); then echo "桌面发布验收：BLOCKED（外部依赖未满足）" >&2; exit 2; fi
echo "桌面发布验收：PASS"
