---
description: "P1/S7 — Offline cache (SQLDelight) + cache-then-network repositories with freshness"
---

# P1 · S7 · 0001 — Offline cache + repositories

> **Severity:** Foundation · **Delegation:** FORBIDDEN
> The shared persistence + repository layer: SQLDelight schema, cache-then-network reads,
> write-through, and freshness/staleness stamping per ADR-013. Every feature state holder
> (S8) reads through these repositories.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/src/{common,android,apple}Main/.../cache/**`, `.../data/repo/**` |
| Allowed files | `apps/shared/core/**`, the log file |
| Depends on | P1/S2 (models), P1/S4 (networking), P1/S3 |
| Blocks | P1/S8 (state holders) |
| ADR refs | ADR-013 |
| Log | `../logs/p1-s7-0001-cache.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A SQLDelight database with `expect/actual` drivers (android/apple), a generic
`cacheThenNetwork` repository pattern that emits cached data immediately then refreshes from
the API and re-emits, stamps each record with a fetched-at time, and flags staleness (>2 min
for live-ish data, configurable per entity). Tested with the in-memory driver + MockEngine.

## Spec

- **SQLDelight**: schema for the cacheable domains (vehicles, drives, charging, energy/battery,
  analytics summaries, notifications, signals snapshots) — store API DTOs as typed rows; SI
  values only (never converted). `expect`/`actual` `SqlDriver` (Android driver / native driver);
  in-memory driver for tests.
- **Repository pattern**: `cacheThenNetwork(key, fetch, read, write)` returning `Flow<Resource<T>>`
  with `Loading(cached?)`, `Success(data, fetchedAt, stale)`, `Error(cached?, error)`.
- **Freshness**: per-entity TTL; `stale = now - fetchedAt > ttl`. Offline ⇒ serve cache + Stale.
- **Invalidation**: write-through on mutations; clear-on-logout hook.
- **Testing**: in-memory driver + MockEngine — assert emit order (cache→network), staleness math
  (virtual clock), offline path, write-through, logout clears.

## Implementation steps

1. SQLDelight `.sq` schemas + generated types; `expect/actual` drivers + in-memory test driver.
2. `Resource<T>` + `cacheThenNetwork` operator.
3. Concrete repositories per domain (thin — full feature logic is S8).
4. Freshness/TTL config + clear-on-logout.
5. Driver + MockEngine test suite; run gate.

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

- [ ] SQLDelight schema covers the cacheable domains; SI-only rows; android+apple drivers present.
- [ ] cache→network emit order + staleness + offline + write-through + logout-clear all tested.
- [ ] In-memory driver used in tests (no real DB/network); ktlint + placeholder clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Feature-specific merging/derivation (S8), live SSE merge (S8), UI.

## Commit

```powershell
git add apps/shared/core .github/prompts/monorepo/logs/p1-s7-0001-cache.log
git commit -m "feat(apps/shared): SQLDelight cache + cache-then-network repos (P1/S7)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
