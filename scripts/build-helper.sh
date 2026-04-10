#!/bin/bash
# Build originai-helper watchdog binary for specified platform
# Usage:
#   bash scripts/build-helper.sh              # build all platforms
#   bash scripts/build-helper.sh darwin        # macOS only (arm64 + x64)
#   bash scripts/build-helper.sh win32         # Windows only (x64)
#   bash scripts/build-helper.sh linux         # Linux only (x64 + arm64)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_DIR="${SCRIPT_DIR}/../resources/helper"
SIDECAR_DIR="${SCRIPT_DIR}/../resources/sidecar"
FILTER="${1:-all}"

cd "$HELPER_DIR"

echo "Building originai-helper..."

if [ "$FILTER" = "all" ] || [ "$FILTER" = "darwin" ]; then
  echo "  -> darwin-arm64..."
  mkdir -p "${SIDECAR_DIR}/darwin-arm64"
  GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o "${SIDECAR_DIR}/darwin-arm64/originai-helper" .

  echo "  -> darwin-x64..."
  mkdir -p "${SIDECAR_DIR}/darwin-x64"
  GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o "${SIDECAR_DIR}/darwin-x64/originai-helper" .
fi

if [ "$FILTER" = "all" ] || [ "$FILTER" = "win32" ]; then
  echo "  -> win32-x64..."
  mkdir -p "${SIDECAR_DIR}/win32-x64"
  GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "${SIDECAR_DIR}/win32-x64/originai-helper.exe" .
fi

if [ "$FILTER" = "all" ] || [ "$FILTER" = "linux" ]; then
  echo "  -> linux-x64..."
  mkdir -p "${SIDECAR_DIR}/linux-x64"
  GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "${SIDECAR_DIR}/linux-x64/originai-helper" .

  echo "  -> linux-arm64..."
  mkdir -p "${SIDECAR_DIR}/linux-arm64"
  GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o "${SIDECAR_DIR}/linux-arm64/originai-helper" .
fi

echo ""
echo "Done! Helper binaries:"
ls -lh "${SIDECAR_DIR}"/*/originai-helper* 2>/dev/null || true
