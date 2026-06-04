---
description: "P5/H2 — Performance budgets per platform (cold start, frame time, memory, app size)"
---

# P5 · H2 · 0001 — Performance budgets + profiling fixes

> **Severity:** Hardening · **Delegation:** FORBIDDEN
> Establish + enforce per-platform performance budgets, profile to ground them, fix regressions.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/perf/budgets.json`, per-platform perf-test harnesses under `apps/*/perf/**`, profile traces |
| Allowed files | `apps/shared/perf/**`, `apps/*/perf/**`, the log file |
| Depends on | P5/H1 |
| Blocks | P5/H99 |
| ADR refs | ADR-010 |
| Log | `../logs/p5-h2-0001-perf.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Define realistic, evidence-based performance budgets per platform; build automated harnesses
that measure them on a stable reference device per platform; profile and fix any over-budget
metric. Budgets become a CI gate — regressions block merge.

## Spec

**Budgets (initial proposal; refine with measured baselines):**

| Metric | Windows (Surface-class) | Android (mid-tier Pixel) | iOS (iPhone 13-class) | macOS (M-series MacBook) |
|---|---|---|---|---|
| Cold start to first interactive | ≤ 2.5s | ≤ 2.0s | ≤ 1.5s | ≤ 1.5s |
| Steady-state frame time | ≤ 16ms p95 | ≤ 16ms p95 | ≤ 16ms p95 | ≤ 8ms p95 |
| Steady-state memory (Dashboard + live) | ≤ 250MB | ≤ 200MB | ≤ 180MB | ≤ 350MB |
| App size (installer/AAB/IPA/.app) | ≤ 80MB | ≤ 30MB compressed | ≤ 50MB | ≤ 80MB |
| Battery drain (15min live foreground) | n/a | ≤ 3% | ≤ 3% | n/a |

- Reference devices documented in `apps/shared/perf/devices.md`.
- Harness measures each metric on the Dashboard + one heavy page (BatteryHealth) + Live Map.
- Fixes are real (image downsampling, list virtualization, query staleTime tuning, code-split
  large pages, lazy-init telemetry); no metric is "fixed" by widening the budget.

## Implementation steps

1. Author `budgets.json` + reference devices + harness per platform.
2. Run baselines; identify over-budget metrics; profile (Performance Insights / Profile / Instruments / Android Profiler).
3. Implement fixes; re-measure; document deltas in the log.
4. Wire harness into CI on a perf-runner pool; gate PRs touching `apps/**` on a soft regression threshold.

## Gate

```powershell
foreach($p in 'windows','android','apple'){
  & "./apps/$p/perf/run.ps1" -Budgets apps/shared/perf/budgets.json 2>&1 | Tee-Object $log -Append; "PERF_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
}
# EXIT=0 only if every platform meets every budget; BLOCKED allowed for missing perf-runner.
```

## Acceptance Criteria

- [ ] Every metric meets its budget on the reference device for every shipping platform.
- [ ] At least one before/after profile trace recorded for each over-budget metric fixed.
- [ ] CI perf job runs nightly + on PRs touching apps/.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Backend perf; load testing; A/B optimization.

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h2-0001-perf.log
git commit -m "perf(apps): cross-platform budgets + profiling fixes (P5/H2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
