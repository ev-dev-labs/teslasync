---
description: "P4/P8 — App Intents, Shortcuts, Handoff, menus and commands"
---

# P4 · P8 · 0002 — App Intents, Handoff, menus, and commands

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Add Apple-native automation and continuity: App Intents/Shortcuts, Handoff, Spotlight,
> macOS menus/commands, keyboard shortcuts, and settings integration.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Platform/Intents/`, commands, handoff, settings polish |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P4 navigation, P4/P5 auth, P4/P7 pages, P8-0001 widgets |
| Blocks | P99 Apple acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-010, ADR-011, ADR-014, ADR-015, ADR-016 |
| Log | `../logs/p4-p8-0002-intents-handoff-menus.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Make TeslaSync feel deeply native by exposing safe App Intents/Shortcuts, Handoff/continuity,
Spotlight/recent activities, macOS menus, commands, and platform settings without duplicating
business logic outside the shared facade.

## Spec

- **App Intents/Shortcuts:** open vehicle, view charging status, start common command where backend
  permissions allow, refresh vehicle state, show latest alert, open live map, export report.
- **Safety:** commands require auth, confirmation, clear result/error states, and never log PII.
- **Handoff:** continue current route/page between iPhone/iPad/macOS using route registry and Universal Links.
- **Spotlight/recent:** index non-sensitive route shortcuts and recent pages; respect privacy settings.
- **macOS menus/commands:** complete File/View/Navigate/Vehicle/Commands/Window/Help menus, toolbar commands,
  keyboard shortcuts, sidebar toggles, export/print where supported.
- **Settings:** native Settings scene for appearance, units, notifications, privacy/analytics opt-in,
  biometric unlock, cache/offline, developer diagnostics; all use shared settings facade.

## Implementation steps

1. Survey route registry, command capabilities, settings pages, and HIG command conventions; log scope.
2. Implement App Intents and Shortcuts with typed parameters, auth gates, confirmations, and tests.
3. Add Handoff activities, Spotlight indexing, recent-page continuation, and Universal Link route restoration.
4. Complete macOS command menus/keyboard shortcuts and native Settings scene.
5. Add unit/UI tests for intent parameter resolution, command confirmation, handoff route restoration, and menus.
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

- [ ] App Intents/Shortcuts are complete, safe, authenticated, localized, and tested.
- [ ] Handoff, Spotlight/recent pages, route restoration, and macOS command menus work.
- [ ] Settings scene covers appearance, units, notifications, privacy, auth, cache, diagnostics.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

New backend command APIs, watchOS companion, and acceptance-ledger gate.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p8-0002-intents-handoff-menus.log
git commit -m "feat(apps/apple): add App Intents Handoff and commands (P4/P8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
