---
description: "P2/W9-0001 — Windows unit/component test suite"
---

# P2 · W9-0001 — Unit and component tests

> **Severity:** Quality gate · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/**Tests/**`, test fixtures, component test harness under apps/windows |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W1-0001 through W8-0003 DONE where applicable |
| Blocks | W9-0002 UI automation, W99 acceptance |
| ADR refs | ADR-004, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Instr refs | xUnit/Windows test pins from `apps/versions.lock.md` |
| Log | `../logs/p2-w9-0001-unit-tests.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create the comprehensive Windows unit and component test suite covering behavior port, repositories, component states, route/auth/live/push/platform services, and page state view models.

## Spec

- Use xUnit (or the pinned Windows test framework in `apps/versions.lock.md`) with deterministic fixtures; no network calls to production.
- Cover behavior port golden vectors: SI units/formatting, freshness, date/currency, error mapping, retry/backoff.
- Cover W5 repositories: cache-then-network, offline, stale, empty, error, auth retry, eviction, migration.
- Cover W2 components with view-model/control tests for loading, empty, error, disabled, focused, high-contrast, reduced-motion, validation, and accessible labels.
- Cover W3 route registry/deep links/back stack, W4 PKCE/token storage abstractions/401 refresh, W6 SSE parser/reconnect/stale, W6 WNS fake registration, W8 settings/lifecycle/notifications/widgets.
- Cover generated W7 page view-model state contracts where pages exist: loading, empty, error, cached, refreshing, live stale.
- Enforce no placeholders and no hardcoded test-only bypasses in production code.

## Implementation steps

1. Verify predecessor logs are DONE or explicitly not-applicable where allowed.
2. Survey existing test projects and central package pins; add/normalize test projects under `apps/windows/**`.
3. Build reusable fakes for generated client, secure token store, SQLite cache, SSE stream, WNS channel, clock, and logger.
4. Add test categories matching each phase and require meaningful assertions; no tests that only assert construction.
5. Add coverage collection if pinned; log coverage summary and any accepted exclusions.
6. Run full unit/component test gate.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w9-0001-unit-tests.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build --logger trx 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('Golden','CacheThenNetwork','Pkce','Sse','Push','RouteRegistry','HighContrast','ReducedMotion','Accessibility')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_TEST_COVERAGE_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Tests cover behavior vectors, repositories, components, shell, auth, live, push, settings/lifecycle, notifications, and widgets.
- [ ] Tests use fakes/fixtures, not production network credentials.
- [ ] Component tests include loading/empty/error/accessibility/high-contrast/reduced-motion states.
- [ ] `dotnet test` passes with meaningful assertions and logged coverage summary.
- [ ] Build, format, test, placeholder, and coverage-marker gates are green.

## Out of Scope

- No WinAppDriver UI automation (W9-0002).
- No product code changes outside test-required seams.
- No production-network-dependent tests.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w9-0001-unit-tests.log
git commit -m "test(apps/windows): add unit component coverage (P2/W9-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
