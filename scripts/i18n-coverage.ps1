<#
.SYNOPSIS
  i18n coverage audit for the TeslaSync web frontend.

.DESCRIPTION
  Runs five static checks and writes a Markdown report to
  docs/audits/i18n-coverage.md:

    1. RAW_TEXT          — text content between JSX tags that looks like
                           untranslated English (e.g. `>Battery Health<`).
    2. JSX_PROP          — string literals passed as `label`/`title`/
                           `placeholder`/`aria-label`/`alt` attributes.
    3. FEEDBACK_LITERAL  — Toast/EmptyState/ConfirmDialog/AlertBanner calls
                           with raw English in their props.
    4. KEY_GAP           — `t()` keys missing from `en.json` (delegates to
                           `scripts/i18n-validate-keys.mjs`).
    5. UNUSED_KEY        — keys defined in `en.json` but never referenced.

  Run from the repo root:

      pwsh scripts/i18n-coverage.ps1

  Exit code is always 0 — this script reports, it does not gate. Add a hard
  threshold in CI later if desired (see `.github/workflows/ci.yml`).

.NOTES
  Heuristics — false positives are expected, particularly for short or
  technical strings. Use `// i18n-ignore` on a line to suppress that line.

  ALLOWED literals (auto-skipped) include common technical tokens and unit
  abbreviations: `kWh`, `mph`, `km/h`, `°C`, `°F`, `psi`, `bar`, `JSON`,
  `URL`, `HTTP`, `MQTT`, `SSE`, `VIN`, etc. Edit `$AllowedLiterals` below to
  expand.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$OutFile  = "docs/audits/i18n-coverage.md"
)

Set-Location $RepoRoot
$outPath = Join-Path $RepoRoot $OutFile
New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null

function Rel([string]$p) {
  $p.Replace($RepoRoot + [IO.Path]::DirectorySeparatorChar, '')
}

# Source roots scanned by all checks. We scan the whole frontend src tree so
# that components, hooks, and pages are all covered.
$searchRoots = @('web\src')

function Get-AllSrc {
  Get-ChildItem -Recurse -Path $searchRoots -Include *.tsx, *.ts -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -notmatch '\\__tests__\\' -and
      $_.FullName -notmatch '\.test\.(t|j)sx?$' -and
      $_.FullName -notmatch '\\node_modules\\' -and
      $_.FullName -notmatch '\\dist\\'
    }
}

# Tokens that look like English but are technical. A line containing ONLY one
# of these is not flagged as raw English even when it matches the JSX content
# regex.
$AllowedLiterals = @(
  'kWh', 'kW', 'Wh', 'mph', 'km', 'km/h', 'mi', 'm', 'cm', 'mm',
  '°C', '°F', 'psi', 'bar', 'V', 'A', 'Ah',
  'JSON', 'URL', 'URI', 'HTTP', 'HTTPS', 'API', 'MQTT', 'SSE', 'SQL',
  'VIN', 'GPS', 'PWA', 'CSV', 'PNG', 'JPG', 'SVG', 'PDF',
  'OK', 'TBD', 'N/A',
  'TeslaSync'
)

function Test-AllowedLiteral([string]$content) {
  $trimmed = $content.Trim()
  if ($trimmed.Length -eq 0) { return $true }
  if ($AllowedLiterals -contains $trimmed) { return $true }
  # Pure number or unit abbreviation surrounded by whitespace.
  if ($trimmed -match '^[0-9]+(\.[0-9]+)?\s*(%|ms|s|min|h|d|MB|GB|KB|TB)?$') { return $true }
  # Single character (em dash, bullet, etc.).
  if ($trimmed.Length -eq 1) { return $true }
  return $false
}

# ─── 1. RAW_TEXT — text content between JSX tags that looks like English ─────
# Heuristic: a line containing `>Word Word<` or `>Word<` where Word starts
# with a capital letter. We skip lines that contain `{t(` (already wrapped),
# lines marked `// i18n-ignore`, lines inside a `// fix-me-i18n` block.
$rawTextHits = @()
foreach ($f in Get-AllSrc) {
  $lines = Get-Content $f.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match '//\s*i18n-ignore') { continue }
    if ($line -match '\{t\(') { continue }
    # Look for capitalised English between angle brackets. Allow apostrophes,
    # commas, periods, exclamation, question, and ellipsis. Reject pure
    # whitespace, single chars, and strings that look like JSX expressions.
    $m = [regex]::Matches($line, ">([A-Z][a-zA-Z][a-zA-Z ,.!?'`"…\-]{2,80})<")
    foreach ($mm in $m) {
      $text = $mm.Groups[1].Value
      if (Test-AllowedLiteral $text) { continue }
      # Skip JSX fragments and angle-bracket TS generics.
      if ($text -match '^[A-Z][a-zA-Z]*<') { continue }
      $rawTextHits += [pscustomobject]@{
        File    = (Rel $f.FullName)
        Line    = $i + 1
        Snippet = $line.Trim()
        Text    = $text
      }
    }
  }
}

# ─── 2. JSX_PROP — string literals on label/title/placeholder/aria-label/alt
# attributes that look like untranslated English.
$jsxPropHits = @()
$propPattern = '\b(label|title|placeholder|aria-label|alt)="([A-Z][a-zA-Z][a-zA-Z ,.!?''`"]{2,80})"'
foreach ($f in Get-AllSrc) {
  $lines = Get-Content $f.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match '//\s*i18n-ignore') { continue }
    $m = [regex]::Matches($line, $propPattern)
    foreach ($mm in $m) {
      $attr = $mm.Groups[1].Value
      $text = $mm.Groups[2].Value
      if (Test-AllowedLiteral $text) { continue }
      $jsxPropHits += [pscustomobject]@{
        File    = (Rel $f.FullName)
        Line    = $i + 1
        Attr    = $attr
        Snippet = $line.Trim()
        Text    = $text
      }
    }
  }
}

# ─── 3. FEEDBACK_LITERAL — Toast / EmptyState / ConfirmDialog / AlertBanner
# calls passing raw English. We look for the component/function name within a
# 3-line window followed by a string literal that starts with a capital.
$feedbackHits = @()
$feedbackComponents = @('toast\.(success|error|info|warn|warning)', 'showToast', '<Toast', '<EmptyState', '<ConfirmDialog', '<AlertBanner', 'confirm\(\s*\{')
$feedbackRe = '(' + ($feedbackComponents -join '|') + ')'
foreach ($f in Get-AllSrc) {
  $text = Get-Content $f.FullName -Raw
  if ($text -notmatch $feedbackRe) { continue }
  $lines = Get-Content $f.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch $feedbackRe) { continue }
    $window = ($lines[($i)..([Math]::Min($i + 4, $lines.Count - 1))] -join ' ')
    # Look for a string literal that looks like English in the next ~5 lines
    # of the call. Skip if `t(` is already in the window.
    if ($window -match '\bt\(') { continue }
    if ($window -match '//\s*i18n-ignore') { continue }
    $m = [regex]::Match($window, '["'']([A-Z][a-zA-Z][a-zA-Z ,.!?''`"]{4,80})["'']')
    if (-not $m.Success) { continue }
    $candidate = $m.Groups[1].Value
    if (Test-AllowedLiteral $candidate) { continue }
    $feedbackHits += [pscustomobject]@{
      File    = (Rel $f.FullName)
      Line    = $i + 1
      Snippet = $lines[$i].Trim()
      Text    = $candidate
    }
  }
}

# ─── 4 & 5. KEY_GAP and UNUSED_KEY — delegate to validate-keys script ───────
$validateOut = & node (Join-Path $PSScriptRoot 'i18n-validate-keys.mjs') --report=json | Out-String
$validate = $null
try { $validate = $validateOut | ConvertFrom-Json } catch {
  Write-Warning "i18n-validate-keys.mjs did not emit valid JSON; key counts will be 0."
}

# ─── Per-file ranking ────────────────────────────────────────────────────────
function Group-ByFile([array]$rows) {
  if (-not $rows) { return @() }
  $rows | Group-Object File | ForEach-Object {
    [pscustomobject]@{ File = $_.Name; Count = $_.Count }
  } | Sort-Object Count -Descending
}

$rawTextByFile  = Group-ByFile $rawTextHits
$jsxPropByFile  = Group-ByFile $jsxPropHits
$feedbackByFile = Group-ByFile $feedbackHits

# Combined "worst offenders" — sum across all three lists.
$combined = @{}
foreach ($r in $rawTextByFile)  { if (-not $combined.ContainsKey($r.File)) { $combined[$r.File] = 0 }; $combined[$r.File] += $r.Count }
foreach ($r in $jsxPropByFile)  { if (-not $combined.ContainsKey($r.File)) { $combined[$r.File] = 0 }; $combined[$r.File] += $r.Count }
foreach ($r in $feedbackByFile) { if (-not $combined.ContainsKey($r.File)) { $combined[$r.File] = 0 }; $combined[$r.File] += $r.Count }
$worstOffenders = $combined.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 20

# ─── Write the report ────────────────────────────────────────────────────────
$ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$lines = New-Object System.Collections.ArrayList

[void]$lines.Add('# i18n Coverage Audit')
[void]$lines.Add('')
[void]$lines.Add("Generated: ``$ts`` UTC by ``scripts/i18n-coverage.ps1``.")
[void]$lines.Add('')
[void]$lines.Add('Policy: see [I18N_GUIDELINES.md](../I18N_GUIDELINES.md).')
[void]$lines.Add('')
[void]$lines.Add('## Summary')
[void]$lines.Add('')
[void]$lines.Add('| Check | Hits |')
[void]$lines.Add('|-------|-----:|')
[void]$lines.Add("| 1. Raw English text in JSX (``>Battery Health<``) | $($rawTextHits.Count) |")
[void]$lines.Add("| 2. JSX prop literals (``label=`"…`"``, etc.) | $($jsxPropHits.Count) |")
[void]$lines.Add("| 3. Toast / EmptyState / ConfirmDialog raw literals | $($feedbackHits.Count) |")
if ($validate) {
  [void]$lines.Add("| 4. ``t()`` keys missing from ``en.json`` | $($validate.missingCount) |")
  [void]$lines.Add("| 5. Defined keys never referenced | $($validate.unusedCount) |")
} else {
  [void]$lines.Add("| 4. ``t()`` keys missing from ``en.json`` | _validate failed_ |")
  [void]$lines.Add("| 5. Defined keys never referenced | _validate failed_ |")
}
[void]$lines.Add('')
[void]$lines.Add('Heuristics will produce some false positives — review each hit before')
[void]$lines.Add('"fixing" it. Add ``// i18n-ignore`` to any line where the literal is')
[void]$lines.Add('genuinely a non-translated technical token (URLs, CSS class strings,')
[void]$lines.Add('debug labels visible only in dev tools, etc.).')
[void]$lines.Add('')

# Worst-offender table
[void]$lines.Add('## Top 20 worst-offender files (combined raw + prop + feedback)')
[void]$lines.Add('')
if ($worstOffenders.Count -eq 0) {
  [void]$lines.Add('_No raw English literals detected in JSX._')
} else {
  [void]$lines.Add('| File | Hits |')
  [void]$lines.Add('|------|-----:|')
  foreach ($w in $worstOffenders) {
    [void]$lines.Add("| ``$($w.Name)`` | $($w.Value) |")
  }
}
[void]$lines.Add('')

function Write-Section {
  param([string]$Title, [array]$Rows, [string]$Empty, [int]$Limit = 100)
  [void]$script:lines.Add("## $Title")
  [void]$script:lines.Add('')
  if (-not $Rows -or $Rows.Count -eq 0) {
    [void]$script:lines.Add("_$Empty_")
    [void]$script:lines.Add('')
    return
  }
  [void]$script:lines.Add("Showing first $([Math]::Min($Rows.Count, $Limit)) of $($Rows.Count) hits.")
  [void]$script:lines.Add('')
  [void]$script:lines.Add('| File | Line | Text |')
  [void]$script:lines.Add('|------|-----:|------|')
  $shown = 0
  foreach ($r in ($Rows | Sort-Object File, Line)) {
    if ($shown -ge $Limit) { break }
    $txt = $r.Text -replace '\|', '\|'
    if ($txt.Length -gt 80) { $txt = $txt.Substring(0, 77) + '…' }
    [void]$script:lines.Add("| ``$($r.File)`` | $($r.Line) | ``$txt`` |")
    $shown++
  }
  [void]$script:lines.Add('')
}

Write-Section '1. Raw English text in JSX' $rawTextHits 'No raw English text detected in JSX.'
Write-Section '2. JSX prop literals' $jsxPropHits 'Every label/title/placeholder/aria-label uses a t() call.'
Write-Section '3. Toast / EmptyState / ConfirmDialog raw literals' $feedbackHits 'All feedback components use t() for their messages.'

# Missing-key sample
[void]$lines.Add('## 4. `t()` keys missing from `en.json` (sample)')
[void]$lines.Add('')
if ($validate -and $validate.missing -and $validate.missing.Count -gt 0) {
  [void]$lines.Add('Run ``node scripts/i18n-validate-keys.mjs --extract`` to auto-add')
  [void]$lines.Add('any keys whose ``t()`` call has a fallback string. Remaining keys')
  [void]$lines.Add('are listed below — they need a manual default written by hand.')
  [void]$lines.Add('')
  [void]$lines.Add('| Key | Default | First use |')
  [void]$lines.Add('|-----|---------|-----------|')
  foreach ($m in ($validate.missing | Select-Object -First 50)) {
    $fb = if ($m.fallback) { ($m.fallback -replace '\|', '\|') } else { '_(none)_' }
    if ($fb.Length -gt 60) { $fb = $fb.Substring(0, 57) + '…' }
    $where = if ($m.firstRef) { "$($m.firstRef.file):$($m.firstRef.line)" } else { '_unknown_' }
    [void]$lines.Add("| ``$($m.key)`` | $fb | ``$where`` |")
  }
} else {
  [void]$lines.Add('_All `t()` keys resolve in `en.json`._')
}
[void]$lines.Add('')

# Unused keys
[void]$lines.Add('## 5. Defined keys never referenced (sample)')
[void]$lines.Add('')
if ($validate -and $validate.unused -and $validate.unused.Count -gt 0) {
  [void]$lines.Add('These keys exist in `en.json` but no `t()` call references them. They')
  [void]$lines.Add('may be safe to remove, OR they may be referenced via dynamic key')
  [void]$lines.Add('construction (which the validator cannot follow). Spot-check before')
  [void]$lines.Add('deleting.')
  [void]$lines.Add('')
  foreach ($k in ($validate.unused | Select-Object -First 50)) {
    [void]$lines.Add("- ``$k``")
  }
} else {
  [void]$lines.Add('_Every defined key is referenced at least once._')
}
[void]$lines.Add('')

Set-Content -Path $outPath -Value ($lines -join "`n") -Encoding utf8

Write-Host "Wrote $outPath"
Write-Host ''
Write-Host 'Counts:'
Write-Host "  Raw English text in JSX        : $($rawTextHits.Count)"
Write-Host "  JSX prop literals              : $($jsxPropHits.Count)"
Write-Host "  Feedback component literals    : $($feedbackHits.Count)"
if ($validate) {
  Write-Host "  Missing t() keys (en.json)     : $($validate.missingCount)"
  Write-Host "  Unused keys in en.json         : $($validate.unusedCount)"
}
exit 0
