#!/usr/bin/env pwsh
# P1/S2 — Reproducible client codegen from the frozen OpenAPI 3.1 contract (ADR-003/ADR-004).
#
# Emits kotlinx.serialization data classes for every component schema in
# api/openapi/teslasync.openapi.json into the shared KMP core. Generated code is
# never hand-edited; re-run this script (or `-Check`) to regenerate / drift-gate.
#
#   ./gen-clients.ps1            # (re)generate the Kotlin client into the core module
#   ./gen-clients.ps1 -Check     # regenerate to a temp dir and diff; non-empty diff => exit 1
#
# Type mapping (OpenAPI -> Kotlin):
#   string                      -> String
#   string  (format date-time)  -> kotlin.time.Instant
#   number                      -> Double
#   integer                     -> Long      (Go int64 ids/counters)
#   boolean                     -> Boolean
#   not-required OR type union with "null" -> nullable (`T? = null`)
#
# JSON wire names stay snake_case via @SerialName; Kotlin properties are camelCase.

[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$specPath = Join-Path $repoRoot 'api/openapi/teslasync.openapi.json'
$kotlinPkgPath = 'apps/shared/core/src/commonMain/kotlin/io/teslasync/shared/core/api/generated'
$kotlinOutDir = Join-Path $repoRoot $kotlinPkgPath
$kotlinPackage = 'io.teslasync.shared.core.api.generated'

if (-not (Test-Path $specPath)) {
    Write-Error "OpenAPI spec not found at $specPath"
}

function ConvertTo-CamelCase {
    param([string]$Name)
    $parts = @($Name -split '_' | Where-Object { $_ -ne '' })
    if ($parts.Count -eq 0) { return $Name }
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append($parts[0].ToLowerInvariant())
    for ($i = 1; $i -lt $parts.Count; $i++) {
        $p = $parts[$i]
        [void]$sb.Append($p.Substring(0, 1).ToUpperInvariant())
        if ($p.Length -gt 1) { [void]$sb.Append($p.Substring(1).ToLowerInvariant()) }
    }
    return $sb.ToString()
}

function Get-PropertyTyping {
    param($Prop, [bool]$Required)

    # `type` is either a scalar ("string") or a union array (["number","null"]).
    $types = @($Prop.type)
    $nonNull = @($types | Where-Object { $_ -ne 'null' })
    $nullableByUnion = ($types -contains 'null')
    $baseJson = if ($nonNull.Count -gt 0) { [string]$nonNull[0] } else { 'string' }

    $format = $null
    if ($Prop.PSObject.Properties.Name -contains 'format') { $format = [string]$Prop.format }

    $kotlin = switch ($baseJson) {
        'string' { if ($format -eq 'date-time') { 'Instant' } else { 'String' } }
        'number' { 'Double' }
        'integer' { 'Long' }
        'boolean' { 'Boolean' }
        default { 'String' }
    }

    $nullable = (-not $Required) -or $nullableByUnion
    return [pscustomobject]@{
        Kotlin = $kotlin
        Nullable = $nullable
        UsesInstant = ($kotlin -eq 'Instant')
    }
}

function New-SchemaSource {
    param([string]$Name, $Schema)

    $required = @()
    if ($Schema.PSObject.Properties.Name -contains 'required' -and $null -ne $Schema.required) {
        $required = @($Schema.required)
    }

    $props = @()
    $usesInstant = $false
    if ($Schema.PSObject.Properties.Name -contains 'properties' -and $null -ne $Schema.properties) {
        foreach ($p in $Schema.properties.PSObject.Properties) {
            $isReq = $required -contains $p.Name
            $typing = Get-PropertyTyping -Prop $p.Value -Required $isReq
            if ($typing.UsesInstant) { $usesInstant = $true }
            $kType = $typing.Kotlin + $(if ($typing.Nullable) { '?' } else { '' })
            $default = if ($typing.Nullable) { ' = null' } else { '' }
            $props += [pscustomobject]@{
                Json = $p.Name
                Kotlin = (ConvertTo-CamelCase -Name $p.Name)
                Type = $kType
                Default = $default
            }
        }
    }

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('// GENERATED — DO NOT EDIT.')
    [void]$sb.AppendLine("// Source: api/openapi/teslasync.openapi.json (schema $Name)")
    [void]$sb.AppendLine("// Regenerate via apps/tools/codegen/gen-clients.ps1 (ADR-003/ADR-004).")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("package $kotlinPackage")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('import kotlinx.serialization.SerialName')
    [void]$sb.AppendLine('import kotlinx.serialization.Serializable')
    if ($usesInstant) { [void]$sb.AppendLine('import kotlin.time.Instant') }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('@Serializable')
    if ($props.Count -eq 0) {
        [void]$sb.AppendLine("public class $Name")
    } else {
        [void]$sb.AppendLine("public data class $Name(")
        for ($i = 0; $i -lt $props.Count; $i++) {
            $p = $props[$i]
            $comma = if ($i -lt $props.Count - 1) { ',' } else { ',' }
            [void]$sb.AppendLine("    @SerialName(`"$($p.Json)`") public val $($p.Kotlin): $($p.Type)$($p.Default)$comma")
        }
        [void]$sb.AppendLine(')')
    }
    return $sb.ToString()
}

function Write-GeneratedClient {
    param([string]$OutDir)

    if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

    $spec = Get-Content $specPath -Raw | ConvertFrom-Json
    $schemas = $spec.components.schemas
    $count = 0
    foreach ($s in $schemas.PSObject.Properties) {
        $src = New-SchemaSource -Name $s.Name -Schema $s.Value
        $file = Join-Path $OutDir ($s.Name + '.kt')
        # Normalize to LF so the drift gate is stable across hosts.
        [System.IO.File]::WriteAllText($file, ($src -replace "`r`n", "`n"))
        $count++
    }
    return $count
}

if ($Check) {
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("teslasync-codegen-" + [guid]::NewGuid().ToString('N'))
    [void](Write-GeneratedClient -OutDir $tmp)
    $drift = $false
    $existing = @{}
    if (Test-Path $kotlinOutDir) {
        Get-ChildItem -Path $kotlinOutDir -Filter *.kt | ForEach-Object { $existing[$_.Name] = $_.FullName }
    }
    $generated = Get-ChildItem -Path $tmp -Filter *.kt
    foreach ($g in $generated) {
        if (-not $existing.ContainsKey($g.Name)) {
            Write-Host "DRIFT: missing committed file $($g.Name)"
            $drift = $true
            continue
        }
        $a = [System.IO.File]::ReadAllText($existing[$g.Name]) -replace "`r`n", "`n"
        $b = [System.IO.File]::ReadAllText($g.FullName) -replace "`r`n", "`n"
        if ($a -ne $b) { Write-Host "DRIFT: $($g.Name) differs from spec"; $drift = $true }
    }
    foreach ($name in $existing.Keys) {
        if (-not ($generated.Name -contains $name)) { Write-Host "DRIFT: stale committed file $name"; $drift = $true }
    }
    Remove-Item -Recurse -Force $tmp
    if ($drift) { Write-Error 'Generated client is stale vs the OpenAPI spec. Run gen-clients.ps1.'; exit 1 }
    Write-Host 'Codegen drift gate: OK (generated output matches spec).'
    exit 0
}

$n = Write-GeneratedClient -OutDir $kotlinOutDir
Write-Host "Generated $n Kotlin schema(s) into $kotlinPkgPath"
