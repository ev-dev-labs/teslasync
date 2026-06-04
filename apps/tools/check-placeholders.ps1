#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync monorepo — placeholder / stub gate (ADR-011 "definition of done").

.DESCRIPTION
  Recursively scans native-app source files for forbidden stub / placeholder
  patterns (loaded from placeholder-patterns.json) and fails (non-zero exit)
  when any are found. This makes "no skeletons / no stubs as final" a
  mechanical CI gate that every UI prompt's acceptance step can call.

  Forbidden patterns are grouped as:
    - common : language-agnostic markers (TODO, FIXME, Coming soon, ...)
    - kotlin : .kt / .kts specific stubs (TODO(), NotImplementedError, ...)
    - csharp : .cs / .xaml specific stubs (NotImplementedException, ...)
    - swift  : .swift specific stubs (fatalError("unimpl"), ...)

  Common patterns apply to every scanned file; language patterns apply only
  to that language's files. Generated / build output and test fixtures are
  excluded.

  A single line may opt out of a match with an inline marker:
      // parity:allow <reason>
  The reason is REQUIRED. Opt-outs are counted separately as
  PLACEHOLDER_ALLOWED and do not count toward PLACEHOLDER_COUNT. An opt-out
  marker with no reason is treated as a violation.

.USAGE
  ./check-placeholders.ps1                          # scan apps/, all languages
  ./check-placeholders.ps1 -Path apps/windows       # scan a subtree
  ./check-placeholders.ps1 -Language csharp         # only C# files/patterns
  ./check-placeholders.ps1 -SelfTest                # run built-in self-test

.OUTPUTS
  FILE:LINE: <pattern>      (one line per violation)
  PLACEHOLDER_ALLOWED=<n>
  PLACEHOLDER_COUNT=<n>
  Exit code: 0 when count == 0, 1 otherwise.
#>

[CmdletBinding()]
param(
    [string]$Path = "apps/",
    [ValidateSet("kotlin", "csharp", "swift", "all")]
    [string]$Language = "all",
    [string]$PatternsFile = "",
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

# Directory names excluded anywhere in a file's path.
$script:ExcludeDirs = @(
    "generated", "build", "bin", "obj", "DerivedData",
    "node_modules", ".git", "fixtures", "testfixtures", "__fixtures__"
)

# Language -> file extensions (lower-case, with dot).
$script:LangExt = @{
    kotlin = @(".kt", ".kts")
    csharp = @(".cs", ".xaml")
    swift  = @(".swift")
}

function Get-PatternSets {
    param([string]$File)
    if (-not (Test-Path -LiteralPath $File)) {
        throw "placeholder-patterns.json not found at: $File"
    }
    $json = Get-Content -LiteralPath $File -Raw | ConvertFrom-Json
    $sets = @{}
    foreach ($key in @("common", "kotlin", "csharp", "swift")) {
        $vals = @()
        if ($null -ne $json.$key) { $vals = @($json.$key) }
        $sets[$key] = $vals
    }
    return $sets
}

function Test-Excluded {
    param([string]$FullPath)
    $parts = $FullPath -split '[\\/]'
    foreach ($p in $parts) {
        if ($script:ExcludeDirs -contains $p) { return $true }
    }
    return $false
}

function Get-LanguageForExtension {
    param([string]$Ext)
    foreach ($lang in $script:LangExt.Keys) {
        if ($script:LangExt[$lang] -contains $Ext) { return $lang }
    }
    return $null
}

# Core scan. Returns a hashtable: Violations (string[]), Count (int), Allowed (int).
function Invoke-PlaceholderScan {
    param(
        [string]$ScanPath,
        [string]$ScanLanguage,
        [hashtable]$PatternSets
    )

    $selectedLangs =
        if ($ScanLanguage -eq "all") { @("kotlin", "csharp", "swift") }
        else { @($ScanLanguage) }

    # Build extension -> compiled-pattern list (common + that language).
    $extToPatterns = @{}
    foreach ($lang in $selectedLangs) {
        $patternStrings = @($PatternSets["common"]) + @($PatternSets[$lang])
        $compiled = @()
        foreach ($ps in $patternStrings) {
            if ([string]::IsNullOrWhiteSpace($ps)) { continue }
            $compiled += [pscustomobject]@{
                Raw   = $ps
                Regex = [regex]::new($ps, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
            }
        }
        foreach ($ext in $script:LangExt[$lang]) {
            $extToPatterns[$ext] = $compiled
        }
    }

    $allowMarker = [regex]::new('//\s*parity:allow(\s+(?<reason>\S.*))?', 'IgnoreCase')

    $violations = New-Object System.Collections.Generic.List[string]
    $count = 0
    $allowed = 0

    if (-not (Test-Path -LiteralPath $ScanPath)) {
        # Nothing to scan is a clean result, not an error.
        return @{ Violations = @(); Count = 0; Allowed = 0 }
    }

    $files = Get-ChildItem -LiteralPath $ScanPath -Recurse -File -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $ext = $file.Extension.ToLowerInvariant()
        if (-not $extToPatterns.ContainsKey($ext)) { continue }
        if (Test-Excluded -FullPath $file.FullName) { continue }

        $patterns = $extToPatterns[$ext]
        $lineNo = 0
        foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
            $lineNo++
            foreach ($pat in $patterns) {
                if (-not $pat.Regex.IsMatch($line)) { continue }

                $optOut = $allowMarker.Match($line)
                if ($optOut.Success -and -not [string]::IsNullOrWhiteSpace($optOut.Groups['reason'].Value)) {
                    $allowed++
                }
                else {
                    $count++
                    $violations.Add("$($file.FullName):${lineNo}: $($pat.Raw)") | Out-Null
                }
            }
        }
    }

    return @{ Violations = $violations.ToArray(); Count = $count; Allowed = $allowed }
}

function Invoke-SelfTest {
    param([hashtable]$PatternSets)

    Write-Output "=== self-test ==="
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("placeholder-selftest-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    $selfExit = 0
    try {
        # Dirty tree: a C# stub and a Kotlin stub.
        Set-Content -LiteralPath (Join-Path $tmp "Dirty.cs") -Value @(
            "public int Foo() {",
            "    throw new NotImplementedException();",
            "}"
        )
        Set-Content -LiteralPath (Join-Path $tmp "Dirty.kt") -Value @(
            "fun bar() = TODO()"
        )

        $dirty = Invoke-PlaceholderScan -ScanPath $tmp -ScanLanguage "all" -PatternSets $PatternSets
        $sawNotImpl = ($dirty.Violations | Where-Object { $_ -match "NotImplementedException" }).Count -gt 0
        $sawTodoKt  = ($dirty.Violations | Where-Object { $_ -match "TODO\\\(" }).Count -gt 0

        if ($dirty.Count -gt 0) { Write-Output "  [PASS] dirty tree -> PLACEHOLDER_COUNT=$($dirty.Count) (non-zero)" }
        else { Write-Output "  [FAIL] dirty tree -> PLACEHOLDER_COUNT=0 (expected > 0)"; $selfExit = 1 }

        if ($sawNotImpl) { Write-Output "  [PASS] reported NotImplementedException" }
        else { Write-Output "  [FAIL] did not report NotImplementedException"; $selfExit = 1 }

        if ($sawTodoKt) { Write-Output "  [PASS] reported Kotlin TODO(" }
        else { Write-Output "  [FAIL] did not report Kotlin TODO("; $selfExit = 1 }

        # Clean file replacing the dirty ones.
        Remove-Item -LiteralPath (Join-Path $tmp "Dirty.cs"), (Join-Path $tmp "Dirty.kt") -Force
        Set-Content -LiteralPath (Join-Path $tmp "Clean.cs") -Value @(
            "public int Foo() {",
            "    return 42;",
            "}"
        )
        $clean = Invoke-PlaceholderScan -ScanPath $tmp -ScanLanguage "all" -PatternSets $PatternSets
        if ($clean.Count -eq 0) { Write-Output "  [PASS] clean tree -> PLACEHOLDER_COUNT=0" }
        else { Write-Output "  [FAIL] clean tree -> PLACEHOLDER_COUNT=$($clean.Count) (expected 0)"; $selfExit = 1 }

        # Opt-out with reason is allowed; opt-out without reason is a violation.
        Set-Content -LiteralPath (Join-Path $tmp "OptOut.cs") -Value @(
            'var s = "todo"; // parity:allow translation key literally named todo',
            'var t = "todo"; // parity:allow'
        )
        $optExt = Invoke-PlaceholderScan -ScanPath $tmp -ScanLanguage "csharp" -PatternSets $PatternSets
        if ($optExt.Allowed -ge 1) { Write-Output "  [PASS] opt-out with reason counted as PLACEHOLDER_ALLOWED=$($optExt.Allowed)" }
        else { Write-Output "  [FAIL] opt-out with reason not honored (PLACEHOLDER_ALLOWED=$($optExt.Allowed))"; $selfExit = 1 }
        if ($optExt.Count -ge 1) { Write-Output "  [PASS] opt-out without reason still a violation (PLACEHOLDER_COUNT=$($optExt.Count))" }
        else { Write-Output "  [FAIL] opt-out without reason was not flagged"; $selfExit = 1 }
    }
    finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Output "SELFTEST_EXIT=$selfExit"
    return $selfExit
}

# ---- main ----
if ([string]::IsNullOrWhiteSpace($PatternsFile)) {
    $PatternsFile = Join-Path $PSScriptRoot "placeholder-patterns.json"
}
$patternSets = Get-PatternSets -File $PatternsFile

if ($SelfTest) {
    $exit = Invoke-SelfTest -PatternSets $patternSets
    Write-Output "EXIT=$exit"
    exit $exit
}

$result = Invoke-PlaceholderScan -ScanPath $Path -ScanLanguage $Language -PatternSets $patternSets
foreach ($v in $result.Violations) { Write-Output $v }
Write-Output "PLACEHOLDER_ALLOWED=$($result.Allowed)"
Write-Output "PLACEHOLDER_COUNT=$($result.Count)"

$exit = if ($result.Count -gt 0) { 1 } else { 0 }
Write-Output "EXIT=$exit"
exit $exit
