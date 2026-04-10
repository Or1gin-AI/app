# Build originai-helper watchdog binary
# Usage:
#   .\scripts\build-helper.ps1              # build all platforms
#   .\scripts\build-helper.ps1 win32        # Windows only
#   .\scripts\build-helper.ps1 darwin       # macOS only
#   .\scripts\build-helper.ps1 linux        # Linux only

param([string]$Filter = "all")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HelperDir = Join-Path $ScriptDir "..\resources\helper"
$SidecarDir = Join-Path $ScriptDir "..\resources\sidecar"

# No external module deps — only allow toolchain downloads
$env:GONOSUMCHECK = "*"
$env:GOFLAGS = "-mod=mod"

Push-Location $HelperDir

function Build-One($Label, $GoOs, $GoArch, $DestDir, $BinName) {
    Write-Host "  -> $Label..."
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    $env:GOOS = $GoOs
    $env:GOARCH = $GoArch
    $outPath = Join-Path $DestDir $BinName
    & go build -ldflags="-s -w" -o $outPath .
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ERROR: go build failed for $Label (exit code $LASTEXITCODE)"
        exit 1
    }
    if (-not (Test-Path $outPath)) {
        Write-Error "ERROR: build failed for $Label - binary not found at $outPath"
        exit 1
    }
    $size = [math]::Round((Get-Item $outPath).Length / 1MB, 1)
    Write-Host "     OK: ${size} MB"
}

Write-Host "Building originai-helper..."

if ($Filter -eq "all" -or $Filter -eq "darwin") {
    Build-One "darwin-arm64" "darwin" "arm64" (Join-Path $SidecarDir "darwin-arm64") "originai-helper"
    Build-One "darwin-x64"   "darwin" "amd64" (Join-Path $SidecarDir "darwin-x64")  "originai-helper"
}

if ($Filter -eq "all" -or $Filter -eq "win32") {
    Build-One "win32-x64" "windows" "amd64" (Join-Path $SidecarDir "win32-x64") "originai-helper.exe"
}

if ($Filter -eq "all" -or $Filter -eq "linux") {
    Build-One "linux-x64"   "linux" "amd64" (Join-Path $SidecarDir "linux-x64")   "originai-helper"
    Build-One "linux-arm64"  "linux" "arm64" (Join-Path $SidecarDir "linux-arm64") "originai-helper"
}

# Clean env vars
Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
Remove-Item Env:\GONOSUMCHECK -ErrorAction SilentlyContinue
Remove-Item Env:\GOFLAGS -ErrorAction SilentlyContinue

Pop-Location

Write-Host ""
Write-Host "Done!"
