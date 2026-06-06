#requires -Version 7
<#
.SYNOPSIS
  P1/S2/0001 — standalone type-check of the generated Kotlin client.

.DESCRIPTION
  The canonical S2 gate command is `./gradlew :core:compileKotlinMetadata`, which requires the
  P1/S3 KMP scaffold (`apps/shared/core` Gradle project). Until S3 lands, this script provides an
  EQUIVALENT real compile: it runs the pinned standalone `kotlinc` (Kotlin 2.4.0, from the version
  lock) with the kotlinx.serialization compiler plugin and kotlinx-serialization-core +
  kotlinx-datetime on the classpath, in `-Xexplicit-api=strict` mode (matching S3's `explicitApi()`).

  This genuinely type-checks the generated models + endpoint descriptors against the same compiler
  and runtime libraries the KMP `commonMain` source set will use. Toolchain is cached under
  `.toolcache` (gitignored); nothing here is shipped.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..' '..' '..' '..')).Path
$genDir = Join-Path $repoRoot 'apps/shared/core/src/commonMain/kotlin/io/teslasync/shared/core/api/generated'
$cache = Join-Path $repoRoot 'apps/tools/codegen/.toolcache'
$libs = Join-Path $cache 'libs'
New-Item -ItemType Directory -Force -Path $cache, $libs | Out-Null

# Pinned versions (apps/versions.lock.md: Kotlin 2.4.0, kotlinx.serialization 1.11.0).
# Generated models use stdlib `kotlin.time.Instant` (kotlinx-datetime 0.7.0 dropped its own Instant);
# its serializer ships in serialization-core, so no datetime jar is required to type-check.
$kotlinVersion = '2.4.0'
$serVersion = '1.11.0'

function Get-File($url, $dest) {
  if (-not (Test-Path $dest)) {
    Write-Host "  downloading $(Split-Path $dest -Leaf)"
    Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 300 -UseBasicParsing
  }
}

# 1. kotlinc distribution
$kotlincHome = Join-Path $cache 'kotlinc'
$kotlincBat = Join-Path $kotlincHome 'bin/kotlinc.bat'
if (-not (Test-Path $kotlincBat)) {
  $zip = Join-Path $cache "kotlin-compiler-$kotlinVersion.zip"
  Get-File "https://github.com/JetBrains/kotlin/releases/download/v$kotlinVersion/kotlin-compiler-$kotlinVersion.zip" $zip
  Write-Host '  expanding kotlin-compiler'
  Expand-Archive -Path $zip -DestinationPath $cache -Force
}
$plugin = Join-Path $kotlincHome 'lib/kotlinx-serialization-compiler-plugin.jar'
if (-not (Test-Path $plugin)) { throw "serialization compiler plugin not found at $plugin" }

# 2. runtime libraries the generated code references
$serJar = Join-Path $libs "kotlinx-serialization-core-jvm-$serVersion.jar"
Get-File "https://repo1.maven.org/maven2/org/jetbrains/kotlinx/kotlinx-serialization-core-jvm/$serVersion/kotlinx-serialization-core-jvm-$serVersion.jar" $serJar

# 3. compile
$sources = Get-ChildItem -Path $genDir -Filter '*.kt' | ForEach-Object { $_.FullName }
if (-not $sources) { throw "no generated Kotlin sources in $genDir" }
$cp = $serJar
$outDir = Join-Path $cache 'kt-out'
Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "  compiling $($sources.Count) Kotlin files with kotlinc $kotlinVersion (explicit-api=strict)"
$srcArgs = ($sources | ForEach-Object { "`"$_`"" }) -join ' '
& cmd /c "`"$kotlincBat`" -cp `"$cp`" `"-Xplugin=$plugin`" -Xexplicit-api=strict -nowarn -d `"$outDir`" $srcArgs"
$code = $LASTEXITCODE
if ($code -eq 0) { Write-Host '[OK] generated Kotlin client type-checks (kotlinx.serialization + datetime).' }
else { Write-Host "[FAIL] kotlinc exited $code" }
exit $code
