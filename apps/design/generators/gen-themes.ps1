#requires -Version 5.1
<#
.SYNOPSIS
  Generate (or verify) the per-platform theme files from apps/design/tokens.json.

.DESCRIPTION
  Wraps the Node generators. Without -Check it writes the Fluent / Material 3 /
  HIG theme files into apps/design/generated/**. With -Check it fails (non-zero
  exit) if any generated file has drifted from the current tokens.json — this is
  the drift gate referenced by the P1/S9 prompt.

.EXAMPLE
  ./apps/design/generators/gen-themes.ps1
  ./apps/design/generators/gen-themes.ps1 -Check
#>
param(
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$index = Join-Path $here 'index.mjs'

if ($Check) {
  & node $index --check
} else {
  & node $index
}

exit $LASTEXITCODE
