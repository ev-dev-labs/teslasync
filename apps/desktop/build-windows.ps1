param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$')]
    [string]$Version,
    [string]$WebDist = (Join-Path $PSScriptRoot '..\..\web\dist'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "release\windows-$Version"),
    [string]$AssetsDirectory = (Join-Path $PSScriptRoot "release\assets-$Version")
)

$ErrorActionPreference = 'Stop'
# npm's PowerShell shim has its own automatic script-root scope.
$projectPath = $PSScriptRoot
$webPath = (Resolve-Path -LiteralPath $WebDist).Path
if (-not (Test-Path -LiteralPath (Join-Path $webPath 'index.html'))) {
    throw 'Build the bundled web UI before packaging Windows apps.'
}
$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$assetsPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($AssetsDirectory)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$configPath = Join-Path $outputPath ("builder-" + [guid]::NewGuid() + '.json')
$baseConfigPath = Join-Path $projectPath 'electron-builder.yml'
$yamlModule = Join-Path $projectPath 'node_modules\js-yaml'
$configJson = & node -e 'const fs = require("node:fs"); const yaml = require(process.argv[1]); process.stdout.write(JSON.stringify(yaml.load(fs.readFileSync(process.argv[2], "utf8"))));' $yamlModule $baseConfigPath
if ($LASTEXITCODE -ne 0) { throw "Reading electron-builder configuration failed ($LASTEXITCODE)." }
$config = $configJson | ConvertFrom-Json -AsHashtable
# Extending the YAML would merge both web resource sets into the same destination.
$config.extends = $null
$config.directories.output = $outputPath
$config.extraMetadata = @{ version = $Version }
$config.extraResources = @(@{ from = $webPath; to = 'web/dist' })

try {
    $config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
    & npm --prefix $projectPath run dist -- --config $configPath --win nsis appx --x64 --arm64 --publish never
    if ($LASTEXITCODE -ne 0) { throw "Building Windows packages failed ($LASTEXITCODE)." }

    $appx = @(Get-ChildItem -LiteralPath $outputPath -Filter '*.appx' -File)
    $exe = @(Get-ChildItem -LiteralPath $outputPath -Filter '*.exe' -File)
    if ($appx.Count -ne 2 -or $exe.Count -ne 1) {
        throw "Expected two architecture-specific AppX packages and one universal NSIS installer; found $($appx.Count) and $($exe.Count)."
    }
    $packages = @()
    foreach ($arch in @('x64', 'arm64')) {
        $appxPath = Join-Path $outputPath "TeslaSync-$Version-$arch.appx"
        if (-not (Test-Path -LiteralPath $appxPath)) { throw "Missing $arch AppX package." }
        $suffix = if ($arch -eq 'x64') { '' } else { '-arm64' }
        $msixPath = Join-Path $outputPath "TeslaSync-$Version$suffix.msix"
        & "$projectPath\package-msix.ps1" -Appx $appxPath -Msix $msixPath -Architecture $arch
        $packages += $msixPath
    }
    $bundlePath = Join-Path $outputPath "TeslaSync-$Version.msixbundle"
    & "$projectPath\package-msix.ps1" -Packages $packages -Bundle $bundlePath

    New-Item -ItemType Directory -Path $assetsPath -Force | Out-Null
    Copy-Item -LiteralPath $exe[0].FullName -Destination (Join-Path $assetsPath "TeslaSync-$Version-setup.exe")
    foreach ($package in $packages + @($bundlePath)) {
        Copy-Item -LiteralPath $package -Destination $assetsPath
    }
    Write-Output "Windows release assets: $assetsPath (universal installer, x64 MSIX, ARM64 MSIX, Store bundle)"
} finally {
    Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
}
