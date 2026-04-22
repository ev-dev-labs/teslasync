# Phase 10 — Staging Soak (7-Day Operational Watch)

> **Goal:** Run the new schema in staging for ≥7 days, watch a defined metrics set, decide go/no-go for production cutover.
>
> **Pre-req:** Phase 9 sign-off complete; staging cluster updated to the merge-ready branch.

## Prompts in this phase

| # | File | Purpose |
|--:|------|---------|
| 01 | `01-preflight.prompt.md` | Capture prod baseline metrics BEFORE staging deploy (write-rate, p95 latency, disk growth/day) |
| 02 | `02-daily-checks.prompt.md` | 7-day daily metrics template + watch list + escalation criteria |
| 03 | `03-go-no-go-decision.prompt.md` | Final decision document; routes to Phase 11 (go) or rollback/ (no-go) |

## Reference

- Old monolith: `prompts/08-staging-soak-runbook.prompt.md` (superseded)
