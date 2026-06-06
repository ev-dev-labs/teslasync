#requires -Version 7
<#
.SYNOPSIS
  P1/S2/0001 runner — generate typed API clients (Kotlin + C#) from the OpenAPI contract,
  or run the drift gate.

.DESCRIPTION
  Wraps the deterministic emitter `apps/tools/codegen/gen-clients.ts`:
    * default  — (re)write the Kotlin + C# generated clients.
    * -Check   — drift gate: regenerate and diff vs committed output; non-zero on drift.
    * -Gate    — GEN, then real compile checks (Kotlin via pinned standalone kotlinc, C# via a tiny
                 generated-only csproj), then the drift gate; append the structured P1/S2/0001 log
                 and end it with EXIT=<int> / STATUS=<DONE|BLOCKED>.

  Run from the repo root:
    pwsh apps/tools/codegen/gen-clients.ps1 -Gate

  Note: the canonical Kotlin gate `./gradlew :core:compileKotlinMetadata` requires the P1/S3 KMP
  scaffold. Until S3 lands, -Gate runs an EQUIVALENT real compile (same compiler/libs, explicit-api
  strict) via apps/tools/codegen/verify/kotlin/compile-check.ps1.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Gate
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..' '..')).Path
Set-Location $repoRoot

$tool = 'apps/tools/codegen/gen-clients.ts'
$tsx = 'tsx@4.22.4' # pinned runner for reproducible generation

if (-not $Gate) {
  if ($Check) { npx --yes $tsx $tool --check } else { npx --yes $tsx $tool }
  exit $LASTEXITCODE
}

# ── Gate ────────────────────────────────────────────────────────────────────
$log = Join-Path $repoRoot '.github/prompts/monorepo/logs/p1-s2-0001-codegen.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

"P1/S2/0001 client codegen from OpenAPI — artifact log" | Set-Content $log
"spec: api/openapi/teslasync.openapi.json (OpenAPI 3.1, 9 schemas, 532 operations)" | Tee-Object $log -Append
"generator: custom SI-aware emitter (per prompt allowance); pinned toolchain in codegen.config.json" | Tee-Object $log -Append
"=== GATE ===" | Tee-Object $log -Append

# 1. generate
npx --yes $tsx $tool 2>&1 | Tee-Object $log -Append
$genExit = $LASTEXITCODE
"GEN_EXIT=$genExit" | Tee-Object $log -Append

# 2. Kotlin compile.
#    Canonical gate is `./gradlew :core:compileKotlinMetadata` — runnable once the P1/S3 KMP
#    scaffold exists. The umbrella metadata task is NO-SOURCE in this Kotlin/MP version, so we also
#    run `:core:compileCommonMainKotlinMetadata`, which actually compiles the generated commonMain
#    sources (explicitApi + serialization plugin). If the scaffold is absent, fall back to an
#    equivalent standalone kotlinc compile and report BLOCKED on the missing predecessor.
$sharedDir = Join-Path $repoRoot 'apps/shared'
$coreBuild = Join-Path $repoRoot 'apps/shared/core/build.gradle.kts'
$gradlewBat = Join-Path $sharedDir 'gradlew.bat'
$gradlewSh = Join-Path $sharedDir 'gradlew'
$canonicalKt = (Test-Path $coreBuild) -and ((Test-Path $gradlewBat) -or (Test-Path $gradlewSh))
if ($canonicalKt) {
  "KT: canonical ./gradlew :core:compileKotlinMetadata :core:compileCommonMainKotlinMetadata" | Tee-Object $log -Append
  Push-Location $sharedDir
  $gw = if (Test-Path $gradlewBat) { '.\gradlew.bat' } else { './gradlew' }
  & $gw :core:compileKotlinMetadata :core:compileCommonMainKotlinMetadata --no-daemon --console=plain 2>&1 | Tee-Object $log -Append
  $ktExit = $LASTEXITCODE
  Pop-Location
  $ktBlocked = $false
} else {
  "KT: canonical './gradlew :core:compileKotlinMetadata' UNAVAILABLE — P1/S3 KMP scaffold absent." | Tee-Object $log -Append
  "    Running equivalent standalone kotlinc 2.4.0 (serialization plugin, explicit-api=strict)." | Tee-Object $log -Append
  pwsh -NoProfile -File 'apps/tools/codegen/verify/kotlin/compile-check.ps1' 2>&1 | Tee-Object $log -Append
  $ktExit = $LASTEXITCODE
  $ktBlocked = $true
}
"KT_EXIT=$ktExit" | Tee-Object $log -Append

# 3. C# real compile (tiny generated-only csproj, in-box net10)
dotnet build apps/tools/codegen/verify/csharp/Verify.csproj -c Release --nologo 2>&1 | Tee-Object $log -Append
$csExit = $LASTEXITCODE
"CS_EXIT=$csExit" | Tee-Object $log -Append

# 4. drift gate
npx --yes $tsx $tool --check 2>&1 | Tee-Object $log -Append
$driftExit = $LASTEXITCODE
"DRIFT_EXIT=$driftExit" | Tee-Object $log -Append

$anyRed = ($genExit -ne 0) -or ($ktExit -ne 0) -or ($csExit -ne 0) -or ($driftExit -ne 0)
if ($anyRed) {
  "[FAIL] gen=$genExit kt=$ktExit cs=$csExit drift=$driftExit" | Tee-Object $log -Append
  "EXIT=1" | Tee-Object $log -Append
  "STATUS=BLOCKED" | Tee-Object $log -Append
  exit 1
}

if ($ktBlocked) {
  "[PASS-equivalent] all runnable checks green (gen, equivalent-kotlinc, c#, drift)." | Tee-Object $log -Append
  "[BLOCKED] canonical ':core:compileKotlinMetadata' acceptance deferred until P1/S3 lands." | Tee-Object $log -Append
  "EXIT=1" | Tee-Object $log -Append
  "STATUS=BLOCKED" | Tee-Object $log -Append
  exit 1
}

"[PASS] clients generated; Kotlin (:core) + C# compile; drift gate clean." | Tee-Object $log -Append
"EXIT=0" | Tee-Object $log -Append
"STATUS=DONE" | Tee-Object $log -Append
exit 0
