---
description: "P4/P6 — Apple live data SSE lifecycle binding"
---

# P4 · P6 · 0001 — Live data SSE lifecycle binding

> **Severity:** Foundation (blocks live Apple panels) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Bind shared SSE streams to SwiftUI scene/view lifecycle with foreground-only live data,
> reconnect, staleness, cache handoff, and auth refresh per ADR-009/013.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Live/` |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P1 facade, P4/P5 auth, P1/S4-0002 SSE client |
| Blocks | live P7 pages, P6-0002 push, P8 widgets/live activities |
| ADR refs | ADR-002, ADR-004, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p4-p6-0001-live-data-sse.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement Apple-native lifecycle binding for live TeslaSync data so SwiftUI views receive fresh
SSE updates while foregrounded, mark stale honestly, cancel cleanly, and never pretend SSE is a
background notification channel.

## Spec

- **Lifecycle:** connect SSE only when scene is active and a subscribing view/model is visible;
  pause/cancel on background or disappearance; resume with Last-Event-ID through shared client.
- **State model:** `@Observable` live store merges cached REST data, live events, connection state,
  `fetchedAt`, `lastEventAt`, stale >2 min, retry/error, and manual refresh.
- **Auth:** SSE reconnect uses current token; 401 delegates to P5 refresh and retries once.
- **Subscriptions:** vehicle live signals, fleet events, notifications, command status, and page-specific
  signal streams bind via typed shared facade APIs.
- **UI integration:** provide `LiveDataTask` view modifier or model helper, stale banners, reconnect affordance,
  and redacted/loading/empty/error state helpers.
- **Observability:** redacted connection diagnostics; no VIN/token/location precision in logs.

## Implementation steps

1. Survey shared SSE taxonomy and web `useRealtimeEvents`/live hooks; log stream types and states.
2. Implement live store, lifecycle modifiers, scene phase handling, connection/staleness models,
   and retry/auth refresh integration.
3. Add tests with fake `AsyncSequence` for open/reconnect/stale/error/cancel/background/foreground transitions.
4. Add XCUITest/demo screen coverage proving stale banner and live indicator behavior on both idioms.
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

- [ ] SSE connects only while foreground/visible, resumes with Last-Event-ID, and cancels cleanly.
- [ ] Live state exposes loading/empty/error/stale/fresh states with 2-minute stale contract.
- [ ] 401 refresh path and redacted observability are wired; no background SSE usage.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

APNs/Live Activities, individual page rendering, and backend SSE changes.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p6-0001-live-data-sse.log
git commit -m "feat(apps/apple): bind SSE live data to SwiftUI lifecycle (P4/P6)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
