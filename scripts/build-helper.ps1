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

Push-Location $HelperDir

Write-Host "Building originai-helper..."

if ($Filter -eq "all" -or $Filter -eq "darwin") {
    Write-Host "  -> darwin-arm64..."
    New-Item -ItemType Directory -Force -Path (Join-Path $SidecarDir "darwin-arm64") | Out-Null
    $env:GOOS = "darwin"; $env:GOARCH = "arm64"
    go build -ldflags="-s -w" -o (Join-Path $SidecarDir "darwin-arm64\originai-helper") .

    Write-Host "  -> darwin-x64..."
    New-Item -ItemType Directory -Force -Path (Join-Path $SidecarDir "darwin-x64") | Out-Null
    $env:GOOS = "darwin"; $env:GOARCH = "amd64"
    go build -ldflags="-s -w" -o (Join-Path $SidecarDir "darwin-x64\originai-helper") .
}

if ($Filter -eq "all" -or $Filter -eq "win32") {
    Write-Host "  -> win32-x64..."
    New-Item -ItemType Directory -Force -Path (Join-Path $SidecarDir "win32-x64") | Out-Null
    $env:GOOS = "windows"; $env:GOARCH = "amd64"
    go build -ldflags="-s -w" -o (Join-Path $SidecarDir "win32-x64\originai-helper.exe") .
}

if ($Filter -eq "all" -or $Filter -eq "linux") {
    Write-Host "  -> linux-x64..."
    New-Item -ItemType Directory -Force -Path (Join-Path $SidecarDir "linux-x64") | Out-Null
    $env:GOOS = "linux"; $env:GOARCH = "amd64"
    go build -ldflags="-s -w" -o (Join-Path $SidecarDir "linux-x64\originai-helper") .

    Write-Host "  -> linux-arm64..."
    New-Item -ItemType Directory -Force -Path (Join-Path $SidecarDir "linux-arm64") | Out-Null
    $env:GOOS = "linux"; $env:GOARCH = "arm64"
    go build -ldflags="-s -w" -o (Join-Path $SidecarDir "linux-arm64\originai-helper") .
}

# Clean env vars
Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue

Pop-Location

Write-Host ""
Write-Host "Done! Helper binaries:"
Get-ChildItem "$SidecarDir\*\originai-helper*" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName) ($([math]::Round($_.Length/1MB, 1)) MB)" }
