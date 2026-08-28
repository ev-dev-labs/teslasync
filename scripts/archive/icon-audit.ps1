# Iconography audit — finds direct lucide-react imports and inline icon sizing.
# Outputs:
#   docs/audits/lucide-direct-imports.txt — file-by-file list of remaining direct imports
#   docs/audits/icon-audit.md             — summary report
#
# Usage:
#   pwsh scripts/icon-audit.ps1
#
# Exit code is always 0 — this is a reporting tool, not a gate.

[CmdletBinding()]
param(
    [string]$Root = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = 'Stop'
Set-Location $Root

$auditDir = Join-Path $Root 'docs\audits'
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null

$webSrc = Join-Path $Root 'web\src'
$registry = Join-Path $webSrc 'lib\icons.ts'

# 1. Files importing from lucide-react directly (the registry itself is the
#    only legitimate consumer; everything else should go through `@/lib/icons`).
$tsFiles = Get-ChildItem $webSrc -Recurse -Include *.tsx,*.ts -File |
    Where-Object { $_.FullName -ne $registry -and $_.FullName -notmatch '\\__tests__\\' -and $_.FullName -notmatch '\.test\.(ts|tsx)$' }

$directImports = @()
foreach ($f in $tsFiles) {
    $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    if ($content -notmatch "from 'lucide-react'") { continue }

    $iconCount = 0
    foreach ($m in [regex]::Matches($content, "(?s)import\s*\{([^}]+)\}\s*from\s*'lucide-react'")) {
        $list = $m.Groups[1].Value -replace "//.*", "" -replace "/\*.*?\*/", ""
        $names = ($list -split ',') |
            ForEach-Object { ($_ -replace " as .*","").Trim() } |
            Where-Object { $_ -ne "" -and $_ -notmatch "^type " }
        $iconCount += $names.Count
    }

    $directImports += [PSCustomObject]@{
        File      = $f.FullName.Substring($Root.Length).TrimStart('\','/')
        IconCount = $iconCount
    }
}

$directImports = $directImports | Sort-Object -Property IconCount -Descending

$txtPath = Join-Path $auditDir 'lucide-direct-imports.txt'
$lines = @("# Files with direct 'lucide-react' imports (excluding the registry).",
           "# Generated: $(Get-Date -Format o)",
           "# Total files: $($directImports.Count)",
           "")
foreach ($d in $directImports) {
    $lines += ("{0,4}  {1}" -f $d.IconCount, $d.File)
}
$lines | Set-Content -LiteralPath $txtPath -Encoding utf8

# 2. Inline arbitrary pixel sizing on icons.
$arbitraryPx = @()
foreach ($f in $tsFiles) {
    $matches = Select-String -LiteralPath $f.FullName -Pattern 'h-\[\d+px\]\s+w-\[\d+px\]' -ErrorAction SilentlyContinue
    foreach ($m in $matches) {
        $arbitraryPx += [PSCustomObject]@{
            File = $f.FullName.Substring($Root.Length).TrimStart('\','/')
            Line = $m.LineNumber
            Snippet = $m.Line.Trim()
        }
    }
}

# 3. Inline <svg> elements outside the assets/branding/icons themselves
$inlineSvg = @()
foreach ($f in $tsFiles) {
    $matches = Select-String -LiteralPath $f.FullName -Pattern '<svg' -ErrorAction SilentlyContinue
    foreach ($m in $matches) {
        $inlineSvg += [PSCustomObject]@{
            File = $f.FullName.Substring($Root.Length).TrimStart('\','/')
            Line = $m.LineNumber
        }
    }
}

# 4. Summary report
$mdPath = Join-Path $auditDir 'icon-audit.md'
$totalDirectFiles = $directImports.Count
$totalDirectIcons = ($directImports | Measure-Object -Property IconCount -Sum).Sum
$top10 = $directImports | Select-Object -First 10

$md = @()
$md += '# Iconography audit'
$md += ''
$md += "Generated: $(Get-Date -Format o)"
$md += ''
$md += '## Summary'
$md += ''
$md += "- Files importing directly from `lucide-react`: **$totalDirectFiles**"
$md += "- Total icon imports across those files: **$totalDirectIcons**"
$md += "- Files with arbitrary pixel sizing (`h-[Npx] w-[Npx]`): **$($arbitraryPx.Count)**"
$md += "- Files with inline `<svg>` elements: **$(($inlineSvg | Select-Object -Property File -Unique).Count)**"
$md += ''
$md += 'See [`docs/ICON_GUIDELINES.md`](../ICON_GUIDELINES.md) for the migration policy.'
$md += ''
$md += '## Top 10 worst offenders'
$md += ''
$md += '| Icons | File |'
$md += '| ----: | :--- |'
foreach ($t in $top10) {
    $md += "| $($t.IconCount) | ``$($t.File)`` |"
}
$md += ''
$md += '## Inline pixel sizing'
$md += ''
if ($arbitraryPx.Count -eq 0) {
    $md += '_None._'
} else {
    $md += '| File | Line | Snippet |'
    $md += '| :--- | ---: | :--- |'
    foreach ($a in $arbitraryPx) {
        $snip = $a.Snippet -replace '\|', '\|'
        $md += "| ``$($a.File)`` | $($a.Line) | ``$snip`` |"
    }
}
$md += ''
$md += '## Inline `<svg>` usages'
$md += ''
if ($inlineSvg.Count -eq 0) {
    $md += '_None._'
} else {
    $byFile = $inlineSvg | Group-Object File | Sort-Object Count -Descending
    $md += '| Count | File |'
    $md += '| ----: | :--- |'
    foreach ($g in $byFile) {
        $md += "| $($g.Count) | ``$($g.Name)`` |"
    }
}
$md += ''
$md += '## How to reduce these counts'
$md += ''
$md += '1. Replace `import { X } from ''lucide-react''` with `import { Icons } from ''@/lib/icons''`.'
$md += '2. Replace `<X className="h-5 w-5" />` with `<Icon icon={Icons.x} size="lg" />` from `@/components/ui`.'
$md += '3. If the concept is missing from the registry, add it to `web/src/lib/icons.ts`.'
$md += '4. Re-run `pwsh scripts/icon-audit.ps1` to regenerate this report.'

$md -join "`n" | Set-Content -LiteralPath $mdPath -Encoding utf8

Write-Host "Direct lucide imports : $totalDirectFiles files / $totalDirectIcons icons"
Write-Host "Arbitrary pixel sizing: $($arbitraryPx.Count) hits"
Write-Host "Inline <svg>          : $($inlineSvg.Count) hits"
Write-Host "Wrote: $mdPath"
Write-Host "Wrote: $txtPath"
