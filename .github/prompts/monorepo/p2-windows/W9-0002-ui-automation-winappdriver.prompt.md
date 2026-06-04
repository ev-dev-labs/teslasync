---
description: "P2/W9-0002 — Windows UI automation tests with WinAppDriver"
---

# P2 · W9-0002 — UI automation tests with WinAppDriver

> **Severity:** Quality gate · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+, packaged app, and WinAppDriver/Appium runner; if UI automation runner is absent, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/**UITests/**`, UI automation fixtures/scripts under apps/windows |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W3-0001 DONE, W7 generated pages DONE, W8 polish DONE, W9-0001 DONE |
| Blocks | W99 acceptance |
| ADR refs | ADR-010, ADR-011, ADR-015, ADR-016 |
| Instr refs | WinAppDriver/Appium pins from `apps/versions.lock.md`; Microsoft UI Automation guidelines |
| Log | `../logs/p2-w9-0002-ui-automation-winappdriver.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create end-to-end UI automation covering shell navigation, component states, authenticated flows, live/offline states, and page parity state transitions using WinAppDriver/Appium on Windows.

## Spec

- Use WinAppDriver or Appium Windows driver as pinned; start packaged TeslaSync app under test with deterministic test profile.
- Cover shell: launch, NavigationView groups, search/command palette, deep links, back/forward, title bar/window resize, theme switch, keyboard navigation.
- Cover auth: signed-out route guard, sign-in fake callback, token refresh failure/reauth banner, sign-out cleanup with secure store fake.
- Cover core components: buttons, dialogs, data tables, tabs, charts accessible table alternative, maps route summary, forms validation, EmptyState/ErrorDisplay/Skeleton.
- Cover representative pages from each route group and every state: loading, empty, error, cached/offline, refreshing, live stale, success.
- Cover platform polish: toast activation route, jump list route, taskbar status, settings persistence.
- Enforce accessibility basics through UI Automation tree: names, roles/control types, focus order, keyboard-only path, high-contrast run where feasible.
- Tests must use seeded local/fake API fixtures and never hit production TeslaSync or Tesla APIs.

## Implementation steps

1. Verify W9-0001 unit tests are DONE.
2. Survey package identity, UI Automation names from W2/W3/W7, and available WinAppDriver/Appium runner.
3. Add UI test project/harness under apps/windows with app launch, fixture server/fake auth, screenshot-on-failure, and log collection.
4. Implement tests by route group and state; do not skip pages without logging explicit parity-ledger reason.
5. Add CI/run script for Windows UI automation and fail if required runner is absent unless marked BLOCKED.
6. Run the gate and archive UI test logs/screenshots under allowed app test artifacts.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w9-0002-ui-automation-winappdriver.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build --filter Category!=UIAutomation 2>&1 | Tee-Object $log -Append
$unitExit = $LASTEXITCODE; "UNIT_TEST_EXIT=$unitExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build --filter Category=UIAutomation 2>&1 | Tee-Object $log -Append
$uiExit = $LASTEXITCODE; "UI_AUTOMATION_EXIT=$uiExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('UIAutomation','WinAppDriver','NavigationView','DeepLink','HighContrast','AutomationProperties','Toast','JumpList')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.ps1 | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_UI_AUTOMATION_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($unitExit -ne 0) -or ($uiExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] UI automation covers shell, auth, components, representative page states, platform polish, and accessibility tree basics.
- [ ] Tests run against deterministic local/fake fixtures only.
- [ ] Failure artifacts/logs/screenshots are captured under apps/windows test artifacts.
- [ ] CI/run script documents runner requirements and blocks honestly when absent.
- [ ] Build, format, unit test, UI automation, placeholder, and marker gates are green.

## Out of Scope

- No manual-only QA as a substitute for automated tests.
- No production API/Tesla API calls.
- No page implementation work beyond testability fixes under allowed files.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w9-0002-ui-automation-winappdriver.log
git commit -m "test(apps/windows): add WinAppDriver UI automation (P2/W9-0002)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
