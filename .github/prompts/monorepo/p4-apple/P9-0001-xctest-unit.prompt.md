---
description: "P4/P9 — Apple XCTest unit coverage"
---

# P4 · P9 · 0001 — XCTest unit tests

> **Severity:** Quality gate · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Add comprehensive XCTest unit coverage for Apple infrastructure, components, state models,
> golden vectors, and page state logic on macOS + iOS/iPadOS.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/**Tests/` unit test suites and fixtures |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P1..P8 infrastructure and generated P7 pages |
| Blocks | P9-0002 XCUITest, P99 Apple acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p4-p9-0001-xctest-unit.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Bring Apple unit coverage to the ADR-010 quality bar by testing facade behavior, tokens,
components, auth, live data, widgets/intents/watch support, and every page view-model state.

## Spec

- **Facade/golden:** async wrappers, Flow bridge cancellation, typed errors, SI/unit golden vectors,
  prefix-once semantics, cache freshness, SSE event mapping.
- **Design/components:** token drift, light/dark/Dynamic Type, UI component state reducers,
  chart formatters, data-display formatting, forms validation, map helpers, motion Reduce Motion.
- **Auth/live/push:** PKCE, Keychain test seam, refresh single-flight, SSE reconnect/stale/cancel,
  APNs payload parsing, Live Activity models.
- **Pages:** for each P7 parity unit, test view-model loading/empty/error/success/stale states and
  string-key coverage; no page is considered covered without all states.
- **Coverage:** target ≥80% for Apple presentation/logic plus explicit golden-vector parity tests.

## Implementation steps

1. Inventory existing XCTest targets and all Apple infrastructure/page modules; log coverage gaps.
2. Add deterministic fixtures and test seams for time, network, keychain, notification, and SSE streams.
3. Implement unit tests by category above; prefer table-driven fixtures and no real network/auth providers.
4. Add coverage reporting and fail the log if any required parity unit lacks all state tests.
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

- [ ] XCTest suites cover facade, tokens, components, auth, live/push, widgets/intents/watch, and every page state.
- [ ] Golden vectors pass through Swift facade; no real network or secret store dependency in tests.
- [ ] Coverage target and per-parity-unit state coverage are recorded in the log.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

XCUITest flows and acceptance ledger signing/archive gate.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p9-0001-xctest-unit.log
git commit -m "test(apps/apple): add XCTest unit coverage (P4/P9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
