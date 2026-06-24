#!/usr/bin/env pwsh

[CmdletBinding()]
param(
    [ValidateSet("android", "ios", "windows", "macos")]
    [string]$Platform
)

$ErrorActionPreference = "Stop"
$NativeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $NativeRoot

$bundleFileName = switch ($Platform) {
    "android" { "index.android.bundle" }
    "windows" { "index.windows.bundle" }
    default { "main.jsbundle" }
}

$platformBundleRoot = Join-Path $NativeRoot (Join-Path ".bundle" $Platform)
$assetsDest = Join-Path $platformBundleRoot "assets"
$bundleOutput = Join-Path $platformBundleRoot $bundleFileName

New-Item -ItemType Directory -Force -Path $platformBundleRoot, $assetsDest | Out-Null

Write-Host ">> npx react-native bundle --platform $Platform --dev false --entry-file index.js --bundle-output $bundleOutput --assets-dest $assetsDest"
npx react-native bundle `
    --platform $Platform `
    --dev false `
    --entry-file index.js `
    --bundle-output $bundleOutput `
    --assets-dest $assetsDest

if ($LASTEXITCODE -ne 0) {
    throw "React Native bundle failed for $Platform with exit code $LASTEXITCODE."
}
