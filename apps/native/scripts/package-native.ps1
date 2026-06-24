#!/usr/bin/env pwsh

[CmdletBinding()]
param(
    [ValidateSet("all", "android", "ios", "windows", "macos")]
    [string]$Platform = "all",

    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [ValidateSet("x86", "x64", "ARM64")]
    [string]$WindowsArch = "x64"
)

$ErrorActionPreference = "Stop"
$NativeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $NativeRoot

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
    param([Parameter(Mandatory = $true)][string]$Name)
    Invoke-External -FilePath "npm" -Arguments @("run", $Name)
}

function Test-HostCommand {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
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

function Resolve-NodeExecutable {
    $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if ($node) {
        return $node.Source
    }

    $node = Get-Command "node" -ErrorAction SilentlyContinue
    if ($node) {
        return $node.Source
    }

    return $null
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

function ConvertTo-CmdArgument {
    param([Parameter(Mandatory = $true)][string]$Argument)

    if ($Argument -match '[\s&()^|<>"]') {
        return '"' + ($Argument -replace '"', '\"') + '"'
    }

    return $Argument
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

function Invoke-AndroidPackage {
    $androidRoot = Join-Path $NativeRoot "android"
    $gradlew = if ($IsWindows) { ".\gradlew.bat" } else { "./gradlew" }
    if (-not (Test-Path (Join-Path $androidRoot $gradlew))) {
        throw "Android Gradle wrapper is missing under $androidRoot"
    }

    Invoke-NpmScript "bundle:android"

    $androidSdk = Resolve-AndroidSdk
    if (-not $androidSdk) {
        Write-Host "[android] SKIP: Android SDK was not found. Set ANDROID_HOME, ANDROID_SDK_ROOT, or android\local.properties sdk.dir to build APK/AAB artifacts."
        return
    }

    if ($Configuration -eq "Release" -and -not $env:ANDROID_UPLOAD_STORE_FILE) {
        Write-Host "[android] ANDROID_UPLOAD_* signing environment variables are not set; Gradle will produce unsigned release artifacts."
    }

    Invoke-External -FilePath $gradlew -Arguments @("assemble$Configuration") -WorkingDirectory $androidRoot
}

function Invoke-IosPackage {
    if (-not $IsMacOS) {
        Write-Host "[ios] SKIP: iOS build/package requires a macOS host with Xcode."
        return
    }

    if (-not (Test-HostCommand "xcodebuild")) {
        throw "xcodebuild is required for iOS packaging."
    }
    if (-not (Test-HostCommand "pod")) {
        throw "CocoaPods 'pod' is required for iOS packaging."
    }

    Invoke-NpmScript "bundle:ios"
    Invoke-External -FilePath "pod" -Arguments @("install", "--project-directory=ios")

    $extraParams = if ($env:IOS_DEVELOPMENT_TEAM) {
        "DEVELOPMENT_TEAM=$($env:IOS_DEVELOPMENT_TEAM)"
    } else {
        "CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="
    }

    Invoke-External -FilePath "npx" -Arguments @(
        "react-native",
        "build-ios",
        "--mode",
        $Configuration,
        "--scheme",
        "TeslaSyncNative",
        "--extra-params",
        $extraParams
    )
}

function Invoke-WindowsPackage {
    Invoke-NpmScript "bundle:windows"

    if (-not $IsWindows) {
        Write-Host "[windows] SKIP: Windows MSIX packaging requires a Windows host with Visual Studio Build Tools."
        return
    }

    $msbuild = Resolve-MSBuild
    if (-not $msbuild) {
        Write-Host "[windows] SKIP: MSBuild was not found. Install Visual Studio Build Tools with MSIX packaging workload to build the package."
        return
    }

    $windowsSdkVersion = Resolve-WindowsSdkVersion
    if (-not $windowsSdkVersion) {
        Write-Host "[windows] SKIP: Windows SDK 10.0.22621.0 or newer was not found. Install a compatible Windows 10/11 SDK to build the package."
        return
    }

    $node = Resolve-NodeExecutable
    if (-not $node) {
        Write-Host "[windows] SKIP: Node.js was not found in PATH; it is required for RNW package bundling."
        return
    }
    $nodeShim = Join-Path $NativeRoot "windows\tools\node.cmd"
    if (-not (Test-Path $nodeShim)) {
        throw "Windows Node shim was not found at $nodeShim"
    }
    $communityCli = Join-Path $NativeRoot "node_modules\@react-native-community\cli\build\bin.js"
    if (-not (Test-Path $communityCli)) {
        throw "React Native community CLI was not found at $communityCli"
    }
    $env:PATH = "$(Split-Path $node);$env:PATH"
    $bundleCliCommand = "$nodeShim $communityCli bundle"
    $autolinkCommand = "$nodeShim $communityCli autolink-windows"
    $codegenCommand = "$nodeShim $communityCli codegen-windows"

    $solution = Join-Path $NativeRoot "windows\TeslaSyncNative.sln"
    $windowsBuildOutput = Join-Path $NativeRoot "windows\build\$Configuration\$WindowsArch\"
    New-Item -ItemType Directory -Force -Path $windowsBuildOutput | Out-Null

    $props = @(
        $solution,
        "/restore",
        "/p:Configuration=$Configuration",
        "/p:Platform=$WindowsArch",
        "/p:OutDir=$windowsBuildOutput",
        "/p:OutputPath=$windowsBuildOutput",
        "/p:BundleCommandWorkingDir=$NativeRoot",
        "/p:BundleCliCommand=$bundleCliCommand",
        "/p:AutolinkCommandWorkingDir=$NativeRoot",
        "/p:AutolinkCommand=$autolinkCommand",
        "/p:CodegenCommandWorkingDir=$NativeRoot",
        "/p:CodegenCommand=$codegenCommand",
        "/p:NodeExe=$nodeShim",
        "/p:WindowsTargetPlatformVersion=$windowsSdkVersion",
        "/p:TargetPlatformVersion=$windowsSdkVersion",
        "/p:AppxBundle=Always",
        "/p:AppxBundlePlatforms=$WindowsArch",
        "/p:UapAppxPackageBuildMode=StoreUpload"
    )

    if ($env:WINDOWS_PACKAGE_CERTIFICATE_KEY_FILE) {
        $props += @(
            "/p:AppxPackageSigningEnabled=true",
            "/p:PackageCertificateKeyFile=$($env:WINDOWS_PACKAGE_CERTIFICATE_KEY_FILE)"
        )
        if ($env:WINDOWS_PACKAGE_CERTIFICATE_PASSWORD) {
            $props += "/p:PackageCertificatePassword=$($env:WINDOWS_PACKAGE_CERTIFICATE_PASSWORD)"
        }
    } else {
        Write-Host "[windows] WINDOWS_PACKAGE_CERTIFICATE_KEY_FILE is not set; building an unsigned MSIX package."
        $props += "/p:AppxPackageSigningEnabled=false"
    }

    $vcvars = Resolve-VcVars -MSBuildPath $msbuild -Arch $WindowsArch
    if (-not $vcvars) {
        Write-Host "[windows] SKIP: Visual C++ v143 vcvars environment was not found. Install the Desktop development with C++ workload to build the MSIX package."
        return
    }

    $msbuildArgs = ($props | ForEach-Object { ConvertTo-CmdArgument $_ }) -join " "
    Invoke-External -FilePath $env:ComSpec -Arguments @("/d", "/s", "/c", "call `"$vcvars`" >nul && `"$msbuild`" $msbuildArgs")
}

function Invoke-MacOSPackage {
    if (-not $IsMacOS) {
        Write-Host "[macos] SKIP: macOS build/package requires a macOS host with Xcode."
        return
    }

    if (-not (Test-HostCommand "xcodebuild")) {
        throw "xcodebuild is required for macOS packaging."
    }
    if (-not (Test-HostCommand "pod")) {
        throw "CocoaPods 'pod' is required for macOS packaging."
    }

    Invoke-NpmScript "bundle:macos"
    Invoke-External -FilePath "pod" -Arguments @("install", "--project-directory=macos")

    $buildArgs = @(
        "-project",
        "macos\TeslaSyncNative.xcodeproj",
        "-scheme",
        "TeslaSyncNative-macOS",
        "-configuration",
        $Configuration,
        "build"
    )

    if ($env:MACOS_DEVELOPMENT_TEAM -and $env:MACOS_CODE_SIGN_IDENTITY) {
        $buildArgs += @(
            "DEVELOPMENT_TEAM=$($env:MACOS_DEVELOPMENT_TEAM)",
            "CODE_SIGN_IDENTITY=$($env:MACOS_CODE_SIGN_IDENTITY)"
        )
    } else {
        Write-Host "[macos] MACOS_DEVELOPMENT_TEAM/MACOS_CODE_SIGN_IDENTITY are not set; building without code signing."
        $buildArgs += @("CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=")
    }

    Invoke-External -FilePath "xcodebuild" -Arguments $buildArgs
}

$platforms = if ($Platform -eq "all") {
    @("android", "ios", "windows", "macos")
} else {
    @($Platform)
}

foreach ($target in $platforms) {
    switch ($target) {
        "android" { Invoke-AndroidPackage }
        "ios" { Invoke-IosPackage }
        "windows" { Invoke-WindowsPackage }
        "macos" { Invoke-MacOSPackage }
    }
}
