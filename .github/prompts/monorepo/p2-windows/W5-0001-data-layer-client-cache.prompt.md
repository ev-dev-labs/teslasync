---
description: "P2/W5-0001 — Windows generated client, behavior port, repositories, and cache"
---

# P2 · W5-0001 — Data layer, generated client, behavior port, and cache

> **Severity:** Data foundational · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Data/**`, generated C# client integration, repositories, cache schema/tests |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE, W4-0001 DONE; P1 generated contracts/golden vectors available |
| Blocks | W6 live/push, W7 pages, W9 tests |
| ADR refs | ADR-003, ADR-004, ADR-008, ADR-010, ADR-011, ADR-013, ADR-016 |
| Instr refs | version lock `apps/versions.lock.md`; generated OpenAPI/C# client; P1 golden vectors |
| Log | `../logs/p2-w5-0001-data-layer-client-cache.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Integrate the generated C# API client, implement the C# behavior port kept in lockstep with KMP golden vectors, and provide cache-then-network repositories for all Windows pages.

## Spec

- Consume the generated C# API client from the OpenAPI 3.1 contract; do not hand-write duplicate endpoint DTOs except thin domain read models.
- Implement C# behavior modules mirroring KMP golden vectors: SI unit conversion/formatting, auth behavior hooks, date/time/currency/locale formatting, stale/freshness classification, retry/backoff policy, error mapping.
- Add repository interfaces and implementations for vehicle list/detail/state, drives/trips, charging, battery/energy, analytics, maps/locations/geofences, vehicle systems, automations, notifications, telemetry/signals, admin/system/settings/exports/sharing.
- Use cache-then-network per ADR-013 with SQLite (`Microsoft.Data.Sqlite` or EF Core if pinned), `fetched_at` stamps, two-minute live staleness contract, bounded eviction, and no token storage in DB.
- Surface typed `LoadState<T>`/`RepositoryResult<T>` values supporting loading, cached, refreshing, empty, error, stale, and offline states for W7 pages.
- Centralize API base URL, auth handler from W4, JSON settings, retry/circuit policy, and privacy-redacting diagnostics.

## Implementation steps

1. Verify W4 auth log is DONE and generated C# client artifacts/version pins exist.
2. Survey API hooks/types used by web pages and generated W7 prompts; map them to repository interfaces.
3. Wire the generated client through DI with W4 auth handler and redacting observability.
4. Implement behavior port with tests that load the shared golden-vector fixtures; fail on numeric/string drift.
5. Implement SQLite cache schema/migrations and cache-then-network repositories with freshness stamps.
6. Add repository tests for cached-first emission, network refresh, offline fallback, error mapping, auth retry propagation, and eviction.
7. Run gate and log golden-vector counts and repository coverage.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w5-0001-data-layer-client-cache.log"
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
$required = @('Generated','Repository','SQLite','fetched_at','Golden','CacheThenNetwork','LoadState','Microsoft.Data.Sqlite')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml,*.sql | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_DATA_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Generated C# client is the only contract client used by repositories.
- [ ] C# behavior port passes the same golden vectors as KMP.
- [ ] Cache-then-network repositories cover all route/page domains and stamp `fetched_at`.
- [ ] Offline/stale/error/loading/empty states are explicit and test-covered.
- [ ] Build, format, test, placeholder, and data-marker gates are green.

## Out of Scope

- No backend endpoint changes.
- No page UI implementations.
- No token storage in SQLite or logs.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w5-0001-data-layer-client-cache.log
git commit -m "feat(apps/windows): add data layer and cache (P2/W5-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
