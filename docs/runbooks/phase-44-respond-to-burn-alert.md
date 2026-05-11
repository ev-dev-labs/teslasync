# Respond to a burn-rate alert — operator runbook

> Phase 44 / Prompt 0091

A multi-window multi-burn-rate (MW-MBR) alert fired against one of the
SLOs in `slo/catalog.yaml`. This runbook walks the on-call engineer
through the standard response: **acknowledge → triage → find root cause →
mitigate → communicate → post-incident**.

There are two alert tiers, generated automatically by `cmd/slogen` from
the catalog. Per Google's SRE workbook chapter 5:

| Tier | Long window | Short window | Burn rate | Severity | Page? |
|---|---|---|---|---|---|
| `<SLO>FastBurn` | 1 h | 5 m | 14.4× | page | yes — wake the on-call |
| `<SLO>SlowBurn` | 6 h | 30 m | 6× | ticket | no — open an issue and triage during business hours |

Burn-rate maths: a 14.4× burn-rate sustained for 1 h consumes 2 % of a
30-day budget, which is the page threshold per Google's recommendation.

## Acknowledge

1. **Open the alert** in your alert manager (PagerDuty / Opsgenie / etc).
   Note the alert name (e.g. `ApiAvailabilityFastBurn`) and the affected
   SLO (e.g. `api_availability`).
2. **Acknowledge it within 5 min.** Acknowledge in the alert tool — do
   not silence yet. Silencing without diagnosis hides the signal from
   the team.
3. **Post in `#oncall`** (or your team's incident channel):
   `:fire: ack <alert name>, investigating, ETA 15 min for triage`.
4. **Open the SLO dashboard** for the affected SLO. The alert annotation
   includes the dashboard URL — click through.

## Triage

The dashboard has six panels. Walk them in this order:

1. **SLI ratio** — what's the current good/valid ratio? If it has
   collapsed to ~0, the failure mode is total. If it's degraded but
   non-zero, partial.
2. **Error budget remaining** — how much budget is left? If <10 %,
   escalate to a SEV-2 incident. If >50 %, you have time.
3. **Burn-rate** — is the burn still rising, plateauing, or dropping?
   Rising means the underlying cause is not yet resolved.
4. **Latency / errors histogram** — what's the shape of the failure?
   Latency creep, error wall, partial-failure (some routes only)?
5. **Per-route breakdown** — pick the worst-performing route. That's
   your starting point for root cause.
6. **Exemplars** — click a red exemplar to jump into Tempo via
   `phase-44-debug-from-trace.md`.

### Triage tree

```
Is the SLI ratio collapsed to ~0?
├─ YES → Total outage. Page secondary on-call. Declare SEV-1 incident.
│         Skip to "Mitigations → rollback or scale".
└─ NO → Partial.
        │
        Is the burn rate still rising?
        ├─ YES → Hot incident. Stay engaged.
        │         │
        │         Is the failure scoped to one route / one client / one VIN?
        │         ├─ YES → Targeted fix. Find the offender via per-route panel.
        │         └─ NO  → Systemic. Likely shared dependency (DB, Redis, Tesla API).
        │
        └─ NO → Burn flattened. Likely transient. Capture artefacts then watch.
                 │
                 Did the SLO breach the long-window threshold?
                 ├─ YES → File ticket; post-incident still required.
                 └─ NO → Auto-resolve once 1h-window quiets.
```

## Root cause

Use the trace runbook for the deep-dive (`phase-44-debug-from-trace.md`).
Three quick high-yield checks:

1. **Recent deploys** — `git log --oneline --since="2 hours ago"`. Most
   regressions land within the last release. If a release correlates,
   prepare a rollback.
2. **Upstream status** — open the Tesla developer dashboard, the
   Postgres dashboard, the Redis dashboard. If any is degraded, the
   alert is a downstream symptom; pivot to coordinating with upstream
   owners.
3. **Saturation** — open the `red_*` dashboards filtered by service.
   CPU > 80 %, memory > 80 %, or queue depth >> baseline indicates
   capacity exhaustion, not a code bug.

## Mitigations

In order of preference (fastest first):

| Mitigation | When to use | How |
|---|---|---|
| **Rollback** | Last deploy correlates with the burn | `helm rollback teslasync` to the previous release. Confirm pods restart green. |
| **Scale up** | Saturation indicators tripping | `kubectl scale deploy teslasync-api --replicas=N+1`. Watch the burn rate; if it drops, the deploy was undersized. |
| **Rate limit** | Single client / VIN causing the load | Apply a temporary `rate_limit` rule at the ingress. Note: this DEGRADES service for the offender; communicate. |
| **Disable feature flag** | New feature is the regression | Toggle off in the admin UI; confirm burn drops. |
| **Failover** | Regional issue | Cut traffic via DNS or load balancer. |
| **Degrade** | All else fails | Return cached / stale data; surface a banner to users. |

Always **leave a paper trail**: the chosen mitigation, the time, who
made the call, and the expected effect. Post in the incident channel.

## Communicate

- **Internal**: keep `#oncall` updated every 15 min until burn drops
  below the alert threshold for >15 min.
- **External** (if user-facing impact): update the public status page.
  Use plain language: "We're investigating slow vehicle-state queries
  for some users." Avoid speculative ETAs.
- **Stakeholders**: notify product / support leads if the incident
  exceeds 30 min or affects >10 % of users.

## Post-incident

Within 48 h of resolution:

1. **Write up** in the standard post-mortem template
   (`docs/incident-template.md` if it exists in your repo).
2. **Capture** what fired, what was done, the timeline, the root
   cause, the contributing factors, the corrective actions.
3. **File issues** for each corrective action. Tag with
   `incident-followup`. Owner + due date for each.
4. **Run a blameless retro** — focus on systems, not individuals.
5. **Update this runbook** if the playbook missed a step that would
   have helped on the day.

## Common false alarms

- **Cron job spike** — a daily backup or report job spikes the
  ingest pipeline for a few minutes. Auto-resolves. Consider
  excluding the cron's user-agent from the SLI valid-events count.
- **Tempo / Prometheus self-issue** — if the recording rule that
  feeds the SLI hasn't evaluated, the alert may fire spuriously.
  Confirm the rule's `for: 0` last-eval time on the rules page.
- **Holiday traffic** — atypically low traffic raises noise on
  ratio-based SLIs. Document and ignore.

## Related runbooks

- `phase-44-debug-from-trace.md` — drill into a single failed request.
- `phase-44-trace-sampling.md` — what gets sampled vs dropped.
- `phase-44-add-new-slo.md` — add a new SLO entry.
