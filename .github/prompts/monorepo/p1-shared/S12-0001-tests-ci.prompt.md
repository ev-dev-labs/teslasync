---
description: "P1/S12 — Shared unit + contract + golden-vector suites green in CI"
---

# P1 · S12 · 0001 — Shared test + CI consolidation

> **Severity:** Foundation · **Delegation:** FORBIDDEN
> Consolidate the shared-core test suites (unit, OpenAPI contract conformance, golden vectors)
> and wire them into CI so the contract + core can't regress. Per ADR-010.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/src/commonTest/**` consolidation, `apps/shared/spec/**`, CI workflow updates |
| Allowed files | `apps/shared/**`, `.github/workflows/apps-*.yml`, the log file |
| Depends on | P1/S1..S11 |
| Blocks | P1/S99 (gate) |
| ADR refs | ADR-010 |
| Log | `../logs/p1-s12-0001-tests-ci.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A green, enforced CI lane for the shared core: all KMP unit tests, the OpenAPI conformance test
(spec vs live API shape), the golden-vector suite (units S5 + any S8 derivations) run on every
PR touching `apps/shared/**` or `api/openapi/**`, with coverage reported and a minimum threshold
on critical packages (net/auth/cache/units/presentation).

## Spec

- Aggregate existing suites; ensure golden vectors are loaded from `apps/shared/spec/*.json` and
  asserted by KMP (the C# side asserts them in P2/W5).
- OpenAPI conformance: regenerate-and-diff gate (S2 `--check`) + a runtime shape check if a test
  backend is reachable (else BLOCKED with reason, not skipped silently).
- Coverage: enforce a floor on net/auth/cache/units/presentation; report total.
- CI: extend the P0/0004 matrix with an `apps-shared` job (path-filtered) running the above on
  every PR; cache Gradle.

## Implementation steps

1. Consolidate/loaders for golden vectors; ensure deterministic seeds.
2. Conformance gate wiring (drift + optional runtime shape).
3. Coverage tool + thresholds.
4. CI job `apps-shared` with path filters + Gradle cache.
5. Run gate.

## Gate

```powershell
Push-Location apps/shared/core
./gradlew :core:allTests koverVerify 2>&1 | Tee-Object $log -Append; "TEST_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/codegen/gen-clients.ps1 -Check 2>&1 | Tee-Object $log -Append; "DRIFT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if TEST(+coverage floor)/DRIFT both 0
```

## Acceptance Criteria

- [ ] All shared unit + golden-vector tests green; coverage floor met on critical packages.
- [ ] OpenAPI conformance (drift + runtime-or-BLOCKED) enforced.
- [ ] `apps-shared` CI job runs path-filtered on PRs; Gradle cached.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Platform UI tests (W9/A9/P9), e2e (H1).

## Commit

```powershell
git add apps/shared .github/workflows .github/prompts/monorepo/logs/p1-s12-0001-tests-ci.log
git commit -m "test(apps/shared): consolidate shared suites + CI lane (P1/S12)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
