#!/bin/bash
# Download latest Xray-core binaries + geo data for all platforms
# Usage:
#   bash scripts/download-xray.sh              # download all platforms
#   bash scripts/download-xray.sh darwin        # macOS only (arm64 + x64)
#   bash scripts/download-xray.sh win32         # Windows only (x64)
#   bash scripts/download-xray.sh linux         # Linux only (x64 + arm64)
#
# Proxy: https_proxy=http://127.0.0.1:7890 bash scripts/download-xray.sh

set -e

SIDECAR_DIR="$(cd "$(dirname "$0")/../resources/sidecar" && pwd)"
FILTER="${1:-all}"

# Fetch latest release tag from GitHub API
echo "Fetching latest Xray-core version..."
VERSION=$(curl -sL "https://api.github.com/repos/XTLS/Xray-core/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
if [ -z "$VERSION" ]; then
  echo "ERROR: Failed to fetch latest version" >&2
  exit 1
fi
BASE_URL="https://github.com/XTLS/Xray-core/releases/download/${VERSION}"
echo "Version: ${VERSION}"
echo "Target:  ${SIDECAR_DIR}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

download_platform() {
  local label="$1" url="$2" dest_dir="$3" bin_name="$4"
  local zip="${TMP}/${label}.zip"

  echo "  -> ${label}..."
  mkdir -p "${dest_dir}"
  curl -fSL -o "$zip" "$url"
  unzip -o "$zip" "$bin_name" geoip.dat geosite.dat -d "${TMP}/${label}"
  cp "${TMP}/${label}/${bin_name}" "${dest_dir}/${bin_name}"
  cp "${TMP}/${label}/geoip.dat"  "${dest_dir}/geoip.dat"
  cp "${TMP}/${label}/geosite.dat" "${dest_dir}/geosite.dat"
  chmod +x "${dest_dir}/${bin_name}"
}

# macOS
if [ "$FILTER" = "all" ] || [ "$FILTER" = "darwin" ]; then
  download_platform "darwin-arm64" "${BASE_URL}/Xray-macos-arm64-v8a.zip" "${SIDECAR_DIR}/darwin-arm64" "xray"
  download_platform "darwin-x64"   "${BASE_URL}/Xray-macos-64.zip"        "${SIDECAR_DIR}/darwin-x64"   "xray"

  # Remove macOS quarantine attribute
  echo "  -> Removing macOS quarantine..."
  xattr -cr "${SIDECAR_DIR}/darwin-arm64/" 2>/dev/null || true
  xattr -cr "${SIDECAR_DIR}/darwin-x64/"   2>/dev/null || true
fi

# Windows
if [ "$FILTER" = "all" ] || [ "$FILTER" = "win32" ]; then
  download_platform "win32-x64" "${BASE_URL}/Xray-windows-64.zip" "${SIDECAR_DIR}/win32-x64" "xray.exe"
fi

# Linux
if [ "$FILTER" = "all" ] || [ "$FILTER" = "linux" ]; then
  download_platform "linux-x64"   "${BASE_URL}/Xray-linux-64.zip"          "${SIDECAR_DIR}/linux-x64"   "xray"
  download_platform "linux-arm64" "${BASE_URL}/Xray-linux-arm64-v8a.zip"   "${SIDECAR_DIR}/linux-arm64" "xray"
fi

echo ""
echo "Done! Xray ${VERSION} binaries:"
[ -f "${SIDECAR_DIR}/darwin-arm64/xray" ]  && ls -lh "${SIDECAR_DIR}/darwin-arm64/xray"
[ -f "${SIDECAR_DIR}/darwin-x64/xray" ]    && ls -lh "${SIDECAR_DIR}/darwin-x64/xray"
[ -f "${SIDECAR_DIR}/win32-x64/xray.exe" ] && ls -lh "${SIDECAR_DIR}/win32-x64/xray.exe"
[ -f "${SIDECAR_DIR}/linux-x64/xray" ]     && ls -lh "${SIDECAR_DIR}/linux-x64/xray"
[ -f "${SIDECAR_DIR}/linux-arm64/xray" ]   && ls -lh "${SIDECAR_DIR}/linux-arm64/xray"
