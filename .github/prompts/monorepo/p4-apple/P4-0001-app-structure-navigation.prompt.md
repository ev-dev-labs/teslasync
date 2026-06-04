---
description: "P4/P4 — Apple adaptive app structure and navigation"
---

# P4 · P4 · 0001 — Adaptive app structure and navigation

> **Severity:** Foundation (blocks Apple pages) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Implement the SwiftUI app shell and navigation graph matching `web/src/App.tsx` route groups:
> NavigationSplitView for macOS/iPadOS, TabView for iPhone, deep links, and macOS commands.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/App/`, navigation registration, app string catalog |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P1 facade, P4/P2 tokens, P4/P3 component library |
| Blocks | P4/P5 auth, P4/P6 live, all P7 page registration, P8 polish |
| ADR refs | ADR-002, ADR-005, ADR-010, ADR-011, ADR-014, ADR-015, ADR-016 |
| Log | `../logs/p4-p4-0001-app-structure-navigation.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Build the complete adaptive SwiftUI app shell and route registry that can host every generated
Apple page at parity while feeling native on macOS, iPadOS, and iOS.

## Spec

- **Route source:** mirror `web/src/App.tsx` route groups and standalone routes: Dashboard,
  Vehicles, Charging, Trips, Battery/Energy, Driving/Performance, Analytics/Statistics,
  Maps/Location, Vehicle Systems, Automations, Notifications/Alerts, Telemetry/Signals,
  Diagnostics, Admin/DevTools, Power User, System/Ops, Settings/Account, Onboarding,
  Explore, Search, Sharing, Watch.
- **Idioms:** macOS+iPadOS use `NavigationSplitView` with searchable sidebar, detail column,
  toolbar, keyboard shortcuts, pointer support; iPhone uses `TabView` with grouped stacks and
  overflow/search entry; all share one route enum/deep-link parser.
- **Deep links:** support custom scheme and universal links for route paths including IDs/tokens;
  preserve aliases/redirects from `App.tsx` (e.g. `/battery`, `/battery/health`, `/charging/curves`).
- **Chrome:** page title, breadcrumbs where useful, recent pages, command palette entry, route announcer,
  loading/error boundary equivalent, onboarding gate, scroll restoration equivalent.
- **macOS commands:** app menu, File/Export, View/sidebar/tabs, Navigate/recent, Vehicle, Commands,
  Help, keyboard shortcuts.
- **Localization/a11y:** all labels in String Catalogs; VoiceOver announces route changes.

## Implementation steps

1. Survey `web/src/App.tsx` and log every route group, alias, standalone route, and page host requirement.
2. Define `AppRoute` enum, route registry metadata, deep-link parser, and adaptive shell containers.
3. Implement `NavigationSplitView` shell for macOS/iPadOS and `TabView` shell for compact iPhone.
4. Add macOS command menus, toolbar/search/recent pages, route announcer, onboarding gate, and explicit route-host registration for generated P7 pages.
5. Add unit/UI tests for route parsing, alias redirects, deep links, menu commands, and idiom-specific navigation.
6. Run the full Apple gate on iOS Simulator and macOS.

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/LINT/FORMAT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] Route registry covers every route group and alias from `web/src/App.tsx` with typed deep links.
- [ ] macOS/iPadOS use adaptive `NavigationSplitView`; iPhone uses `TabView` with stack navigation.
- [ ] macOS menus/commands, search, recent pages, onboarding gate, error/loading chrome, and route announcements work.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Implementing individual P7 pages, auth protocol internals, push notifications, and widgets.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p4-0001-app-structure-navigation.log
git commit -m "feat(apps/apple): add adaptive SwiftUI navigation shell (P4/P4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
