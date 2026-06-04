---
description: "P4/P9 — Apple XCUITest UI coverage"
---

# P4 · P9 · 0002 — XCUITest UI tests

> **Severity:** Quality gate · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode and simulators; if the gate can't run → STATUS=BLOCKED.
> Add XCUITest coverage for component states and page parity states on both Apple idioms.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/**UITests/` XCUITest suites, UI fixtures, launch arguments |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P9-0001 XCTest unit coverage, P4/P7 page implementations |
| Blocks | P99 Apple acceptance gate |
| ADR refs | ADR-002, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-014, ADR-015 |
| Log | `../logs/p4-p9-0002-xcuitest-ui.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Validate the real Apple UI across macOS/iPad split navigation and iPhone tab navigation, covering
components and every page's loading/empty/error/success/stale states with deterministic fixtures.

## Spec

- **Harness:** launch arguments select fixture datasets, auth state, locale, appearance, Dynamic Type,
  Reduce Motion, network/offline mode, and route/deep link.
- **Idioms:** run iOS Simulator iPhone compact, iPad regular if available, and macOS; log any unsupported
  destination as BLOCKED rather than silently skipping.
- **Components:** exercise UI, charts, data-display, feedback/forms, maps/motion with accessibility identifiers
  and VoiceOver-relevant labels.
- **Pages:** each P7 parity unit has UI tests for loading, empty, error+retry, success, stale/offline, and
  deep-link navigation; charts/maps have accessible alternate summaries.
- **Flows:** onboarding/auth shell, route aliases, search/command palette, notification deep links,
  settings changes, widget/deep link handoff seams where testable.

## Implementation steps

1. Inventory XCUITest targets, route registry, page parity ledgers, and component identifiers; log coverage plan.
2. Build deterministic fixture injection and UI launch helpers without real network or real auth.
3. Implement component and page-state UI tests across compact/regular/macOS idioms.
4. Add accessibility assertions for labels, hit targets where measurable, focus order, and dynamic text resilience.
5. Run the full Apple gate on iOS Simulator and macOS.

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

- [ ] XCUITest covers component states and every page parity state on iPhone and macOS, with iPad where available.
- [ ] Deep links, aliases, auth/onboarding shell, settings, notification routing, and error retry flows are tested.
- [ ] Accessibility and Dynamic Type checks are included; fixture mode uses no real network/auth.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if required simulators/runner missing).

## Out of Scope

Unit tests already covered by P9-0001 and archive/signing acceptance gate.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p9-0002-xcuitest-ui.log
git commit -m "test(apps/apple): add XCUITest UI coverage (P4/P9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
