param(
    [Parameter(Mandatory = $true)]
    [string]$Appx,
    [Parameter(Mandatory = $true)]
    [string]$Msix
)

$ErrorActionPreference = 'Stop'
$appxPath = (Resolve-Path -LiteralPath $Appx).Path
$msixPath = [System.IO.Path]::GetFullPath($Msix)
$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$makeappx = Get-ChildItem -Path $kits -Filter makeappx.exe -Recurse |
    Where-Object { $_.DirectoryName -match '\\x64$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $makeappx) {
    throw 'Windows SDK makeappx.exe (x64) is required to build an MSIX.'
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("teslasync-msix-" + [guid]::NewGuid())
$source = Join-Path $work 'source'
$check = Join-Path $work 'check'
New-Item -ItemType Directory -Path $work | Out-Null
try {
    & $makeappx unpack /p $appxPath /d $source /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unpacking AppX failed ($LASTEXITCODE)." }

    New-Item -ItemType Directory -Path (Split-Path $msixPath) -Force | Out-Null
    & $makeappx pack /d $source /p $msixPath /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Packing MSIX failed ($LASTEXITCODE)." }

    & $makeappx unpack /p $msixPath /d $check /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Validating MSIX failed ($LASTEXITCODE)." }
    if (-not (Test-Path -LiteralPath (Join-Path $check 'AppxManifest.xml'))) {
        throw 'MSIX has no AppxManifest.xml.'
    }
    Write-Output "Validated MSIX: $msixPath"
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
