#!/bin/bash
# Build originai-helper watchdog binary for specified platform
# Usage:
#   bash scripts/build-helper.sh              # build all platforms
#   bash scripts/build-helper.sh darwin        # macOS only (arm64 + x64)
#   bash scripts/build-helper.sh win32         # Windows only (x64)
#   bash scripts/build-helper.sh linux         # Linux only (x64 + arm64)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_DIR="${SCRIPT_DIR}/../resources/helper"
SIDECAR_DIR="${SCRIPT_DIR}/../resources/sidecar"
FILTER="${1:-all}"

# No network calls — pure stdlib, no external deps
export GOPROXY=off
export GONOSUMCHECK="*"

cd "$HELPER_DIR"

build_one() {
  local label="$1" goos="$2" goarch="$3" dest_dir="$4" bin_name="$5"
  echo "  -> ${label}..."
  mkdir -p "${dest_dir}"
  GOOS="${goos}" GOARCH="${goarch}" go build -ldflags="-s -w" -o "${dest_dir}/${bin_name}" .
  if [ ! -f "${dest_dir}/${bin_name}" ]; then
    echo "ERROR: build failed for ${label} — binary not found at ${dest_dir}/${bin_name}" >&2
    exit 1
  fi
  echo "     OK: $(ls -lh "${dest_dir}/${bin_name}" | awk '{print $5}')"
}

echo "Building originai-helper..."

if [ "$FILTER" = "all" ] || [ "$FILTER" = "darwin" ]; then
  build_one "darwin-arm64" darwin arm64 "${SIDECAR_DIR}/darwin-arm64" "originai-helper"
  build_one "darwin-x64"   darwin amd64 "${SIDECAR_DIR}/darwin-x64"  "originai-helper"
fi

if [ "$FILTER" = "all" ] || [ "$FILTER" = "win32" ]; then
  build_one "win32-x64" windows amd64 "${SIDECAR_DIR}/win32-x64" "originai-helper.exe"
fi

if [ "$FILTER" = "all" ] || [ "$FILTER" = "linux" ]; then
  build_one "linux-x64"   linux amd64 "${SIDECAR_DIR}/linux-x64"   "originai-helper"
  build_one "linux-arm64"  linux arm64 "${SIDECAR_DIR}/linux-arm64" "originai-helper"
fi

echo ""
echo "Done!"
