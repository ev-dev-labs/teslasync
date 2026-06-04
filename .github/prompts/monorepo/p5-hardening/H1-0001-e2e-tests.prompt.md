---
description: "P5/H1 — End-to-end test suites per platform (sign-in → live data → command → notification)"
---

# P5 · H1 · 0001 — End-to-end test suites (per platform)

> **Severity:** Hardening · **Delegation:** FORBIDDEN
> Real-app e2e flows against a dedicated test backend, on every shipping platform.
> Catches integration regressions that unit + UI tests miss.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/e2e/**`, `apps/android/e2e/**`, `apps/apple/e2e/**`, shared scenario specs under `apps/shared/e2e/scenarios.yaml` |
| Allowed files | `apps/*/e2e/**`, `apps/shared/e2e/**`, the log file |
| Depends on | P5/H0 |
| Blocks | P5/H99 (GA gate) |
| ADR refs | ADR-010 |
| Log | `../logs/p5-h1-0001-e2e.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Author and run a small, durable set of e2e scenarios on every platform: cold-start sign-in,
vehicle list → detail with live state, send a vehicle command and observe the response,
receive a push notification and deep-link to its detail, sign out + secure-storage cleared.
Scenarios are specified ONCE in YAML and driven per-platform by WinAppDriver / Espresso+UI
Automator / XCUITest.

## Spec

- `apps/shared/e2e/scenarios.yaml` — language-neutral steps with semantic selectors
  (`vehicle-card`, `battery-stat`) that each platform binds via test-id properties on real components.
- Dedicated test backend (containerized TeslaSync stack with seeded data) — never the user's prod.
- A flake budget (≤ 1% over the last 50 runs) tracked in the log; flake-quarantine, never disable.
- Network conditions: each scenario runs once online, once with the cache-only fallback.

## Implementation steps

1. Author `scenarios.yaml` (the five flows above; expand as needed).
2. Per platform: implement step bindings + a seeded test-backend harness.
3. Wire into CI with retry-with-quarantine; publish JUnit reports.
4. Establish flake-rate dashboard (link in the log).

## Gate

```powershell
foreach($p in 'windows','android','apple'){
  & "./apps/$p/e2e/run.ps1" 2>&1 | Tee-Object $log -Append; "E2E_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
}
# EXIT=0 only if every shipped platform's e2e exit is 0; BLOCKED allowed only for missing runner.
```

## Acceptance Criteria

- [ ] All 5 scenarios green on every shipping platform.
- [ ] Online + cache-only variants pass.
- [ ] Flake rate ≤ 1% over last 50 runs.
- [ ] No prod traffic from tests; teardown deletes test artifacts.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Perf/a11y/l10n; new scenarios; load testing.

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h1-0001-e2e.log
git commit -m "test(apps): cross-platform e2e suites (P5/H1)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
