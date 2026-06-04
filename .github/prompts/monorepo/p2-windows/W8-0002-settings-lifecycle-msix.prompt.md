---
description: "P2/W8-0002 — Windows settings, app lifecycle, and MSIX packaging basics"
---

# P2 · W8-0002 — Settings, lifecycle, and MSIX packaging basics

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+ and MSIX packaging tools; if no runner/signing capability exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Platform/Lifecycle/**`, settings storage, MSIX packaging/signing config |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W3-0001 DONE, W4-0001 DONE, W5-0001 DONE, W8-0001 DONE |
| Blocks | W8-0003, W99 acceptance |
| ADR refs | ADR-002, ADR-005, ADR-008, ADR-011, ADR-013, ADR-015, ADR-016 |
| Instr refs | Microsoft Fluent, Windows app lifecycle, and MSIX packaging guidelines; version lock `apps/versions.lock.md` |
| Log | `../logs/p2-w8-0002-settings-lifecycle-msix.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Complete Windows platform settings, app lifecycle resilience, and MSIX packaging fundamentals required for a polished signed Windows app.

## Spec

- Implement app settings service for theme, density, units/display preferences, API base URL/profile, notification preferences, privacy/telemetry opt-in, cache size/clear, startup behavior, and developer diagnostics toggles.
- Use appropriate storage: non-secret preferences in Windows app local settings; tokens only in W4 secure storage; cache in W5 SQLite.
- Wire lifecycle events: launch/activation/deep link, suspend/resume, network changes, foreground/background live data pause/resume, crash-safe save, single-instance activation if required.
- Add settings UI surfaces/routes integrated into W3 shell and W7 Settings page prompts without duplicating page parity.
- Configure MSIX package identity, app display name, versioning, capabilities, assets, protocol activation, file associations if any, and signing profile using locked toolchain; no private cert committed.
- Add packaging smoke checks and documentation comments in project files only where required.

## Implementation steps

1. Verify W8-0001 and dependencies are DONE.
2. Survey package manifest, app settings page requirements, and Microsoft lifecycle/MSIX guidelines.
3. Implement settings service/view models and lifecycle coordinator.
4. Wire lifecycle to W6 SSE and W5 cache; resume must not duplicate streams or show stale-as-live.
5. Update MSIX packaging files/assets under `apps/windows/**` and signing configuration entries that read external secrets from CI variables, not repo secrets.
6. Add tests for settings persistence, secure/non-secure separation, lifecycle transitions, and package manifest assertions.
7. Run gate; if signing cert unavailable, package build may BLOCK with exact missing signing capability.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w8-0002-settings-lifecycle-msix.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
dotnet publish apps/windows/TeslaSync.App/TeslaSync.App.csproj -c Release 2>&1 | Tee-Object $log -Append
$publishExit = $LASTEXITCODE; "PUBLISH_EXIT=$publishExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('ApplicationData.Current.LocalSettings','Suspending','Resuming','Package.appxmanifest','Protocol','MSIX','TelemetryOptIn')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml,*.xml,*.appxmanifest,*.pubxml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch [regex]::Escape($_) })
"MISSING_SETTINGS_LIFECYCLE_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($publishExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Settings service separates non-secret settings from W4 secure storage.
- [ ] Lifecycle events coordinate cache/live/auth without duplicate streams or stale-as-live UI.
- [ ] MSIX package identity/assets/capabilities/protocol activation are configured.
- [ ] Publish/package gate succeeds or BLOCKED only for missing signing/package capability.
- [ ] Build, format, test, publish, placeholder, and marker gates are green.

## Out of Scope

- No store submission metadata.
- No private signing certificates or secrets committed.
- No W7 page parity rewrites.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w8-0002-settings-lifecycle-msix.log
git commit -m "feat(apps/windows): add settings lifecycle and MSIX basics (P2/W8-0002)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
