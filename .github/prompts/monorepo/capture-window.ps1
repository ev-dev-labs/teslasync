#requires -Version 7.0
<#
.SYNOPSIS
  Capture a screenshot of a running window by title — no WinAppDriver needed.
  Used by the parity loop to produce visual evidence for each unit so a unit can
  only be marked "done" when a real screenshot exists to compare against the web.

.EXAMPLE
  pwsh capture-window.ps1 -Title TeslaSync -Out apps/windows/.loop-logs/shots/dashboard.png
#>
param(
  [string]$Title = 'TeslaSync',
  [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process |
  Where-Object { $_.MainWindowTitle -match $Title -and $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1
if (-not $proc) { Write-Error "No window matching title '$Title' (is the app running?)"; exit 2 }

$h = $proc.MainWindowHandle
[void][WinCap]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 300
$rect = New-Object WinCap+RECT
[void][WinCap]::GetWindowRect($h, [ref]$rect)
$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top
if ($w -le 0 -or $ht -le 0) { Write-Error "Bad window rect ${w}x${ht}"; exit 3 }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
# PW_RENDERFULLCONTENT = 2  (captures modern/WinUI surfaces)
[void][WinCap]::PrintWindow($h, $dc, 2)
$g.ReleaseHdc($dc); $g.Dispose()

$dir = Split-Path $Out -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $Out (${w}x${ht})"
