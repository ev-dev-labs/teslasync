# db-refactor: Merge-Readiness Report

> Branch: `db-refactor/timescaledb-migration-mo-jsonb-at-all`
> Generated: 2026-04-23T08:48:36.6323874-07:00

## Gate results

| # | Gate | Log | Tail |
|--:|------|-----|------|
| 01-mod-tidy | phase-9-01-mod-tidy.log | `AFTER: clean=True` |
| 02-build | phase-9-02-build.log | `EXIT=1` |
| 03-vet | phase-9-03-vet.log | `EXIT=1` |
| 04-test | phase-9-04-test.log | `EXIT=1` |
| 05-lint | phase-9-05-lint.log | `EXIT=3` |
| 05-vuln | phase-9-05-vuln.log | `EXIT=1` |
| 06-tsc | phase-9-06-tsc.log | `EXIT=0` |
| 07-eslint | phase-9-07-eslint.log | `EXIT=0` |
| 08-vitest | phase-9-08-vitest.log | `EXIT=0` |
| 09-build | phase-9-09-build.log | `EXIT=0` |
| 09-dist-size | phase-9-09-dist-size.log | `DIST_MB=17.41` |
| 10-fresh-migrate | phase-9-10-fresh-migrate.log | `1` |
| 11-jsonb-grep | phase-9-11-jsonb-grep.log | `UNEXPECTED_COUNT=102` |
| 12-no-orphan-signals | phase-9-12-no-orphan-signals.log | `0` |
| 13-carveout-embeddings | phase-9-13-carveout-embeddings.log | `ADR-001 reference: see .github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md` |
| 14-carveout-audit-log | phase-9-14-carveout-audit-log.log | `=== END ===` |
| 15-carveout-api-call-logs | phase-9-15-carveout-api-call-logs.log | `=== END ===` |
| 16-carveout-raw-payload | phase-9-16-carveout-raw-payload.log | `(empty)` |
| 17-policies-positions | phase-9-17-policies-positions.log | `(empty)` |
| 18-policies-charging-telemetry | phase-9-18-policies-charging-telemetry.log | `(empty)` |
| 19-policies-climate-snapshots | phase-9-19-policies-climate-snapshots.log | `(empty)` |
| 20-policies-motor-snapshots | phase-9-20-policies-motor-snapshots.log | `(empty)` |
| 21-policies-security-events | phase-9-21-policies-security-events.log | `(empty)` |
| 22-policies-signal-observations | phase-9-22-policies-signal-observations.log | `(empty)` |
| 23-policies-vehicle-meta-snapshots | phase-9-23-policies-vehicle-meta-snapshots.log | `(empty)` |
| 24-policies-api-call-logs | phase-9-24-policies-api-call-logs.log | `(empty)` |

## Schema artifacts

- N migrations applied to fresh DB (see prompt 10 log)
- 8 hypertables with compression + retention policies (prompts 17-24)
- JSONB only in 4 documented carveouts (prompts 13-16)

## Next step

Phase 10 - staging soak. Then Phase 11 - gitops production cutover.

