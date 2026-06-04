---
description: "P1/S4 — SSE live-event client (shared) mirroring web useRealtimeEvents"
---

# P1 · S4 · 0002 — SSE live-event client

> **Severity:** Foundation · **Delegation:** FORBIDDEN
> The shared Server-Sent-Events client that streams live signal/state updates, mirroring web
> `useRealtimeEvents`. Feeds every live panel across all platforms.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/src/commonMain/.../net/sse/**` |
| Allowed files | `apps/shared/core/**`, the log file |
| Depends on | P1/S4-0001 (http client), P1/S3 |
| Blocks | P1/S8 live state holders; every live UI panel |
| ADR refs | ADR-009, ADR-013 |
| Log | `../logs/p1-s4-0002-sse.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A `SseClient` exposing a cold `Flow<LiveEvent>` per subscription with auto-reconnect
(backoff + `Last-Event-ID` resume), heartbeat/staleness detection (>2 min ⇒ stale, ADR-013),
and typed event parsing — matching the web event contract. Tested against a fake stream source.

## Spec

- Identify the web SSE endpoint(s) + event shapes from `web/src` (the `useRealtimeEvents` hook
  and the backend SSE hub) and reproduce the event taxonomy as a sealed `LiveEvent`.
- Connect via the S4 http client; parse `event:`/`data:`/`id:` frames; emit typed events.
- **Reconnect**: on drop, backoff-reconnect sending `Last-Event-ID`; surface a `Connection`
  state (Connecting/Open/Reconnecting/Stale/Closed).
- **Staleness**: if no event/heartbeat within the freshness window, mark `Stale` (don't drop).
- **Lifecycle**: subscription tied to Flow collection; cancel ⇒ close stream.
- **Testing**: feed scripted frames through a fake transport; assert parsing, reconnect-with-id,
  staleness transition, cancellation closes the stream. Virtual clock.

## Implementation steps

1. Frame parser (`event/data/id/retry`) + sealed `LiveEvent` from the web contract.
2. `SseClient.subscribe(...)` returning `Flow<LiveEvent>` + `StateFlow<Connection>`.
3. Reconnect/backoff/Last-Event-ID + staleness via injected `Clock`.
4. Fake-transport test suite; run gate.

## Gate

```powershell
Push-Location apps/shared/core
./gradlew :core:allTests 2>&1 | Tee-Object $log -Append; "TEST_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew ktlintCheck 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/shared/core -Language kotlin *>$null; "PH_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if TEST/LINT/PH all 0
```

## Acceptance Criteria

- [ ] Event taxonomy matches the web SSE contract (enumerated in log SURVEY).
- [ ] Reconnect resumes with Last-Event-ID; staleness marks (not drops); cancellation closes.
- [ ] Tests use fake transport + virtual clock; ktlint + placeholder clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Push notifications (P5/H5), per-feature live merging (S8), UI binding.

## Commit

```powershell
git add apps/shared/core .github/prompts/monorepo/logs/p1-s4-0002-sse.log
git commit -m "feat(apps/shared): SSE live-event client with reconnect+staleness (P1/S4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
