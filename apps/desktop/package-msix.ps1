[CmdletBinding(DefaultParameterSetName = 'Package')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Package')]
    [string]$Appx,
    [Parameter(Mandatory = $true, ParameterSetName = 'Package')]
    [string]$Msix,
    [Parameter(ParameterSetName = 'Package')]
    [Parameter(Mandatory = $true, ParameterSetName = 'Layout')]
    [ValidateSet('x64', 'arm64')]
    [string]$Architecture,
    [Parameter(Mandatory = $true, ParameterSetName = 'Bundle')]
    [string[]]$Packages,
    [Parameter(Mandatory = $true, ParameterSetName = 'Bundle')]
    [string]$Bundle,
    [Parameter(Mandatory = $true, ParameterSetName = 'Layout')]
    [string]$Layout,
    [Parameter(Mandatory = $true, ParameterSetName = 'Layouts')]
    [string[]]$Layouts
)

$ErrorActionPreference = 'Stop'

function Read-PackageLayout([string]$Directory, [string]$ExpectedArchitecture) {
    $root = (Resolve-Path -LiteralPath $Directory).Path
    $manifest = [xml](Get-Content -LiteralPath (Join-Path $root 'AppxManifest.xml') -Raw)
    $identity = $manifest.Package.Identity
    $arch = [string]$identity.ProcessorArchitecture
    if ($arch -notin @('x64', 'arm64')) {
        throw "Package must declare x64 or arm64 architecture (found '$arch')."
    }
    if ($ExpectedArchitecture -and $arch -ne $ExpectedArchitecture) {
        throw "Package architecture '$arch' does not match expected '$ExpectedArchitecture'."
    }
    if (-not $identity.Name -or -not $identity.Publisher -or -not $identity.Version) {
        throw 'Package identity must include name, publisher, and version.'
    }
    $minVersion = $manifest.Package.Dependencies.TargetDeviceFamily.MinVersion
    if (-not $minVersion -or [version]$minVersion -le [version]'10.0.17134.0') {
        throw "Partner Center rejects MSIX packages with Windows MinVersion <= 10.0.17134.0 (found '$minVersion')."
    }
    $applications = @($manifest.Package.Applications.Application)
    if ($applications.Count -ne 1 -or -not $applications[0].Executable) {
        throw 'Expected one application executable in the package manifest.'
    }
    $executable = [IO.Path]::GetFullPath((Join-Path $root $applications[0].Executable))
    if (-not $executable.StartsWith("$root$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Application executable must be inside the package.'
    }
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($executable))
    try {
        if ($reader.BaseStream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) {
            throw 'Application executable has no valid DOS header.'
        }
        $null = $reader.BaseStream.Seek(60, [IO.SeekOrigin]::Begin)
        $offset = $reader.ReadUInt32()
        if ([long]$offset + 6 -gt $reader.BaseStream.Length) {
            throw 'Application executable has an invalid PE offset.'
        }
        $null = $reader.BaseStream.Seek($offset, [IO.SeekOrigin]::Begin)
        if ($reader.ReadUInt32() -ne 0x00004550) {
            throw 'Application executable has no valid PE signature.'
        }
        $machine = $reader.ReadUInt16()
        $nativeArch = switch ($machine) {
            0x8664 { 'x64' }
            0xaa64 { 'arm64' }
            default { throw "Unsupported application PE machine '$machine'." }
        }
        if ($nativeArch -ne $arch) {
            throw "Native executable architecture '$nativeArch' does not match manifest '$arch'."
        }
    } finally {
        $reader.Dispose()
    }
    return [pscustomobject]@{
        Name = [string]$identity.Name
        Publisher = [string]$identity.Publisher
        Version = [string]$identity.Version
        Architecture = $arch
        MinVersion = [string]$minVersion
    }
}

function Assert-PackageSet([object[]]$Infos) {
    if ($Infos.Count -ne 2 -or
        @($Infos | Where-Object Architecture -eq 'x64').Count -ne 1 -or
        @($Infos | Where-Object Architecture -eq 'arm64').Count -ne 1) {
        throw 'A Windows bundle requires exactly one native x64 and one native arm64 package.'
    }
    foreach ($info in $Infos) {
        foreach ($field in @('Name', 'Publisher', 'Version', 'MinVersion')) {
            if ($info.$field -cne $Infos[0].$field) {
                throw "Bundle packages must share the same $field."
            }
        }
    }
}

if ($PSCmdlet.ParameterSetName -eq 'Layout') {
    $info = Read-PackageLayout $Layout $Architecture
    Write-Output "Validated $($info.Architecture) package layout: $Layout"
    return
}
if ($PSCmdlet.ParameterSetName -eq 'Layouts') {
    $infos = @($Layouts | ForEach-Object { Read-PackageLayout $_ '' })
    Assert-PackageSet $infos
    Write-Output 'Validated native x64 + arm64 package identities.'
    return
}

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
    if ($PSCmdlet.ParameterSetName -eq 'Bundle') {
        $infos = @()
        $inputs = Join-Path $work 'inputs'
        New-Item -ItemType Directory -Path $inputs | Out-Null
        foreach ($package in $Packages) {
            $packagePath = (Resolve-Path -LiteralPath $package).Path
            $inspect = Join-Path $work "inspect-$($infos.Count)"
            & $makeappx unpack /p $packagePath /d $inspect /o | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Unpacking bundle input failed ($LASTEXITCODE)." }
            $info = Read-PackageLayout $inspect ''
            $info | Add-Member -NotePropertyName FileName -NotePropertyValue "$($info.Architecture).msix"
            $info | Add-Member -NotePropertyName Hash -NotePropertyValue (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
            Copy-Item -LiteralPath $packagePath -Destination (Join-Path $inputs $info.FileName)
            $infos += $info
        }
        Assert-PackageSet $infos
        $bundlePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Bundle)
        $bundleVersion = $infos[0].Version
        New-Item -ItemType Directory -Path (Split-Path $bundlePath) -Force | Out-Null
        & $makeappx bundle /d $inputs /p $bundlePath /bv $bundleVersion /o | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Bundling MSIX failed ($LASTEXITCODE)." }
        $archive = [IO.Compression.ZipFile]::OpenRead($bundlePath)
        try {
            $entry = $archive.GetEntry('AppxMetadata/AppxBundleManifest.xml')
            if (-not $entry) { throw 'MSIX bundle has no bundle manifest.' }
            $manifestReader = [IO.StreamReader]::new($entry.Open())
            try { $manifest = [xml]$manifestReader.ReadToEnd() } finally { $manifestReader.Dispose() }
            foreach ($field in @('Name', 'Publisher', 'Version')) {
                if ($manifest.Bundle.Identity.$field -cne $infos[0].$field) {
                    throw "MSIX bundle identity has an unexpected $field."
                }
            }
            $applications = @($manifest.Bundle.Packages.Package | Where-Object Type -eq 'application')
            if ($applications.Count -ne 2) { throw 'MSIX bundle must contain two application packages.' }
            foreach ($info in $infos) {
                $embedded = @($applications | Where-Object { $_.Architecture -eq $info.Architecture })
                if ($embedded.Count -ne 1 -or $embedded[0].Version -cne $info.Version -or
                    $embedded[0].FileName -cne $info.FileName) {
                    throw "MSIX bundle is missing its validated $($info.Architecture) package."
                }
                $payload = $archive.GetEntry($info.FileName)
                if (-not $payload) { throw "MSIX bundle has no $($info.FileName) payload." }
                $stream = $payload.Open()
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $hash = [Convert]::ToHexString($sha.ComputeHash($stream)) } finally { $stream.Dispose(); $sha.Dispose() }
                if ($hash -cne $info.Hash) { throw "Bundling changed the validated $($info.Architecture) package bytes." }
            }
        } finally {
            $archive.Dispose()
        }
        Write-Output "Validated native x64 + arm64 MSIX bundle: $bundlePath"
        return
    }
    $appxPath = (Resolve-Path -LiteralPath $Appx).Path
    $msixPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Msix)
    & $makeappx unpack /p $appxPath /d $source /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unpacking AppX failed ($LASTEXITCODE)." }
    $null = Read-PackageLayout $source $Architecture

    New-Item -ItemType Directory -Path (Split-Path $msixPath) -Force | Out-Null
    & $makeappx pack /d $source /p $msixPath /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Packing MSIX failed ($LASTEXITCODE)." }

    & $makeappx unpack /p $msixPath /d $check /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Validating MSIX failed ($LASTEXITCODE)." }
    $null = Read-PackageLayout $check $Architecture
    Write-Output "Validated MSIX: $msixPath"
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
