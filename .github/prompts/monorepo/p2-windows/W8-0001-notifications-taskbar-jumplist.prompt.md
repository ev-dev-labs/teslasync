---
description: "P2/W8-0001 — Windows toasts, taskbar, and jump list polish"
---

# P2 · W8-0001 — Notifications, toasts, taskbar, and jump list polish

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+ with packaged app identity; if no runner/package identity exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Platform/Notifications/**`, taskbar/jump-list integration, assets/tests |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W3-0001 DONE, W4-0001 DONE, W6-0002 DONE |
| Blocks | W8-0002, W99 acceptance |
| ADR refs | ADR-002, ADR-005, ADR-009, ADR-011, ADR-015, ADR-016 |
| Instr refs | Microsoft Fluent and Windows app notification/taskbar guidelines |
| Log | `../logs/p2-w8-0001-notifications-taskbar-jumplist.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Add polished Windows notification surfaces: actionable toast notifications, foreground in-app notifications, taskbar status/badges/progress, and jump lists tied to real app routes.

## Spec

- Implement toast notification composition/activation using Windows App SDK notification APIs with localized title/body/actions and deep links into W3 routes.
- Support notification types used by TeslaSync: alerts, charge complete, vehicle state changes, automation events, command results, system incidents, reauth needed.
- Add foreground toast/in-app banner coordination so a push can show in-app only when active and OS toast when appropriate.
- Implement taskbar badge/progress/status indicators for active command/export/sync jobs with honest completion/error states.
- Create JumpList entries for Dashboard, Vehicles, Charging, Drives, Live Map, Notifications Inbox, Settings, and Search using route deep links.
- Respect Windows notification quiet hours/focus assist, app settings toggles, and ADR-016 privacy redaction.
- Add activation tests/fakes for toast action routing and jump list construction.

## Implementation steps

1. Verify W3/W4/W6-0002 are DONE.
2. Survey Windows notification APIs and package manifest capabilities.
3. Implement toast service, activation handler, taskbar service, jump-list service, and settings integration.
4. Wire notification repository updates from W6 push and W5 data layer.
5. Add tests for payload mapping, localization keys, deep links, redaction, taskbar status, and jump-list routes.
6. Run gate; if package identity prevents live toast activation locally, unit tests still run and live activation is BLOCKED with reason.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w8-0001-notifications-taskbar-jumplist.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('Toast','JumpList','Taskbar','Activation','FocusAssist','NotificationsInbox')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml,*.appxmanifest | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_POLISH_NOTIFICATION_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Toasts are actionable, localized, deep-linkable, and privacy-redacted.
- [ ] Foreground in-app notifications coordinate with OS toasts.
- [ ] Taskbar badge/progress/status reflects real jobs only.
- [ ] JumpList routes open valid W3 route definitions.
- [ ] Build, format, test, placeholder, and marker gates are green.

## Out of Scope

- No WNS registration changes (W6-0002).
- No backend notification worker changes.
- No fake/demo notifications as final behavior.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w8-0001-notifications-taskbar-jumplist.log
git commit -m "feat(apps/windows): add Windows notification polish (P2/W8-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
