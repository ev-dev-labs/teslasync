#!/usr/bin/env pwsh

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$NativeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $NativeRoot "..\..")).Path

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
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

function Test-WindowsCppToolchain {
    $msbuild = Resolve-MSBuild
    if (-not $msbuild) {
        return $false
    }

    $msbuildBin = Split-Path $msbuild -Parent
    $vsRoot = (Resolve-Path (Join-Path $msbuildBin "..\..\..")).Path
    return (Test-Path (Join-Path $vsRoot "VC\Auxiliary\Build\vcvarsall.bat"))
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

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    return Get-Content $Path -Raw | ConvertFrom-Json
}

function Read-ReactNativeConfig {
    $configOutput = & npx react-native config
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read React Native CLI config."
    }

    try {
        return ($configOutput -join "`n") | ConvertFrom-Json
    } catch {
        throw "React Native CLI config was not valid JSON: $($_.Exception.Message)"
    }
}

$packageJson = Get-Content (Join-Path $NativeRoot "package.json") -Raw | ConvertFrom-Json
$scriptNames = @($packageJson.scripts.PSObject.Properties.Name)
$requiredScripts = @(
    "bundle:android",
    "bundle:ios",
    "bundle:windows",
    "bundle:macos",
    "package:android",
    "package:ios",
    "package:windows",
    "package:macos",
    "package:all",
    "check:packaging"
)

foreach ($script in $requiredScripts) {
    Assert-Condition ($scriptNames -contains $script) "Missing npm script: $script"
}

$requiredPaths = @(
    "android\app\build.gradle",
    "ios\TeslaSyncNative.xcodeproj\project.pbxproj",
    "windows\TeslaSyncNative.Package\TeslaSyncNative.Package.wapproj",
    "macos\Podfile",
    "macos\TeslaSyncNative.xcodeproj\project.pbxproj",
    "macos\TeslaSyncNative-macOS\Info.plist",
    "scripts\package-native.ps1",
    "scripts\bundle-native.ps1"
)

foreach ($relativePath in $requiredPaths) {
    Assert-Condition (Test-Path (Join-Path $NativeRoot $relativePath)) "Missing packaging path: $relativePath"
}

$rnConfig = Read-ReactNativeConfig
$registeredPlatforms = @($rnConfig.project.PSObject.Properties.Name)
foreach ($platform in @("android", "ios", "windows", "macos")) {
    Assert-Condition ($registeredPlatforms -contains $platform) "React Native CLI config does not register project.$platform."
}

$rnCommands = @($rnConfig.commands | ForEach-Object { $_.name })
foreach ($command in @("build-macos", "run-macos")) {
    Assert-Condition ($rnCommands -contains $command) "react-native-macos CLI command is unavailable: $command"
}

$rnMacOSPackagePath = Join-Path $NativeRoot "node_modules\react-native-macos\package.json"
Assert-Condition (Test-Path $rnMacOSPackagePath) "react-native-macos package is not installed under node_modules."
$rnMacOSPackage = Read-JsonFile $rnMacOSPackagePath
Assert-Condition ($rnMacOSPackage.version -like "$($rnConfig.reactNativeVersion).*") "react-native-macos $($rnMacOSPackage.version) does not match React Native $($rnConfig.reactNativeVersion).x."

$macOSProject = $rnConfig.project.macos
Assert-Condition ($null -ne $macOSProject.sourceDir -and $macOSProject.sourceDir -like "*\macos") "React Native CLI config does not point macOS sourceDir at apps\native\macos."
Assert-Condition ($null -ne $macOSProject.xcodeProject -and $macOSProject.xcodeProject.name -eq "TeslaSyncNative.xcodeproj") "React Native CLI config does not detect the macOS Xcode project."

$macOSPbxproj = Get-Content (Join-Path $NativeRoot "macos\TeslaSyncNative.xcodeproj\project.pbxproj") -Raw
Assert-Condition ($macOSPbxproj -match "TeslaSyncNative-macOS") "macOS Xcode project is missing the TeslaSyncNative-macOS target."
Assert-Condition ($macOSPbxproj -match "SDKROOT = macosx;") "macOS Xcode project is not targeting the macOS SDK."
Assert-Condition ($macOSPbxproj -match "react-native-macos/scripts/react-native-xcode\.sh") "macOS Xcode project is not wired to the react-native-macos bundle phase."

$gradle = Get-Content (Join-Path $NativeRoot "android\app\build.gradle") -Raw
Assert-Condition ($gradle -match "ANDROID_UPLOAD_STORE_FILE") "Android release signing must be driven by ANDROID_UPLOAD_* environment variables."
$buildTypesStart = $gradle.IndexOf("buildTypes {")
$releaseBuildStart = if ($buildTypesStart -ge 0) { $gradle.IndexOf("release {", $buildTypesStart) } else { -1 }
$dependenciesStart = if ($releaseBuildStart -ge 0) { $gradle.IndexOf("dependencies {", $releaseBuildStart) } else { -1 }
Assert-Condition ($releaseBuildStart -ge 0 -and $dependenciesStart -gt $releaseBuildStart) "Unable to locate Android release build type."
$releaseBuildSection = $gradle.Substring($releaseBuildStart, $dependenciesStart - $releaseBuildStart)
Assert-Condition ($releaseBuildSection -notmatch "signingConfig\s+signingConfigs\.debug") "Android release builds must not use the debug keystore."

$trackedFiles = & git -C $RepoRoot ls-files apps/native
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect tracked files for signing material."
}

$forbiddenSigningFiles = @(
    $trackedFiles |
        Where-Object { $_ -match '\.(p12|pfx|cer|mobileprovision|provisionprofile|pem|key|jks|keystore)$' } |
        Where-Object { $_ -notmatch '/debug\.keystore$' }
)

Assert-Condition ($forbiddenSigningFiles.Count -eq 0) "Signing material is tracked in git: $($forbiddenSigningFiles -join ', ')"

Write-Host "[packaging] Static packaging checks passed."
Write-Host "[packaging] React Native version: $($rnConfig.reactNativeVersion)"
Write-Host "[packaging] React Native config platforms: $($registeredPlatforms -join ', ')"
Write-Host "[packaging] react-native-macos version: $($rnMacOSPackage.version)"
Write-Host "[packaging] react-native-macos commands: build-macos=$($rnCommands -contains 'build-macos'), run-macos=$($rnCommands -contains 'run-macos')"
Write-Host "[packaging] Android Gradle wrapper: $((Test-Path (Join-Path $NativeRoot 'android\gradlew.bat')) -or (Test-Path (Join-Path $NativeRoot 'android\gradlew')))"
Write-Host "[packaging] Android SDK available: $([bool](Resolve-AndroidSdk))"
Write-Host "[packaging] xcodebuild available: $(Test-HostCommand 'xcodebuild')"
Write-Host "[packaging] CocoaPods available: $(Test-HostCommand 'pod')"
Write-Host "[packaging] MSBuild available: $([bool](Resolve-MSBuild))"
Write-Host "[packaging] Windows C++ vcvars available: $(Test-WindowsCppToolchain)"
Write-Host "[packaging] Windows SDK >= 10.0.22621.0: $(Resolve-WindowsSdkVersion)"
