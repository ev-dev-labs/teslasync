---
description: "P1/S4 — Resilient HTTP client, auth interceptor, retry/backoff/circuit-breaker (KMP)"
---

# P1 · S4 · 0001 — Networking foundation (Ktor, resilient)

> **Severity:** Foundation · **Delegation:** FORBIDDEN
> The shared HTTP layer all repositories use. Mirrors the web `request()` client's resilience
> (retry, backoff, circuit-breaker) and base-URL/`/api/v1` handling.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/src/commonMain/.../net/**` |
| Allowed files | `apps/shared/core/**`, the log file |
| Depends on | P1/S2 (generated client), P1/S3 (KMP scaffold) |
| Blocks | P1/S6 (auth wiring), P1/S7 (cache repos), all data |
| ADR refs | ADR-004, ADR-008, ADR-013 |
| Log | `../logs/p1-s4-0001-networking.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A configured Ktor `HttpClient` (OkHttp engine on android, Darwin on apple) with: base-URL +
auto `/api/v1` prefix, JSON (kotlinx) content negotiation, timeouts, retry-with-backoff on
idempotent calls, a circuit-breaker, structured error mapping, and a pluggable auth token hook
(filled by S6). Fully unit-tested with a mock engine.

## Spec

- **Base URL / prefix**: configurable host; client prepends `/api/v1` exactly once — match web
  semantics (no double prefix). snake_case query params only.
- **Resilience** (mirror `web/src/lib/resilience`): exponential backoff + jitter, max-retries on
  GET/timeout/5xx; circuit-breaker opens after N consecutive failures, half-open probe. No retry
  on 4xx (except 401 → delegated to S6 refresh hook).
- **Errors**: map to a sealed `ApiError` (Network, Timeout, Http(code,body), Decode, CircuitOpen).
- **Auth seam**: `TokenProvider` interface injected (no-op default now; S6 implements). A response
  401 invokes `onUnauthorized` once for refresh-and-retry.
- **Testing**: Ktor `MockEngine` table-driven tests for prefix, retry count, breaker transitions,
  401 hook, error mapping. Use a virtual clock for backoff (no real sleeps).

## Implementation steps

1. `ApiHttpClient` factory (functional-options style) + `expect`/`actual` engine providers.
2. Retry + circuit-breaker as Ktor plugins or wrapping interceptors; inject a `Clock` for tests.
3. `ApiError` sealed type + a `safeRequest {}` wrapper returning `Result<T, ApiError>`.
4. `TokenProvider` + `onUnauthorized` seam (no-op now).
5. MockEngine test suite; run gate.

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

- [ ] Prefix-once + snake_case params verified; retry/backoff/breaker covered by tests w/ virtual clock.
- [ ] 401 → onUnauthorized hook invoked exactly once then retried; error mapping complete.
- [ ] No real network in tests; ktlint + placeholder clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Concrete auth/token storage (S6), SSE stream (S4-0002), caching (S7), per-feature repos (S8).

## Commit

```powershell
git add apps/shared/core .github/prompts/monorepo/logs/p1-s4-0001-networking.log
git commit -m "feat(apps/shared): resilient Ktor networking foundation (P1/S4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
