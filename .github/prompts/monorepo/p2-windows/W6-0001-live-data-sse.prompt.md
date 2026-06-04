---
description: "P2/W6-0001 — Windows SSE live data client and bindings"
---

# P2 · W6-0001 — Live data SSE client and foreground bindings

> **Severity:** Live data foundational · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+ and reachable API fixture; if no runner/API exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Live/**`, repository live bindings, diagnostics/tests |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W4-0001 DONE, W5-0001 DONE |
| Blocks | W6-0002 push, W7 live pages, W8 platform polish |
| ADR refs | ADR-004, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-016 |
| Instr refs | version lock `apps/versions.lock.md`; backend live-state contract |
| Log | `../logs/p2-w6-0001-live-data-sse.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement a robust foreground SSE client for Windows and bind live vehicle/signal streams into repositories and view-model state with honest freshness/staleness semantics.

## Spec

- Implement `ISseClient` using `HttpClient` streaming (`text/event-stream`) with cancellation, incremental parsing, named events, comments/heartbeats, retry fields, exponential backoff with jitter, and foreground lifecycle pause/resume.
- Authenticate via W4 auth handler; on 401 refresh and reconnect once, then surface auth-required state.
- Support existing TeslaSync live endpoints used by web hooks: vehicle signal live streams and notification/system live feeds where present; historical data remains REST via W5.
- Bind SSE updates into W5 repositories/state holders without bypassing cache/freshness rules.
- Mark cross-pod/live values older than two minutes stale; expose `LiveIndicator`/`LiveStaleDataBanner` state.
- Add diagnostics counters/logs with PII redaction: connection state, reconnect count, parse errors, last-event timestamp, not VIN/location/token values.
- Include tests with a local in-process SSE fixture for event parsing, reconnect, auth refresh, stale detection, cancellation, and malformed event handling.

## Implementation steps

1. Verify W4/W5 logs are DONE.
2. Survey ADR-009 and web live hooks/SSE use; log endpoints and event shapes consumed.
3. Implement SSE parser/client, lifecycle service, repository integration, and live state models.
4. Add tests using an in-process fixture; do not require production TeslaSync credentials for unit tests.
5. Wire W2 data-display freshness/live components to live state.
6. Run gate; if an integration API fixture is unavailable, unit tests must still pass and the integration sub-gate may BLOCK with exact missing fixture reason.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w6-0001-live-data-sse.log"
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
$required = @('text/event-stream','ISseClient','LastEvent','Reconnect','Stale','LiveIndicator','LiveStaleDataBanner')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch [regex]::Escape($_) })
"MISSING_SSE_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] SSE client handles parsing, heartbeats, retry, backoff, cancellation, auth refresh, and lifecycle pause/resume.
- [ ] Live updates flow through repositories/state holders with stale/fresh indicators.
- [ ] Historical data is not reconstructed from SSE replay.
- [ ] PII-redacted diagnostics and fixture-backed tests are present.
- [ ] Build, format, test, placeholder, and SSE-marker gates are green.

## Out of Scope

- No WNS push registration (W6-0002).
- No backend live endpoint changes.
- No background SSE as a notification mechanism.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w6-0001-live-data-sse.log
git commit -m "feat(apps/windows): add SSE live client (P2/W6-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
