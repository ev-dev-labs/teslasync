<#
.SYNOPSIS
  Static accessibility audit for the TeslaSync web frontend.

.DESCRIPTION
  Runs five source-grep checks and writes a markdown report to
  docs/audits/a11y-audit.md:

    1. <button> elements without aria-label and without visible text content.
    2. <Input> usages without a `label` prop or `aria-label`.
    3. <img> elements without an `alt` attribute.
    4. Solid red backgrounds (bg-red-500 / bg-red-600 / bg-red-500/N) with no
       AlertCircle / X / icon nearby — color-only state risk.
    5. framer-motion animations in pages/features that do not reference the
       `useMotionPreference` hook (or `useReducedMotion`) — missing
       prefers-reduced-motion opt-out.

  Run from the repo root:
      pwsh scripts/a11y-audit.ps1

  Exit code is always 0 — this script reports, it does not gate. Add hard
  thresholds in CI later if desired.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$OutFile  = "docs/audits/a11y-audit.md"
)

Set-Location $RepoRoot
$outPath = Join-Path $RepoRoot $OutFile
New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null

function Rel([string]$p) { $p.Replace($RepoRoot + [IO.Path]::DirectorySeparatorChar, '') }

# Scan only feature pages + shared components — those are where regressions land.
$searchRoots = @('web\src\features', 'web\src\components')

function Get-AllTsx {
  Get-ChildItem -Recurse -Path $searchRoots -Include *.tsx -ErrorAction SilentlyContinue
}

# --- 1. <button> with no accessible name ---------------------------------------
# Heuristic: a <button …> tag whose attributes do not include aria-label,
# aria-labelledby, or aria-label= (single line). We then check that the line
# isn't followed by a closing > immediately wrapping plain text.
$buttonHits = @()
foreach ($f in Get-AllTsx) {
  $lines = Get-Content $f.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -notmatch '<button\b') { continue }
    if ($line -match 'aria-label|aria-labelledby') { continue }
    # Look ahead at most 5 lines for either an explicit label/title/text or
    # an aria-label that spans onto a new line.
    $lookahead = ($lines[($i)..([Math]::Min($i + 5, $lines.Count - 1))] -join ' ')
    if ($lookahead -match 'aria-label|aria-labelledby') { continue }
    # Visible text inside <button>…</button> on the same window
    if ($lookahead -match '>\s*[A-Za-z\{]') { continue }
    $buttonHits += [pscustomobject]@{
      File = (Rel $f.FullName)
      Line = $i + 1
      Snippet = $line.Trim()
    }
  }
}

# --- 2. <Input …/> with no `label` and no `aria-label` -------------------------
$inputHits = @()
foreach ($f in Get-AllTsx) {
  $lines = Get-Content $f.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch '<Input\b') { continue }
    # Multi-line element: take 6 lines of context.
    $window = ($lines[($i)..([Math]::Min($i + 6, $lines.Count - 1))] -join ' ')
    if ($window -match 'label=|aria-label=') { continue }
    $inputHits += [pscustomobject]@{
      File = (Rel $f.FullName)
      Line = $i + 1
      Snippet = $lines[$i].Trim()
    }
  }
}

# --- 3. <img> without alt ------------------------------------------------------
$imgHits = @()
foreach ($f in Get-AllTsx) {
  $lines = Get-Content $f.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch '<img\b') { continue }
    $window = ($lines[($i)..([Math]::Min($i + 4, $lines.Count - 1))] -join ' ')
    if ($window -match 'alt\s*=') { continue }
    $imgHits += [pscustomobject]@{
      File = (Rel $f.FullName)
      Line = $i + 1
      Snippet = $lines[$i].Trim()
    }
  }
}

# --- 4. Solid red backgrounds without an icon nearby ---------------------------
# Looks for `bg-red-500` / `bg-red-600` (with optional /opacity), then checks the
# surrounding 3 lines for any lucide-react icon name. If none is present the
# component is communicating state by color alone.
$redHits = @()
foreach ($f in Get-AllTsx) {
  $lines = Get-Content $f.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch 'bg-red-(500|600|700)(/\d+)?\b') { continue }
    $start = [Math]::Max(0, $i - 3)
    $end   = [Math]::Min($lines.Count - 1, $i + 3)
    $window = ($lines[$start..$end] -join ' ')
    if ($window -match '<(AlertCircle|AlertTriangle|XCircle|XOctagon|CircleAlert|ShieldAlert|Ban|X)\b') { continue }
    # Ignore if there's also visible status text in the window
    if ($window -match 'aria-label=|>\s*(Error|Failed|Critical|Offline|Down|Inactive|Disabled)\b') { continue }
    $redHits += [pscustomobject]@{
      File = (Rel $f.FullName)
      Line = $i + 1
      Snippet = $lines[$i].Trim()
    }
  }
}

# --- 5. Motion components without reduced-motion opt-out ----------------------
# Files that use `<motion.` or `whileHover=`/`animate=`/`transition=` from
# framer-motion but do not import useMotionPreference / useReducedMotion.
$motionHits = @()
foreach ($f in Get-AllTsx) {
  $content = Get-Content $f.FullName -Raw
  $usesMotion = $content -match '<motion\.|\banimate\s*=|\bwhileHover\s*=|\btransition\s*=|\binitial\s*='
  if (-not $usesMotion) { continue }
  # Skip the motion library + the hook itself.
  if ($f.FullName -match 'components[\\/]motion[\\/]') { continue }
  if ($f.FullName -match 'hooks[\\/]useMotionPreference') { continue }
  if ($content -match 'useMotionPreference|useReducedMotion') { continue }
  $motionHits += (Rel $f.FullName)
}

# --- Write the report ----------------------------------------------------------
$ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$lines = @()
$lines += '# Accessibility Audit'
$lines += ''
$lines += "Generated: ``$ts`` UTC by ``scripts/a11y-audit.ps1``."
$lines += ''
$lines += 'Policy: see [A11Y_GUIDELINES.md](../A11Y_GUIDELINES.md).'
$lines += ''
$lines += '## Summary'
$lines += ''
$lines += '| Check | Hits |'
$lines += '|-------|-----:|'
$lines += "| Buttons without accessible name | $($buttonHits.Count) |"
$lines += "| ``<Input>`` without ``label`` or ``aria-label`` | $($inputHits.Count) |"
$lines += "| ``<img>`` without ``alt`` | $($imgHits.Count) |"
$lines += "| Red background with no status icon nearby | $($redHits.Count) |"
$lines += "| framer-motion files without ``useMotionPreference`` opt-out | $($motionHits.Count) |"
$lines += ''
$lines += 'These checks use heuristics (regex + small windows of context). Treat'
$lines += 'them as a TODO list — false positives are expected and a manual'
$lines += 'inspection by Lighthouse / axe-core devtools should accompany any'
$lines += 'remediation.'
$lines += ''

function Write-Section {
  param([string]$Title, [array]$Rows, [string]$Empty)
  $script:lines += "## $Title"
  $script:lines += ''
  if ($Rows.Count -eq 0) {
    $script:lines += "_$Empty_"
    $script:lines += ''
    return
  }
  $script:lines += '| File | Line | Snippet |'
  $script:lines += '|------|-----:|---------|'
  foreach ($r in $Rows | Sort-Object File, Line) {
    $snippet = $r.Snippet -replace '\|', '\|'
    if ($snippet.Length -gt 100) { $snippet = $snippet.Substring(0, 97) + '…' }
    $script:lines += "| ``$($r.File)`` | $($r.Line) | ``$snippet`` |"
  }
  $script:lines += ''
}

Write-Section 'Buttons without accessible name' $buttonHits 'No bare `<button>` tags found.'
Write-Section '`<Input>` without `label` or `aria-label`' $inputHits 'Every `<Input>` has an associated label.'
Write-Section '`<img>` without `alt`' $imgHits 'Every `<img>` has an `alt` attribute.'
Write-Section 'Solid red background with no status icon nearby' $redHits 'No color-only error states detected.'

$lines += '## framer-motion files without `useMotionPreference` opt-out'
$lines += ''
if ($motionHits.Count -eq 0) {
  $lines += '_All framer-motion consumers respect reduced motion._'
} else {
  foreach ($f in $motionHits | Sort-Object) { $lines += "- ``$f``" }
}
$lines += ''

Set-Content -Path $outPath -Value ($lines -join "`n") -Encoding utf8

Write-Host "Wrote $outPath"
Write-Host ''
Write-Host 'Counts:'
Write-Host "  Buttons missing accessible name : $($buttonHits.Count)"
Write-Host "  Input missing label             : $($inputHits.Count)"
Write-Host "  img missing alt                 : $($imgHits.Count)"
Write-Host "  Red bg with no status icon      : $($redHits.Count)"
Write-Host "  Motion files w/o reduced-motion : $($motionHits.Count)"
exit 0
