# Download latest Xray-core binaries + geo data
# Usage:
#   .\scripts\download-xray.ps1              # download all platforms
#   .\scripts\download-xray.ps1 win32        # Windows only
#   .\scripts\download-xray.ps1 darwin       # macOS only
#   .\scripts\download-xray.ps1 linux        # Linux only

param([string]$Filter = "all")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SidecarDir = Join-Path $ScriptDir "..\resources\sidecar"
New-Item -ItemType Directory -Force -Path $SidecarDir | Out-Null
$SidecarDir = (Resolve-Path $SidecarDir).Path

Write-Host "Fetching latest Xray-core version..."
$headers = @{}
if ($env:GH_TOKEN) { $headers["Authorization"] = "token $env:GH_TOKEN" }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/XTLS/Xray-core/releases/latest" -Headers $headers
$Version = $release.tag_name
if (-not $Version) { Write-Error "Failed to fetch latest version"; exit 1 }
$BaseUrl = "https://github.com/XTLS/Xray-core/releases/download/$Version"
Write-Host "Version: $Version"

function Download-Platform($Label, $Url, $DestDir, $BinName) {
    Write-Host "  -> $Label..."
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    $zip = Join-Path $env:TEMP "$Label.zip"
    $tmp = Join-Path $env:TEMP "$Label"
    Invoke-WebRequest -Uri $Url -OutFile $zip
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    Copy-Item (Join-Path $tmp $BinName) (Join-Path $DestDir $BinName) -Force
    Copy-Item (Join-Path $tmp "geoip.dat") (Join-Path $DestDir "geoip.dat") -Force
    Copy-Item (Join-Path $tmp "geosite.dat") (Join-Path $DestDir "geosite.dat") -Force
    Remove-Item $zip -Force
    Remove-Item -Recurse -Force $tmp
}

if ($Filter -eq "all" -or $Filter -eq "darwin") {
    Download-Platform "darwin-arm64" "$BaseUrl/Xray-macos-arm64-v8a.zip" (Join-Path $SidecarDir "darwin-arm64") "xray"
    Download-Platform "darwin-x64"   "$BaseUrl/Xray-macos-64.zip"        (Join-Path $SidecarDir "darwin-x64")   "xray"
}

if ($Filter -eq "all" -or $Filter -eq "win32") {
    Download-Platform "win32-x64" "$BaseUrl/Xray-windows-64.zip" (Join-Path $SidecarDir "win32-x64") "xray.exe"
}

if ($Filter -eq "all" -or $Filter -eq "linux") {
    Download-Platform "linux-x64"   "$BaseUrl/Xray-linux-64.zip"        (Join-Path $SidecarDir "linux-x64")   "xray"
    Download-Platform "linux-arm64" "$BaseUrl/Xray-linux-arm64-v8a.zip" (Join-Path $SidecarDir "linux-arm64") "xray"
}

Write-Host ""
Write-Host "Done! Xray $Version binaries:"
Get-ChildItem "$SidecarDir\*\xray*" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName) ($([math]::Round($_.Length/1MB, 1)) MB)" }
