# Dependency update triage — 2026-05-18

> Snapshot taken on branch `chore/state-of-the-art-hardening`.
> Companion to the P0 #7 work item in the state-of-the-art gap audit.
> Counts and categories will go stale; treat this as a one-time
> baseline triage, not a living document. Future drift is managed by
> the grouped Dependabot config in `.github/dependabot.yml`.

## Why we had 19 stale PRs

The previous Dependabot config requested **5 PRs per ecosystem per
week** with no grouping. Five ecosystems × ~10 weeks of accumulation
= the queue we found. The rewrite in this branch:

- raises the per-ecosystem cap to 10
- **groups** patch + minor bumps into one PR per ecosystem, plus
  domain-specific groups (`aws-sdk`, `opentelemetry`, `prometheus`,
  `@types/*`, `eslint`, `vitest`, `@tanstack/*`, `react-ecosystem`,
  `actions`, base Docker images)
- explicitly carves out **major** bumps for chart-of-the-app libs
  (react, tailwind, react-leaflet) so they land as individual PRs
  that get reviewed instead of vanishing into a batch.

After this lands, expect 5 grouped PRs/week max, not 25 individual.

## Triage of the existing 19 PRs

Decisions below reference upstream changelogs as of audit date. The
"action" column is the recommendation **for the operator merging the
PRs**, not work this branch does — the audit fix is the grouping
config above + this triage record. The actual merges happen as part
of normal weekly review.

### Tier A — safe to merge after CI rerun (grouped CI bumps)

These are GitHub Actions or patch-level deps with no behavioural
change. CI currently shows failures because they pre-date the
security workflow fix in `835935c6`; rebase will run them through the
new pipeline.

| PR  | Bump                                          | Why safe                                                  |
|-----|-----------------------------------------------|-----------------------------------------------------------|
| #1  | nginx 1.25→1.29 alpine                        | nginx 1.x is API-stable; alpine bump only.               |
| #3  | actions/stale v9→v10                          | Config-compatible; release notes confirm.                |
| #11 | paho.mqtt.golang 1.5.0→1.5.1                  | Patch; no API change.                                    |
| #19 | actions/labeler v5→v6                         | YAML format compatible; v6 adds `dot:` option.           |
| #21 | docker/setup-buildx-action v3→v4              | Drop-in.                                                 |
| #31 | mermaid 11.13→11.14 (docs)                    | Docs only.                                               |

**Operator action:** rebase each onto current `main`, let CI run,
merge if green. Total expected effort: ~20 min.

### Tier B — minor bumps; verify CI then merge

Same risk class as Tier A, but inside a Go/JS dep where a minor bump
could in theory shift behaviour. Rebase, run the full CI matrix,
review the changelog, then merge.

| PR  | Bump                                          | Notes                                                     |
|-----|-----------------------------------------------|-----------------------------------------------------------|
| #8  | @tanstack/react-query 5.91→5.94               | All inside v5; type signatures unchanged.                |
| #9  | prometheus/client_golang 1.19→1.23            | Verify `MustRegister` patterns still compile.            |
| #13 | chi v5 5.0.12→5.2.5                           | All inside v5; check middleware signatures.              |
| #37 | actions/checkout v4→v6                        | v6 removed `set-safe-directory` semantics; confirm.      |

### Tier C — needs explicit pre-merge work

Major bumps or bumps that conflict with code-base context. Each gets
its own focused PR; **do not** batch.

| PR  | Bump                                          | Required work                                                                                       |
|-----|-----------------------------------------------|-----------------------------------------------------------------------------------------------------|
| #2  | go-chi/httprate 0.9→0.15                      | 0.x bump = breaking by semver. Audit every `httprate.LimitByIP` callsite (≥30 routes).             |
| #4  | golang 1.25→1.26-alpine (Docker)              | Bump `go.mod`'s `go 1.25` first, then this PR is a no-op rebase. Sequence matters.                 |
| #5  | jackc/pgx/v5 5.5.5→5.9.0                      | All v5, but ranges across 4 minor versions; rerun race tests + integration suite.                  |
| #7  | node 20-alpine → 25-alpine                    | Vite/TanStack compatibility; bump web CI matrix too.                                                |
| #14 | actions/upload-artifact v4→v7                 | Currently CONFLICTING — needs manual rebase. v5+ requires unique artifact names per workflow run. |
| #15 | eslint 8.57→10.1                              | Flat config migration required; coordinate with #18.                                                |
| #16 | react-leaflet 4.2→5.0                         | **Breaking** — affects every map component. Plan as a per-feature follow-up.                       |
| #17 | tailwindcss 3.4→4.2                           | **Major rewrite** — Tailwind v4 ditches `tailwind.config.js` for CSS-in-config. Phase its own PR.  |
| #18 | @typescript-eslint/parser 7.18→8.57           | Pairs with #15; do eslint flat-config migration first.                                              |

### Recommended merge order

1. Tier A (1 batch, ~30 min)
2. #4 prerequisite: bump `go 1.25` in go.mod → land → then #4 rebases clean
3. Tier B (one PR at a time, ~1h each)
4. Tier C #2 (httprate breaking) — audit + adapt callsites
5. Tier C #5 (pgx minor range) — full DB test pass
6. Tier C #14 (upload-artifact conflict resolution)
7. Tier C #15 + #18 together (eslint flat config)
8. Tier C #17 (tailwind v4) — coordinated with frontend lead
9. Tier C #16 (react-leaflet v5) — feature-by-feature
10. Tier C #7 (node 25) — last, after everything else is green

---

This document is part of P0 #7 from the state-of-the-art gap audit.
Future Dependabot drift should not require a triage document — the
grouped config caps active PRs at ~5/week instead of ~25/week.
