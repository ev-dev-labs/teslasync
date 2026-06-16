#requires -Version 7.0
<#
.SYNOPSIS
  Capture a screenshot of a running window by title — cross-platform (Windows/macOS/Linux),
  no WinAppDriver needed. Used by electron-loop.ps1 (E2) to produce the visual evidence that
  lets a unit be marked "done" only when a real screenshot exists to compare against the web app.

.EXAMPLE
  pwsh capture-window.ps1 -Title TeslaSync -Out .github/prompts/electron/logs/shots/dashboard.png
#>
param(
  [string]$Title = 'TeslaSync',
  [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'

$dir = Split-Path $Out -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

# ---------- Windows: PrintWindow (captures Chromium/Electron surfaces with PW_RENDERFULLCONTENT) ----------
if ($IsWindows) {
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
  [void][WinCap]::PrintWindow($h, $dc, 2) # PW_RENDERFULLCONTENT
  $g.ReleaseHdc($dc); $g.Dispose()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "saved $Out (${w}x${ht})"
  return
}

# ---------- macOS: screencapture (-l windowid via the window list) ----------
if ($IsMacOS) {
  $wid = (& osascript -e "tell application \"System Events\" to id of first window of (first process whose name contains \"$Title\")" 2>$null)
  if ($LASTEXITCODE -eq 0 -and $wid) {
    & screencapture -o -x -l $wid $Out
  }
  else {
    & screencapture -o -x $Out  # full screen fallback
  }
  if (Test-Path $Out) { Write-Output "saved $Out" } else { Write-Error 'screencapture failed'; exit 3 }
  return
}

# ---------- Linux: try gnome-screenshot, then ImageMagick import, then scrot ----------
if ($IsLinux) {
  $tools = @(
    @{ cmd = 'gnome-screenshot'; args = @('-w', '-f', $Out) },
    @{ cmd = 'import'; args = @('-window', $Title, $Out) },
    @{ cmd = 'scrot'; args = @('-u', $Out) }
  )
  foreach ($t in $tools) {
    if (Get-Command $t.cmd -ErrorAction SilentlyContinue) {
      & $t.cmd @($t.args) 2>$null
      if (Test-Path $Out) { Write-Output "saved $Out via $($t.cmd)"; return }
    }
  }
  Write-Error 'No screenshot tool found (install gnome-screenshot, imagemagick, or scrot)'; exit 4
}

Write-Error 'Unsupported OS for capture'; exit 5
