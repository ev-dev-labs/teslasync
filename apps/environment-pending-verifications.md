# Environment-pending verifications

Tracks acceptance-criteria items from monorepo prompts that **must be verified
on a specific host or with a specific runtime tool** which is unavailable on
the current dev box. This includes (non-exhaustive):

- **macOS-only:** Kotlin/Native Apple-framework linking, Xcode codesign, App Store packaging.
- **WinAppDriver/Appium absent:** Windows UI automation suites cannot exercise a packaged app.
- **Android emulator absent:** instrumented `androidTest` suites cannot run device-side.
- **No physical device:** any test requiring hardware (HoloLens, Vision Pro, Galaxy fold, etc).

Items here are **not unfinished work** — code is written, committed, and all
host-runnable gates are green. They are *deferred artifact verifications* that
the ADR-012 CI matrix (or a developer on a capable host) will execute later.
Each prompt's own capability note explicitly sanctions `STATUS=BLOCKED` for
its environmental gap, so the deliverable is contractually complete.

## Pending items

| Origin prompt | Commit | Deferred verification | Re-run command | Verifier (target) |
|---|---|---|---|---|
| `p1-shared/S3-0001-kmp-scaffold` | `5317ebcb1` | Produce `Shared.xcframework` binary (Kotlin/Native links Apple frameworks on macOS only) | `cd apps/shared && ./gradlew :core:assembleSharedXCFramework` | `p5-hardening/H8-0001-store-packaging` on `macos-latest` |
| `p2-windows/W9-0002-ui-automation-winappdriver` | `c41cb7f29` | Run 147 `[Category=UIAutomation]` xUnit tests against packaged app (WinAppDriver/Appium runner absent on dev host) | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver + packaged-app install (CI: `windows-latest` matrix lane) |
| `p2-windows/dashboard-widgets/W-0001-AlertFeedWidget` | `7b9575079` | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 cases incl. page-state matrix) against the packaged AlertFeedWidget; host-runnable gates (build, format, placeholder, 1010/1010 headless tests) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |
| `p2-windows/dashboard-widgets/W-0100-TelemetryErrorsWidget` | `4ca8d2ea3` | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 shell/navigation UI-automation cases) against the packaged app; host-runnable gates (build, format, placeholder, 5311/5311 headless tests incl. 43 TelemetryErrorsWidget cases) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |
| `p2-windows/feature-views/W-0016-HttpStatusTool` | `b697ff3bf` | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 shell/navigation UI-automation cases) against the packaged HttpStatusTool surface; host-runnable gates (build, format, placeholder, 6630/6630 headless tests incl. 35 HttpStatusTool cases) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |
| `p2-windows/feature-views/0109-CostForecastSection` | `189fe9688` | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 shell/navigation UI-automation cases) against the packaged CostForecastSection surface; host-runnable gates (build, format, placeholder, 9146/9146 headless tests incl. 30 CostForecastSection cases) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |
| `p2-windows/feature-views/0123-FleetStatsBar` | `406dde573` | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 shell/navigation UI-automation cases) against the packaged FleetStatsBar surface; host-runnable gates (build, format, placeholder, 9534/9534 headless tests incl. 28 FleetStatsBar cases) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |
| `p2-windows/feature-views/W-0046-SecurityStatusCards` | `ee1fcd3e8` | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 shell/navigation UI-automation cases) against the packaged app; host-runnable gates (build, format, placeholder, 12055/12055 headless tests incl. 61 SecurityStatusCards cases) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |
| `p2-windows/feature-views/0134-WidgetPicker` | _(adding commit)_ | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 shell/navigation + page-state-matrix UI-automation cases) against the packaged app; host-runnable gates (build, format, placeholder, 12695/12695 headless tests incl. 46 WidgetPicker cases) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |
| `p2-windows/feature-views/0181-BrowserPushChannelCard` | _(adding commit)_ | Run the WinAppDriver-driven `TeslaSync.App.UITests` (147 shell/navigation + page-state-matrix UI-automation cases) against the packaged app; host-runnable gates (build, format, placeholder, 13467/13467 headless tests incl. 42 BrowserPushChannelCard cases) are all green | `powershell apps/windows/run-ui-automation.ps1` | Windows runner with WinAppDriver provisioned (same as W9-0002) |

## Resolution protocol

When a capable runner (CI or local) executes one of these verifications and
the artifact/suite is produced + green, append a row to the table below
recording the run + SHA + log path, and strike through the corresponding
row above. **Do NOT delete the original row** — the audit trail matters
more than the parking-lot tidiness.

## Resolved verifications

| Original entry | Resolved commit | Verifier host | Log |
|---|---|---|---|

_(none yet)_
