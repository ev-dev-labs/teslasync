---
description: "P2/W3-0001 — Windows NavigationView shell and route registry"
---

# P2 · W3-0001 — Navigation shell and route registry

> **Severity:** Foundational app shell · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Shell/**`, route registry, window/title-bar integration |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE, W2-0001..W2-0005 DONE |
| Blocks | W4 auth/onboarding, W7 pages, W8 polish, W9 UI tests |
| ADR refs | ADR-002, ADR-005, ADR-011, ADR-014, ADR-015, ADR-016 |
| Instr refs | web route source `web/src/App.tsx`; version lock `apps/versions.lock.md` |
| Log | `../logs/p2-w3-0001-navigation-shell.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Build the native Windows NavigationView shell, route registry, deep-link handling, window chrome, and route state behavior matching the web app's route groups without implementing page bodies.

## Spec

- Use WinUI `NavigationView` with left pane groups matching `web/src/App.tsx`: Dashboard/Explore, Vehicles, Charging, Trips/Driving, Battery/Energy, Analytics, Maps/Location, Vehicle Systems, Automations, Notifications, Telemetry/Signals, Diagnostics, Admin/DevTools, Power User, System/Ops, Settings/Account/Integrations, Sharing, Onboarding, Watch/standalone.
- Register all web routes from `App.tsx`, including aliases/redirects, parameter routes (`vehicles/:id`, `drives/:id`, `charging/:id`, `trips/:id`, `system-status/incidents/:id`, `s/:token`), outer standalone routes (`quick-stats`, `glance`, `watch`, `onboarding`), and catch-all NotFound.
- Implement a typed route table with route name, path pattern, group, icon, page factory, auth requirement, standalone-shell mode, and deep-link URI mapping.
- Use WinUI `Frame` navigation with back stack, keyboard accelerators, breadcrumb/title updates, route announcements via W2 a11y primitive, recent-page recorder equivalent, and scroll restoration where applicable.
- Implement custom title bar using Windows App SDK `AppWindow`/ExtendsContentIntoTitleBar, Mica backdrop, minimum window size, persisted size/position, and theme switching.
- Page factories must point to generated W7 page classes when present. For routes whose generated pages are absent, register the route metadata and fail the route-coverage gate instead of creating visual placeholder pages.

## Implementation steps

1. Verify all W2 component logs are DONE.
2. Survey `web/src/App.tsx` and record the route inventory in the log with counts by group.
3. Implement `RouteDefinition`, `RouteRegistry`, route parser, redirect resolver, and deep-link activation handling.
4. Build `ShellWindow`/`ShellViewModel` with `NavigationView`, top commands, search entry point, settings/account shortcuts, breadcrumbs, and status bar.
5. Wire standalone route mode for share/watch/onboarding as App.tsx does outside the main layout.
6. Add unit tests for route matching, parameter extraction, redirects, deep links, and back-stack behavior.
7. Run the gate; if any App.tsx route is missing, STATUS=BLOCKED.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w3-0001-navigation-shell.log"
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
$required = @('NavigationView','RouteRegistry','DeepLink','AppWindow','ExtendsContentIntoTitleBar','RouteAnnouncer')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_SHELL_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] NavigationView groups cover every route group from `web/src/App.tsx`.
- [ ] Route registry includes path patterns, aliases, redirects, parameter routes, standalone routes, and catch-all.
- [ ] Deep links, back stack, title updates, breadcrumbs, route announcements, and persisted window state work.
- [ ] Shell is tokenized, Mica-backed, keyboard accessible, and localized.
- [ ] Build, format, test, placeholder, and shell-marker gates are green.

## Out of Scope

- No W7 page parity implementations.
- No auth token flow (W4) beyond route metadata.
- No fake final pages or placeholder navigation entries omitted to make the gate pass.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w3-0001-navigation-shell.log
git commit -m "feat(apps/windows): add NavigationView shell (P2/W3-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
