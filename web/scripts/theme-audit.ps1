<#
.SYNOPSIS
  Phase-40 / Prompt 10 - Theme parity audit script.

.DESCRIPTION
  Scans web/src for non-theme-aware color usage. Tallies violations per file
  per category and writes a markdown report. Categories mirror the prompt's
  six grep heuristics:

    1. text-white(/N)?         - non-theme-aware text colors
    2. text-gray-N | bg-gray-N  - hardcoded gray (excludes ConfirmDialog/StatusBadge)
    3. style={{ ... '#hex' }}   - inline hex colors (excludes wrapperStyle/contentStyle)
    4. arbitrary [rgba(...)]    - Tailwind arbitrary rgba values
    5. stroke="#..."            - chart axis/grid hex colors
    6. pages with NO theme vars - pages missing var(--text-*|--bg-*|--border-*)

  Output is a single markdown report at the path supplied via -OutPath
  (defaults to a tmp file under $env:TEMP because docs/audits/ is git-tracked).

.PARAMETER OutPath
  Destination of the markdown report. Default:
    $env:TEMP\theme-parity-audit.md
.PARAMETER Root
  Repo root; defaults to one level up from this script.
#>

[CmdletBinding()]
param(
  [string]$OutPath,
  [string]$Root
)

$ErrorActionPreference = 'Stop'

if (-not $Root) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
if (-not $OutPath) {
  $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) 'theme-parity-audit.md'
}

$webSrc      = Join-Path $Root 'web\src'
$features    = Join-Path $webSrc 'features'
$components  = Join-Path $webSrc 'components'

if (-not (Test-Path $webSrc)) {
  throw "web/src not found at: $webSrc"
}

# -- helpers --------------------------------------------------------------------

function Get-RelPath {
  param([string]$Path)
  $resolvedRoot = (Resolve-Path $Root).Path.TrimEnd('\','/')
  $resolved = (Resolve-Path $Path).Path
  $rel = $resolved.Substring($resolvedRoot.Length).TrimStart('\','/')
  return ($rel -replace '\\','/')
}

function Get-AllSourceFiles {
  param([string[]]$Dirs)
  $items = @()
  foreach ($d in $Dirs) {
    if (Test-Path $d) {
      $items += Get-ChildItem -Path $d -Recurse -Include *.tsx,*.ts -File
    }
  }
  return $items
}

# Returns array of [pscustomobject]@{ File; Line; Text } for matches.
function Find-Matches {
  param(
    [System.IO.FileInfo[]]$Files,
    [string]$Pattern,
    [scriptblock]$LineFilter = $null
  )
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($f in $Files) {
    $hits = Select-String -Path $f.FullName -Pattern $Pattern -AllMatches
    foreach ($h in $hits) {
      if ($LineFilter -and -not (& $LineFilter $h.Line)) { continue }
      $out.Add([pscustomobject]@{
        File = Get-RelPath $f.FullName
        Line = $h.LineNumber
        Text = $h.Line.Trim()
      })
    }
  }
  return $out.ToArray()
}

# -- scopes ---------------------------------------------------------------------

$scanFiles = Get-AllSourceFiles @($features, $components)
$pageFiles = Get-ChildItem -Path $features -Recurse -Include *.tsx -File |
             Where-Object { $_.FullName -match 'features[\\/][^\\/]+[\\/]pages[\\/]' }

# -- 1. text-white(/N)? ---------------------------------------------------------
$cat1 = Find-Matches -Files $scanFiles -Pattern '\btext-white(/\d+|/\[[\d.]+\])?\b'

# -- 2. text-gray-N | bg-gray-N (skip ConfirmDialog & StatusBadge) --------------
$cat2Files = $scanFiles | Where-Object {
  $_.Name -ne 'ConfirmDialog.tsx' -and $_.Name -ne 'StatusBadge.tsx'
}
$cat2 = Find-Matches -Files $cat2Files -Pattern '\b(text-gray-\d+|bg-gray-\d+)\b'

# -- 3. inline hex colors in style={{ ... }} (skip wrapperStyle/contentStyle) --
# Match style={{ ... "#abc..." or '#abc...' ...}} on a single line.
$cat3 = Find-Matches -Files $scanFiles `
  -Pattern 'style=\{\{[^}]*[''"]#[0-9a-fA-F]{3,8}[''"]' `
  -LineFilter { param($line) $line -notmatch 'wrapperStyle|contentStyle' }

# -- 4. Tailwind arbitrary [rgba(...)] / [rgb(...)] in className ----------------
$cat4 = Find-Matches -Files $scanFiles -Pattern '\[rgba?\('

# -- 5. stroke="#..." (chart axis/grid hex strokes) -----------------------------
$cat5 = Find-Matches -Files $scanFiles -Pattern 'stroke="#'

# -- 6. pages with NO theme vars (text-primary/secondary/muted, --bg-*, --border-*) --
$cat6 = New-Object System.Collections.Generic.List[object]
foreach ($f in $pageFiles) {
  $content = [System.IO.File]::ReadAllText($f.FullName)
  if ($content -notmatch 'var\(--text-(primary|secondary|muted)\)|--bg-|--border-') {
    $cat6.Add([pscustomobject]@{
      File = Get-RelPath $f.FullName
      Line = 0
      Text = '(no theme-aware vars referenced)'
    })
  }
}

# -- tallies --------------------------------------------------------------------

$categories = @(
  @{ Id = 1; Name = 'text-white(/N)? non-theme-aware';            Hits = $cat1 }
  @{ Id = 2; Name = 'text-gray-N / bg-gray-N hardcoded';          Hits = $cat2 }
  @{ Id = 3; Name = 'inline hex in style={{...}} (non-Recharts)'; Hits = $cat3 }
  @{ Id = 4; Name = 'Tailwind arbitrary [rgba(...)] in className';Hits = $cat4 }
  @{ Id = 5; Name = 'chart stroke="#..." hex';                    Hits = $cat5 }
  @{ Id = 6; Name = 'pages missing theme-aware vars';             Hits = $cat6 }
)

# Per-file weighted severity: count + 0.5 weighting for cat 6 presence flag.
$perFile = @{}
foreach ($c in $categories) {
  foreach ($h in $c.Hits) {
    if (-not $perFile.ContainsKey($h.File)) {
      $perFile[$h.File] = [pscustomobject]@{
        File = $h.File
        Total = 0
        ByCat = @{}
      }
    }
    $perFile[$h.File].Total++
    if (-not $perFile[$h.File].ByCat.ContainsKey($c.Id)) {
      $perFile[$h.File].ByCat[$c.Id] = 0
    }
    $perFile[$h.File].ByCat[$c.Id]++
  }
}

$ranked = $perFile.Values | Sort-Object -Property Total -Descending

# -- markdown report -----------------------------------------------------------

$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine('# Theme parity audit')
[void]$md.AppendLine()
[void]$md.AppendLine("Generated: $((Get-Date).ToString('o'))")
[void]$md.AppendLine("Repo:      $Root")
[void]$md.AppendLine()
[void]$md.AppendLine('## Summary by category')
[void]$md.AppendLine()
[void]$md.AppendLine('| # | Category | Total hits | Files affected |')
[void]$md.AppendLine('|---|----------|-----------:|---------------:|')
foreach ($c in $categories) {
  $files = ($c.Hits | Select-Object -ExpandProperty File -Unique).Count
  [void]$md.AppendLine("| $($c.Id) | $($c.Name) | $($c.Hits.Count) | $files |")
}
[void]$md.AppendLine()
[void]$md.AppendLine('## Top files (severity = total weighted hits)')
[void]$md.AppendLine()
[void]$md.AppendLine('| Rank | File | Total | C1 | C2 | C3 | C4 | C5 | C6 |')
[void]$md.AppendLine('|-----:|------|------:|---:|---:|---:|---:|---:|---:|')
$rank = 0
foreach ($r in ($ranked | Select-Object -First 50)) {
  $rank++
  $c1 = if ($r.ByCat.ContainsKey(1)) { $r.ByCat[1] } else { 0 }
  $c2 = if ($r.ByCat.ContainsKey(2)) { $r.ByCat[2] } else { 0 }
  $c3 = if ($r.ByCat.ContainsKey(3)) { $r.ByCat[3] } else { 0 }
  $c4 = if ($r.ByCat.ContainsKey(4)) { $r.ByCat[4] } else { 0 }
  $c5 = if ($r.ByCat.ContainsKey(5)) { $r.ByCat[5] } else { 0 }
  $c6 = if ($r.ByCat.ContainsKey(6)) { $r.ByCat[6] } else { 0 }
  [void]$md.AppendLine("| $rank | $($r.File) | $($r.Total) | $c1 | $c2 | $c3 | $c4 | $c5 | $c6 |")
}
[void]$md.AppendLine()

foreach ($c in $categories) {
  [void]$md.AppendLine("## Category $($c.Id) - $($c.Name)")
  [void]$md.AppendLine()
  if ($c.Hits.Count -eq 0) {
    [void]$md.AppendLine('_No matches._')
    [void]$md.AppendLine()
    continue
  }
  $byFile = $c.Hits | Group-Object -Property File | Sort-Object -Property Count -Descending
  [void]$md.AppendLine('| File | Hits | Sample lines |')
  [void]$md.AppendLine('|------|-----:|--------------|')
  foreach ($g in ($byFile | Select-Object -First 30)) {
    $sampleLines = ($g.Group | Select-Object -First 3 | ForEach-Object { $_.Line }) -join ', '
    [void]$md.AppendLine("| $($g.Name) | $($g.Count) | $sampleLines |")
  }
  [void]$md.AppendLine()
}

# Write report.
$null = New-Item -ItemType Directory -Force -Path (Split-Path $OutPath) -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllText($OutPath, $md.ToString(), [System.Text.UTF8Encoding]::new($false))

# stdout summary so callers can pipe into a log.
Write-Output "theme-audit: report written to $OutPath"
foreach ($c in $categories) {
  Write-Output ("theme-audit: category {0} = {1} hits across {2} files" -f $c.Id, $c.Hits.Count, ($c.Hits | Select-Object -ExpandProperty File -Unique).Count)
}
$top10 = $ranked | Select-Object -First 10
Write-Output 'theme-audit: top 10 files:'
foreach ($r in $top10) { Write-Output ("  {0,4}  {1}" -f $r.Total, $r.File) }
