---
description: "P3/A6 — Android foreground SSE lifecycle binding"
---

# P3 · A6 · 0001 — Live data SSE lifecycle binding

> **Severity:** Live-data foundation · **Delegation:** FORBIDDEN
> Bind the shared KMP SSE client to Android foreground lifecycle, app visibility, stale-state indicators, and page ViewModels per ADR-009.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` live/SSE lifecycle integration |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P1/S4-0002 SSE client, P3/A4 auth, P3/A5 data layer |
| Blocks | live Android pages and widgets consuming current vehicle state |
| ADR refs | ADR-002, ADR-004, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a6-0001-live-data-sse.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Ensure Android live UI uses foreground-only SSE subscriptions safely, resumes on app foreground, reconnects with auth, and marks stale data honestly.

## Spec

- Use `ProcessLifecycleOwner`, lifecycle-aware collection, and shared `SseClient`/state holders from KMP; do not keep background streams alive for notifications.
- Bind app foreground/background to connect/disconnect/resume; reconnect with backoff and `Last-Event-ID` through the shared client.
- Surface connection states (`Connecting`, `Open`, `Reconnecting`, `Stale`, `Closed`, `Error`) into A2 `LiveIndicator`/`LiveStaleDataBanner`.
- Treat live values older than 2 minutes as stale per ADR-009/013; do not hide panels when stale.
- Re-auth SSE on token refresh/401 without per-page token code; log only redacted event metadata.

## Implementation steps

1. Survey shared SSE client contract and live web hook behavior; record mapped events/states.
2. Implement lifecycle binding service/composable helpers and ViewModel integration points.
3. Wire connection/staleness UI components and retry actions.
4. Add unit tests with fake lifecycle owner and fake SSE flow for foreground, background, reconnect, stale, auth refresh, and cancellation.
5. Run the gate.

## Gate

```powershell
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug 2>&1 | Tee-Object $log -Append; "ASM_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:lintDebug ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if all *_EXIT values are 0 and the placeholder scanner is clean
```

## Acceptance Criteria

- [ ] SSE connects only while app/page lifecycle requires foreground live data and cancels cleanly.
- [ ] Reconnect, Last-Event-ID, 401 refresh, stale >2 min, and retry states are visible/tested.
- [ ] Live panels get stale/error indicators instead of blank content.
- [ ] Gate green; placeholder scanner clean; `EXIT=0` / `STATUS=DONE`.

## Out of Scope

FCM push registration, background notifications, page layout implementation, backend SSE changes.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a6-0001-live-data-sse.log
git commit -m "feat(apps/android): bind SSE live data to lifecycle (P3/A6)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
