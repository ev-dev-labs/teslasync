---
description: "P4/P1 — Apple Swift facade over KMP Shared.xcframework"
---

# P4 · P1 · 0001 — Swift facade over Shared.xcframework

> **Severity:** Foundation (blocks Apple data binding) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Build the Swift 6 ergonomic facade over KMP `Shared.xcframework`: async/await,
> Observation wrappers, Flow bridging, and golden-vector parity proof.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/SharedFacade/` |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P0-0001 (workspace), P1/S3 (`Shared.xcframework`), P1/S4 networking + SSE |
| Blocks | P4/P4 navigation data binding, P4/P5 auth, P4/P6 live data, every Apple page |
| ADR refs | ADR-002, ADR-004, ADR-010, ADR-011, ADR-013, ADR-015 |
| Log | `../logs/p4-p1-0001-shared-facade.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create a production Swift facade that makes KMP suspend APIs and Flows feel native to
SwiftUI: `async throws` calls, `AsyncSequence` streams, `@Observable` state models,
cancellation propagation, main-actor UI updates, and golden-vector parity with the shared core.

## Spec

- **Interop layer:** wrap generated Kotlin framework symbols in Swift types that hide KMP
  naming/nullability rough edges; expose domain facades for vehicles, charging, drives,
  trips, battery/energy, analytics, telemetry/signals, notifications, settings, system, auth.
- **Async/await:** every KMP suspend operation gets a Swift `async throws` wrapper with typed
  error mapping (`Api`, `Auth`, `Offline`, `Decode`, `Cancelled`) and cooperative cancellation.
- **Flow bridge:** convert Kotlin Flow/StateFlow to `AsyncThrowingStream` and `@Observable`
  model state; close upstream collectors on task cancellation or view disappearance.
- **Observation:** provide base `LoadableState<Value>` and feature view-model adapters with
  loading/empty/error/stale states; all state mutations that affect UI are `@MainActor`.
- **Golden vectors:** run fixtures from `apps/shared/spec/` through the Swift facade and assert
  SI conversion, formatting, request-prefix behavior, error mapping, and live-event mapping match KMP.
- **No networking in views:** SwiftUI pages consume only these facade/view-model types, never raw KMP APIs.

## Implementation steps

1. Survey exported `Shared.xcframework` symbols and document the Swift names in the log.
2. Add a `SharedFacade` module/group with Swift wrappers, typed errors, cancellation helpers,
   Flow-to-`AsyncThrowingStream` bridge, and `@Observable` state adapters.
3. Add golden-vector XCTest cases for units/formatting, API prefix-once semantics, auth refresh
   state, cached freshness, and SSE event taxonomy.
4. Add a small app-level dependency container that owns the shared core instance and injects facades.
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

- [ ] Swift facade exposes native `async throws` and `AsyncSequence` APIs for all shared domains.
- [ ] `@Observable` wrappers model loading/empty/error/stale states and propagate cancellation.
- [ ] Golden-vector XCTest coverage proves parity with KMP fixtures; no raw KMP symbols leak into views.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

UI component rendering, app navigation, auth UI, APNs, and page implementations.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p1-0001-shared-facade.log
git commit -m "feat(apps/apple): add Swift facade over Shared.xcframework (P4/P1)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
