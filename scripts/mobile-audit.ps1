<#
.SYNOPSIS
  Mobile / responsive breakpoint audit for the TeslaSync web frontend.

.DESCRIPTION
  Runs four checks and writes a markdown report to docs/audits/mobile-audit.md:

    1. Pages that use multi-column grids without a `grid-cols-1` base.
    2. Tables that aren't wrapped in `overflow-x-auto`.
    3. Fixed pixel widths (`w-[NNNpx]` / `min-w-[NNNpx]`) in features.
    4. Files that render `<Modal>` (need full-screen review on <sm).

  Run from the repo root:
      pwsh scripts/mobile-audit.ps1

  Exit code is always 0 — this script reports, it does not gate.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$OutFile  = "docs/audits/mobile-audit.md"
)

Set-Location $RepoRoot
$outPath = Join-Path $RepoRoot $OutFile
New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null

function Rel([string]$p) { $p.Replace($RepoRoot + [IO.Path]::DirectorySeparatorChar, '') }

# --- 1. Pages without grid-cols-1 base -----------------------------------------
$pages = Get-ChildItem -Recurse -Path web\src\features -Filter "*.tsx" `
         | Where-Object { $_.FullName -match "[\\/]pages[\\/]" }
$missingGridBase = @()
foreach ($p in $pages) {
  $content = Get-Content $p.FullName -Raw
  $usesMulti = $content -match "grid-cols-[2-9]|md:grid-cols|lg:grid-cols"
  # A page is mobile-first if it has any of: a literal `grid-cols-1`, or a
  # `<Grid cols={{ default: 1`, or no multi-column grid at all. The `<Grid>`
  # shared component (web/src/components/layout/Grid.tsx) compiles
  # `default: 1` to `grid-cols-1` at runtime, so grep won't see it in source.
  $hasBase   = ($content -match "grid-cols-1\b") `
               -or ($content -match "<Grid\s+cols=\{\{\s*default:\s*1\b")
  if ($usesMulti -and -not $hasBase) {
    $missingGridBase += (Rel $p.FullName)
  }
}

# --- 2. Files with tables but no overflow-x-auto -------------------------------
$tableFiles = Get-ChildItem -Recurse -Path web\src\features -Filter "*.tsx" `
              | Select-String -Pattern "<table\b|<DataTable\b" -List `
              | ForEach-Object { $_.Path }
$missingOverflow = @()
foreach ($f in $tableFiles) {
  $content = Get-Content $f -Raw
  if ($content -notmatch "overflow-x-auto") {
    $missingOverflow += (Rel $f)
  }
}

# --- 3. Fixed pixel widths in features -----------------------------------------
$fixedWidths = Get-ChildItem -Recurse -Path web\src\features -Filter "*.tsx" `
               | Select-String -Pattern "w-\[\d{3,}px\]|min-w-\[\d{3,}px\]"
$fixedWidthRows = $fixedWidths | ForEach-Object {
  [pscustomobject]@{
    File = (Rel $_.Path)
    Line = $_.LineNumber
    Code = $_.Line.Trim()
  }
}

# --- 4. Modal usages -----------------------------------------------------------
$modalFiles = Get-ChildItem -Recurse -Path web\src\features -Filter "*.tsx" `
              | Select-String -Pattern "<Modal\b" -List `
              | ForEach-Object { Rel $_.Path }

# --- Write the report ----------------------------------------------------------
$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$lines = @()
$lines += "# Mobile / Responsive Audit"
$lines += ""
$lines += "Generated: ``$ts`` UTC by ``scripts/mobile-audit.ps1``."
$lines += ""
$lines += "See [MOBILE_GUIDELINES.md](../MOBILE_GUIDELINES.md) for the breakpoint policy."
$lines += ""
$lines += "## Summary"
$lines += ""
$lines += "| Check | Count |"
$lines += "|-------|------:|"
$lines += "| Pages without ``grid-cols-1`` base | $($missingGridBase.Count) |"
$lines += "| Files with tables missing ``overflow-x-auto`` | $($missingOverflow.Count) |"
$lines += "| Fixed pixel widths in features | $($fixedWidthRows.Count) |"
$lines += "| Files using ``<Modal>`` (review for full-screen on <sm) | $($modalFiles.Count) |"
$lines += ""

$lines += "## 1. Pages without ``grid-cols-1`` base"
$lines += ""
$lines += "These pages use multi-column grids (``grid-cols-2+`` or ``md:grid-cols-*``) without a ``grid-cols-1`` base, so they may not stack cleanly on phones."
$lines += ""
if ($missingGridBase.Count -eq 0) {
  $lines += "_None — all pages start mobile-first._"
} else {
  foreach ($f in $missingGridBase | Sort-Object) { $lines += "- ``$f``" }
}
$lines += ""

$lines += "## 2. Files with tables missing ``overflow-x-auto``"
$lines += ""
$lines += "Tables containing many columns will clip on narrow viewports without horizontal scroll. Wrap raw ``<table>`` elements in ``<div class=""overflow-x-auto"">`` or migrate to ``<DataTable>`` (which already wraps)."
$lines += ""
if ($missingOverflow.Count -eq 0) {
  $lines += "_None — every table is wrapped._"
} else {
  foreach ($f in $missingOverflow | Sort-Object) { $lines += "- ``$f``" }
}
$lines += ""

$lines += "## 3. Fixed pixel widths in features"
$lines += ""
$lines += "Fixed ``w-[NNNpx]`` or ``min-w-[NNNpx]`` over 100px frequently breaks below 640px. Acceptable for icons/avatars; review for layout containers, modals, and chart wrappers."
$lines += ""
if ($fixedWidthRows.Count -eq 0) {
  $lines += "_None._"
} else {
  $lines += "| File | Line | Snippet |"
  $lines += "|------|-----:|---------|"
  foreach ($r in $fixedWidthRows | Sort-Object File, Line) {
    $snippet = $r.Code -replace '\|', '\|'
    if ($snippet.Length -gt 100) { $snippet = $snippet.Substring(0, 97) + '…' }
    $lines += "| ``$($r.File)`` | $($r.Line) | ``$snippet`` |"
  }
}
$lines += ""

$lines += "## 4. ``<Modal>`` usages"
$lines += ""
$lines += "The shared ``<Modal>`` component already forces full-screen on ``<sm``. This list exists so reviewers can spot-check that each modal renders cleanly at 390px wide."
$lines += ""
if ($modalFiles.Count -eq 0) {
  $lines += "_None._"
} else {
  foreach ($f in $modalFiles | Sort-Object) { $lines += "- ``$f``" }
}
$lines += ""

Set-Content -Path $outPath -Value ($lines -join "`n") -Encoding utf8

Write-Host "Wrote $outPath"
Write-Host ""
Write-Host "Counts:"
Write-Host "  Pages missing grid-cols-1 base : $($missingGridBase.Count)"
Write-Host "  Tables missing overflow-x-auto : $($missingOverflow.Count)"
Write-Host "  Fixed pixel widths             : $($fixedWidthRows.Count)"
Write-Host "  Modal usages                   : $($modalFiles.Count)"
exit 0
