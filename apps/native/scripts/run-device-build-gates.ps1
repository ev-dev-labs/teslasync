#!/usr/bin/env pwsh

[CmdletBinding()]
param(
    [ValidateSet("all", "android", "ios", "windows", "macos")]
    [string]$Platform = "all",

    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [ValidateSet("x86", "x64", "ARM64")]
    [string]$WindowsArch = "x64",

    [switch]$RunQualityGates = $false
)

$ErrorActionPreference = "Stop"
$NativeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $NativeRoot

$Unavailable = [System.Collections.Generic.List[string]]::new()

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = $NativeRoot
    )

    Push-Location $WorkingDirectory
    try {
        Write-Host ">> $FilePath $($Arguments -join ' ')"
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

function Invoke-NpmScript {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$ScriptArguments = @()
    )

    $arguments = @("run", $Name)
    if ($ScriptArguments.Count -gt 0) {
        $arguments += "--"
        $arguments += $ScriptArguments
    }

    Invoke-External -FilePath "npm" -Arguments $arguments
}

function Add-UnavailableTooling {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Tool,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $message = "[$Target] UNAVAILABLE: $Tool - $Reason"
    Write-Host $message
    $Unavailable.Add($message) | Out-Null
}

function Test-HostCommand {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-AndroidSdk {
    foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    $localProperties = Join-Path $NativeRoot "android\local.properties"
    if (Test-Path $localProperties) {
        $sdkLine = Get-Content $localProperties | Where-Object { $_ -match "^sdk\.dir=" } | Select-Object -First 1
        if ($sdkLine) {
            $sdkPath = ($sdkLine -replace "^sdk\.dir=", "").Replace("\\:", ":").Replace("\\", "\")
            if (Test-Path $sdkPath) {
                return $sdkPath
            }
        }
    }

    return $null
}

function Resolve-MSBuild {
    $msbuild = Get-Command "MSBuild.exe" -ErrorAction SilentlyContinue
    if ($msbuild) {
        return $msbuild.Source
    }

    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    if (-not $programFilesX86) {
        return $null
    }

    $vswhere = Join-Path $programFilesX86 "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $match = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" | Select-Object -First 1
        if ($match) {
            return $match
        }
    }

    return $null
}

function Resolve-WindowsSdkVersion {
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    if (-not $programFilesX86) {
        return $null
    }

    $sdkIncludeRoot = Join-Path $programFilesX86 "Windows Kits\10\Include"
    if (-not (Test-Path $sdkIncludeRoot)) {
        return $null
    }

    $minimum = [version]"10.0.22621.0"
    $versions = Get-ChildItem $sdkIncludeRoot -Directory |
        ForEach-Object {
            try {
                [pscustomobject]@{ Text = $_.Name; Version = [version]$_.Name }
            } catch {
                $null
            }
        } |
        Where-Object { $_ -and $_.Version -ge $minimum } |
        Sort-Object Version -Descending

    if ($versions.Count -eq 0) {
        return $null
    }

    return $versions[0].Text
}

function Resolve-VcVars {
    param(
        [Parameter(Mandatory = $true)][string]$MSBuildPath,
        [Parameter(Mandatory = $true)][string]$Arch
    )

    $msbuildBin = Split-Path $MSBuildPath -Parent
    $vsRoot = (Resolve-Path (Join-Path $msbuildBin "..\..\..")).Path
    $vcvarsAll = Join-Path $vsRoot "VC\Auxiliary\Build\vcvarsall.bat"
    if (-not (Test-Path $vcvarsAll)) {
        return $null
    }

    $vcvarsName = switch ($Arch) {
        "x86" { "vcvars32.bat" }
        "ARM64" { "vcvarsamd64_arm64.bat" }
        default { "vcvars64.bat" }
    }

    $vcvars = Join-Path $vsRoot "VC\Auxiliary\Build\$vcvarsName"
    if (Test-Path $vcvars) {
        return $vcvars
    }

    return $null
}

function Invoke-PackageScript {
    param([Parameter(Mandatory = $true)][string]$Target)

    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        (Join-Path $NativeRoot "scripts\package-native.ps1"),
        "-Platform",
        $Target,
        "-Configuration",
        $Configuration
    )

    if ($Target -eq "windows") {
        $arguments += @("-WindowsArch", $WindowsArch)
    }

    Invoke-External -FilePath "pwsh" -Arguments $arguments
}

function Invoke-AndroidGate {
    Invoke-NpmScript "bundle:android"

    $androidRoot = Join-Path $NativeRoot "android"
    $gradlew = if ($IsWindows) { ".\gradlew.bat" } else { "./gradlew" }
    if (-not (Test-Path (Join-Path $androidRoot $gradlew))) {
        throw "Android Gradle wrapper is missing under $androidRoot"
    }

    if (-not (Resolve-AndroidSdk)) {
        Add-UnavailableTooling "android" "Android SDK" "Set ANDROID_HOME, ANDROID_SDK_ROOT, or android\local.properties sdk.dir before running assemble$Configuration."
        return
    }

    if (-not (Test-HostCommand "java")) {
        Add-UnavailableTooling "android" "JDK java executable" "Install a JDK and ensure java is on PATH before running assemble$Configuration."
        return
    }

    if ($Configuration -eq "Release" -and -not $env:ANDROID_UPLOAD_STORE_FILE) {
        Write-Host "[android] ANDROID_UPLOAD_* signing environment variables are not set; Gradle will produce unsigned release artifacts."
    }

    Invoke-External -FilePath $gradlew -Arguments @("assemble$Configuration") -WorkingDirectory $androidRoot
}

function Invoke-IosGate {
    if (-not $IsMacOS) {
        Add-UnavailableTooling "ios" "macOS host with xcodebuild" "iOS builds require macOS and Xcode."
        return
    }
    if (-not (Test-HostCommand "xcodebuild")) {
        Add-UnavailableTooling "ios" "xcodebuild" "Install Xcode command line tools before running the iOS build gate."
        return
    }
    if (-not (Test-HostCommand "pod")) {
        Add-UnavailableTooling "ios" "CocoaPods pod" "Install CocoaPods before running the iOS build gate."
        return
    }

    Invoke-PackageScript "ios"
}

function Invoke-WindowsGate {
    Invoke-NpmScript "bundle:windows"

    if (-not $IsWindows) {
        Add-UnavailableTooling "windows" "Windows host with Visual Studio Build Tools" "Windows MSIX builds require Windows."
        return
    }

    $msbuild = Resolve-MSBuild
    if (-not $msbuild) {
        Add-UnavailableTooling "windows" "MSBuild.exe" "Install Visual Studio Build Tools with React Native Windows/MSIX workloads."
        return
    }

    if (-not (Resolve-WindowsSdkVersion)) {
        Add-UnavailableTooling "windows" "Windows SDK >= 10.0.22621.0" "Install a compatible Windows 10/11 SDK."
        return
    }

    if (-not (Test-HostCommand "node")) {
        Add-UnavailableTooling "windows" "Node.js" "Install Node.js and ensure node is on PATH."
        return
    }

    if (-not (Resolve-VcVars -MSBuildPath $msbuild -Arch $WindowsArch)) {
        Add-UnavailableTooling "windows" "Visual C++ vcvars for $WindowsArch" "Install the Desktop development with C++ workload."
        return
    }

    Invoke-PackageScript "windows"
}

function Invoke-MacOSGate {
    if (-not $IsMacOS) {
        Add-UnavailableTooling "macos" "macOS host with xcodebuild" "macOS app builds require macOS and Xcode."
        return
    }
    if (-not (Test-HostCommand "xcodebuild")) {
        Add-UnavailableTooling "macos" "xcodebuild" "Install Xcode command line tools before running the macOS build gate."
        return
    }
    if (-not (Test-HostCommand "pod")) {
        Add-UnavailableTooling "macos" "CocoaPods pod" "Install CocoaPods before running the macOS build gate."
        return
    }

    Invoke-PackageScript "macos"
}

if ($RunQualityGates) {
    Invoke-NpmScript "typecheck"
    Invoke-NpmScript "lint"
    Invoke-NpmScript "test" @("--runInBand")
    Invoke-NpmScript "test:windows" @("--runInBand")
}

Invoke-NpmScript "check:packaging"

$targets = if ($Platform -eq "all") {
    @("android", "ios", "windows", "macos")
} else {
    @($Platform)
}

foreach ($target in $targets) {
    switch ($target) {
        "android" { Invoke-AndroidGate }
        "ios" { Invoke-IosGate }
        "windows" { Invoke-WindowsGate }
        "macos" { Invoke-MacOSGate }
    }
}

if ($Unavailable.Count -gt 0) {
    Write-Host "[gate] Unavailable platform tooling:"
    foreach ($message in $Unavailable) {
        Write-Host "[gate] $message"
    }
}

Write-Host "[gate] Native device/build gates completed for $($targets -join ', ')."
