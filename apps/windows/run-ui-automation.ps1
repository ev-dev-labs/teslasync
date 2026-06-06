#!/usr/bin/env pwsh
<#
.SYNOPSIS
  P2/W9-0002 — run the TeslaSync Windows UI automation suite under WinAppDriver.

.DESCRIPTION
  Drives the packaged TeslaSync WinUI app end-to-end through the Windows UI Automation tree using
  WinAppDriver (the W3C WebDriver endpoint on http://127.0.0.1:4723). The C# suite
  (TeslaSync.App.UITests, every test tagged [Trait("Category","UIAutomation")]) talks to that endpoint
  with a dependency-free client, points the app at an in-process seeded fake API, and captures a
  screenshot + UIA tree on every failure.

  REQUIRED RUNNER (this script blocks honestly when any piece is missing):
    * Windows 10 1809+ / Windows 11 with Developer Mode enabled.
    * .NET 10 SDK (dotnet on PATH).
    * Windows App SDK 2.1.3 runtime (ADR-012 / apps/versions.lock.md).
    * WinAppDriver 1.2.1+  -> https://github.com/microsoft/WinAppDriver/releases
        (or an Appium 2 Windows-driver endpoint; set TESLASYNC_UIA_DRIVER_URL to point at it).
    * The packaged app deployed so it has an AUMID, OR a built TeslaSync.App.exe to launch unpackaged.

  Set TESLASYNC_UIA_APP to an explicit AUMID / exe path to override app resolution, and
  TESLASYNC_UIA_DRIVER_URL to override the driver endpoint.

  COVERAGE MAP (what the suite asserts):
    * Shell        : launch, NavigationView groups, command palette/search, DeepLink canonicalisation,
                     back/forward, title-bar + window resize, theme switch, keyboard navigation.
    * Auth         : signed-out route guard, fake sign-in callback, token-refresh failure re-auth, sign-out.
    * Components   : buttons, info-bar, data tables/tabs/charts(+accessible table)/maps/forms/feedback (parity ledger).
    * Page states  : representative route per group x loading/empty/error/cached-offline/refreshing/live-stale/success.
    * Platform     : Toast activation route, JumpList activation route, taskbar status, settings persistence.
    * Accessibility: AutomationProperties names, control types/roles, focus order, keyboard-only path, HighContrast run.

.NOTES
  Per the W9-0002 capability note, when the UI automation runner is absent this script exits with
  STATUS=BLOCKED and that reason only — it never reports an absent runner as green.
#>

[CmdletBinding()]
param(
    [string]$Configuration = "Release",
    [string]$DriverUrl = $env:TESLASYNC_UIA_DRIVER_URL,
    [string]$AppIdentity = $env:TESLASYNC_UIA_APP,
    [switch]$InstallDriver
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$solution = Join-Path $PSScriptRoot "TeslaSync.sln"
$uiProject = Join-Path $PSScriptRoot "TeslaSync.App.UITests\TeslaSync.App.UITests.csproj"
$artifacts = Join-Path $PSScriptRoot "TeslaSync.App.UITests\artifacts"
if (-not $DriverUrl) { $DriverUrl = "http://127.0.0.1:4723" }
$winAppDriverPaths = @(
    "C:\Program Files\Windows Application Driver\WinAppDriver.exe",
    "C:\Program Files (x86)\Windows Application Driver\WinAppDriver.exe"
)

function Write-Status([string]$status, [string]$reason) {
    Write-Output "REASON=$reason"
    Write-Output "STATUS=$status"
    if ($status -eq "BLOCKED") { exit 1 } else { exit 0 }
}

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Write-Output "=== W9-0002 UI automation runner ==="
Write-Output "repo=$repoRoot driver=$DriverUrl"

# 1) .NET 10 SDK must be present.
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Write-Status "BLOCKED" "dotnet (.NET 10 SDK) is not installed."
}

# 2) Build the solution so the app + UI test assembly exist.
dotnet build $solution -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) { Write-Status "BLOCKED" "solution build failed." }

# 3) Resolve / start the WinAppDriver endpoint.
function Test-Endpoint([string]$url) {
    try {
        $uri = [Uri]$url
        $client = [System.Net.Sockets.TcpClient]::new()
        $iar = $client.BeginConnect($uri.Host, $uri.Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne([TimeSpan]::FromMilliseconds(750))
        $connected = $ok -and $client.Connected
        $client.Close()
        return $connected
    }
    catch { return $false }
}

$driverProcess = $null
if (-not (Test-Endpoint $DriverUrl)) {
    $winAppDriver = $winAppDriverPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $winAppDriver -and $InstallDriver -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Output "installing WinAppDriver via winget..."
        winget install --id Microsoft.WinAppDriver --accept-source-agreements --accept-package-agreements 2>&1 | Out-Host
        $winAppDriver = $winAppDriverPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    }

    if (-not $winAppDriver) {
        Write-Status "BLOCKED" ("WinAppDriver/Appium runner is absent: nothing is listening on $DriverUrl and " +
            "WinAppDriver.exe is not installed. Install it from " +
            "https://github.com/microsoft/WinAppDriver/releases (or re-run with -InstallDriver), or point " +
            "TESLASYNC_UIA_DRIVER_URL at an Appium Windows-driver endpoint.")
    }

    $uri = [Uri]$DriverUrl
    Write-Output "starting WinAppDriver: $winAppDriver $($uri.Host) $($uri.Port)"
    $driverProcess = Start-Process -FilePath $winAppDriver -ArgumentList @($uri.Host, "$($uri.Port)") -PassThru
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and -not (Test-Endpoint $DriverUrl)) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Endpoint $DriverUrl)) {
        Write-Status "BLOCKED" "WinAppDriver did not become reachable on $DriverUrl."
    }
}

# 4) Resolve the app under test (explicit override, packaged AUMID, or built exe).
if (-not $AppIdentity) {
    $pkg = Get-AppxPackage -Name "EvDevLabs.TeslaSync" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pkg) {
        $appId = (Get-AppxPackageManifest $pkg).Package.Applications.Application.Id | Select-Object -First 1
        $AppIdentity = "$($pkg.PackageFamilyName)!$appId"
    }
}
if (-not $AppIdentity) {
    $builtExe = Get-ChildItem -Path (Join-Path $PSScriptRoot "TeslaSync.App\bin") -Recurse -Filter "TeslaSync.App.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($builtExe) { $AppIdentity = $builtExe.FullName }
}
if (-not $AppIdentity) {
    Write-Status "BLOCKED" ("the packaged TeslaSync app could not be resolved: deploy the MSIX so it has an AUMID, " +
        "set TESLASYNC_UIA_APP, or build TeslaSync.App.")
}
$env:TESLASYNC_UIA_APP = $AppIdentity
$env:TESLASYNC_UIA_DRIVER_URL = $DriverUrl
Write-Output "app under test: $AppIdentity"

# 5) Run the UIAutomation suite; artifacts land under $artifacts.
try {
    dotnet test $uiProject -c $Configuration --no-build --filter Category=UIAutomation `
        --logger "trx;LogFileName=ui-automation.trx" --results-directory $artifacts --nologo
    $testExit = $LASTEXITCODE
}
finally {
    if ($driverProcess) { Stop-Process -Id $driverProcess.Id -ErrorAction SilentlyContinue }
}

Write-Output "UI_AUTOMATION_EXIT=$testExit"
if ($testExit -ne 0) {
    Write-Status "BLOCKED" "UI automation tests failed (see $artifacts)."
}

Write-Status "DONE" "UI automation suite passed."
