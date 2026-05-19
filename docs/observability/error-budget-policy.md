# Error Budget Policy

> **Audience:** TeslaSync operators and contributors.
> **Status:** Active.
> **Owner:** Platform.

A self-hosted Tesla fleet intelligence platform runs across a small,
deeply integrated set of services. Without an explicit policy, every
on-call decision turns into a tug-of-war between "ship the next
feature" and "stabilise the current outage." The error budget policy
makes that trade-off explicit: when reliability drops below the
agreed line, the team trades feature velocity for fixes until the
budget is restored.

This document defines:

1. What an error budget is for TeslaSync.
2. The exact thresholds that change behaviour.
3. What the team does at each threshold.
4. How to override the policy when a real-world event forces it.

---

## 1. What the budget measures

Every SLO in [`slo/catalog.yaml`](../../slo/catalog.yaml) has an
**objective** expressed as a percentage of good events over a
rolling window. The **error budget** for a window is the complement:

> error budget = 100% − objective

For an API-availability SLO at `99.5%` over `30d`, that's
`0.5%` × `30d` ≈ `216 minutes` of allowed downtime per rolling
30-day window.

Two things to notice:

- The budget is a **rolling window**, not a calendar period. Burning
  100% of the budget on day 1 does NOT reset on day 1 of the next
  month; the burn persists until the bad events fall off the back of
  the window.
- The budget is **per SLO**, not aggregated. A storage outage that
  burns the `signal_log_write_success` budget does not affect the
  `api_availability` budget unless the API also returns errors.

Burn-rate alerts (`SLO<Name>FastBurn` / `SLO<Name>SlowBurn`) fire
when consumption is faster than sustainable. See
[`docs/runbooks/phase-44-respond-to-burn-alert.md`](../runbooks/phase-44-respond-to-burn-alert.md)
for the response runbook.

---

## 2. Budget consumption thresholds

| Budget remaining | State | Posture |
|:---|:---|:---|
| `> 50%` | **Healthy** | Default. Ship features freely. |
| `25–50%` | **Caution** | New features still allowed; prioritise reliability fixes when on the boundary. |
| `10–25%` | **At Risk** | Freeze new feature deploys to the affected component. Bug fixes, reliability work, and documentation only. |
| `< 10%` | **Burn Freeze** | All non-emergency deploys halt for the affected component until budget recovers above 25%. |
| `< 0%` (over-budget) | **Incident** | Treat as a P1 incident. Stand up an incident channel, page the owner listed on the SLO, write a post-mortem after recovery. |

Apply per-SLO. If the `api_availability` SLO is in **Burn Freeze**
but `telemetry_freshness` is **Healthy**, only API deploys are
frozen; telemetry feature work continues.

---

## 3. What "freeze" means in a self-hosted context

This project ships a single Helm chart that operators run on their
own k3s clusters. There is no central deploy pipeline that holds the
authority to literally block a release. The freeze is therefore a
**policy on the maintainers**:

- Pull requests for the affected component are not merged.
- Open PRs are re-tagged from `ready-to-merge` to `freeze-blocked`.
- The next release tag does not include feature commits scoped to
  the frozen component; only fix/perf/refactor commits land.
- Downstream operators who pull the chart see a slower release
  cadence — that's the cost they pay (and benefit from) for
  reliability.

The freeze ends when burn-rate alerts have been clear for **24
hours** AND budget remaining is above 25%.

---

## 4. Owner accountability

The `owner:` field on each SLO in `slo/catalog.yaml` names the team
responsible for restoring budget when burn-rate alerts fire. The
owner is responsible for:

- Acknowledging burn-rate alerts within **15 minutes** for `severity:
  page` and **4 hours** for `severity: ticket` during business hours
  (self-hosted operators define "business hours" for their own
  installation).
- Driving the incident-recovery work or delegating it explicitly.
- Writing the post-mortem when budget goes negative.
- Proposing SLO changes when objectives are repeatedly missed or
  trivially met (see §6).

---

## 5. Exceptions and overrides

Real-world events sometimes require shipping anyway:

- **Security fixes** that close an active vulnerability override the
  freeze. Document the override in the PR description and the next
  release notes.
- **Breaking upstream changes** (Tesla Fleet API revisions, k3s
  major bumps, etc.) override the freeze if the alternative is a
  worse outage.
- **Data-loss prevention** changes (a fix that stops corrupting the
  hypertable) override the freeze.

Every override MUST be recorded in the commit message footer:

```
Override: error-budget-freeze
Reason: <one-line justification>
Approved-by: <owner of the affected SLO>
```

`grep "Override: error-budget-freeze" $(git log ...)` should produce
the same number of hits as freeze events in the post-mortem log. If
they diverge, the policy has decayed.

---

## 6. Reviewing the SLOs

The error budget is only useful if the SLO targets reflect real user
expectations. Review the catalog quarterly:

- **Repeatedly burnt budgets** mean the objective is too tight,
  the system is genuinely unreliable, OR the SLI is measuring noise.
  Investigate, then either fix the system OR tune the objective
  down with an explicit rationale in the SLO comment.
- **Trivially-met budgets** (consistently under 1% burn) mean the
  objective is too loose to drive behaviour. Tighten it.
- **Stale SLIs** that no longer point at the right metric must be
  re-derived from the current code path.

Open a tracking issue per review cycle. Reference any objective
changes in the `slo/catalog.yaml` commit message so the audit trail
is one `git log slo/catalog.yaml` away.

---

## 7. Tooling references

- SLO catalog: [`slo/catalog.yaml`](../../slo/catalog.yaml)
- Schema: [`slo/catalog.schema.json`](../../slo/catalog.schema.json)
- Burn-rate generator: `go run ./cmd/slogen generate`
- Generated rules:
  [`helm/teslasync/files/prometheus/`](../../helm/teslasync/files/prometheus/)
- Helm wrapper: [`helm/teslasync/templates/prometheusrule.yaml`](../../helm/teslasync/templates/prometheusrule.yaml)
  (enable with `prometheusRule.enabled=true`)
- Burn-alert runbook:
  [`docs/runbooks/phase-44-respond-to-burn-alert.md`](../runbooks/phase-44-respond-to-burn-alert.md)
- SLO additions:
  [`docs/runbooks/phase-44-add-new-slo.md`](../runbooks/phase-44-add-new-slo.md)
