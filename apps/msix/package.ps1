<#
.SYNOPSIS
  Preflights a TeslaSync PWA for manual MSIX packaging at PWABuilder.com.

.EXAMPLE
  .\package.ps1 https://teslasync.example.com
#>
param(
  [Parameter(Mandatory = $true)][string]$SiteUrl
)

$ErrorActionPreference = "Stop"

# Localhost is a secure context, so PWABuilder accepts it for smoke tests.
# Note the packaged app keeps this URL — a localhost build only ever
# talks to the machine it runs on. Ship builds need your https:// domain.
if ($SiteUrl -notmatch '^https://' -and $SiteUrl -notmatch '^http://(localhost|127\.0\.0\.1)([:/]|$)') {
  throw "Site must be an https:// URL (http://localhost:* allowed for local smoke tests; got $SiteUrl)"
}

$manifestUrl = $SiteUrl.TrimEnd("/") + "/manifest.webmanifest"
Write-Host "-> validating PWA manifest at $manifestUrl"
try {
  $manifest = Invoke-RestMethod -Uri $manifestUrl -TimeoutSec 20
} catch {
  throw "No installable PWA manifest there. Is the server up and serving the web UI over HTTPS?"
}
if (-not $manifest.start_url) {
  throw "Manifest at $manifestUrl is missing start_url."
}

Write-Host "Manifest found. Open https://www.pwabuilder.com/ and enter $SiteUrl."
Write-Host "Select Windows to generate the MSIX; the @pwabuilder/cli does not support packaging."
