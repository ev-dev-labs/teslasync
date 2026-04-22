# Phase 9 — Acceptance Gates (One Prompt per Check)

> **Goal:** Re-run all merge-ready gates as discrete prompts so each can be re-run independently and each produces a citable log. Final prompt is the human sign-off summary.

## Prompts in this phase

| # | File | Gate |
|--:|------|------|
| 01 | `01-build-lint-go.prompt.md` | Re-run Phase 5/06 Go quality gate (mod tidy, build, vet, test -race, golangci-lint, govulncheck) |
| 02 | `02-build-lint-frontend.prompt.md` | Re-run Phase 7/05 frontend gate (tsc, lint, audit_code, build, test) |
| 03 | `03-fresh-migration-applies.prompt.md` | Re-run Phase 8/03 fresh-deploy proof |
| 04 | `04-zero-jsonb-invariant.prompt.md` | Deep check: only 1 jsonb column exists, in `automation_step_actions` (run_command kind) |
| 05 | `05-jsonb-carveout-comments.prompt.md` | Verify the sole jsonb column has an ADR-* comment in pg_description |
| 06 | `06-hypertables-policies.prompt.md` | Verify all 7 hypertables have compression + retention policies registered |
| 07 | `07-merge-readiness-summary.prompt.md` | Human sign-off summary; tags branch + drafts PR description |

## Reference

- Old monolith: `prompts/07-acceptance-validation.prompt.md` (superseded; this expands it into 7 atomic gates)
