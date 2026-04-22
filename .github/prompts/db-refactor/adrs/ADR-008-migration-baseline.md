# ADR-008: Migration Baseline — When and How to Squash

**Status:** Accepted (2026-04-22)
**Date:** 2026-04-22
**Owner:** Backend
**Supersedes:** N/A

---

## Context

The repository carries **141 incremental migrations** (`000001_initial` through `000141_charging_telemetry_charge_port`). This history is valuable as a record of how the schema evolved but has costs:

- New environments take longer to bootstrap (sequential apply of 141 files)
- Reviewing the schema requires reading dozens of files
- Migrations frequently fix earlier migrations (`000043_fix_climate_overheat_temp_type`, `000037_fix_column_types`) — the net schema is hard to see
- The squash itself is a non-trivial operation that risks breaking environments mid-rollout

Two timing strategies for squashing:

**Strategy A — Squash before refactor:**
- Collapse 141 migrations into 1 baseline
- Then apply Programs B (typing) on top of the clean baseline
- Smaller diffs, easier review of the typing work

**Strategy B — Squash after refactor:**
- Programs A + B add migrations 142..N
- Once stable in prod for ≥30 days, collapse 1..N into a new baseline
- Rollout is two separate, smaller events

Strategy A is tempting but risky: it creates a "big bang" deployment that does both squash and typing simultaneously. If anything breaks, blame is hard to assign and rollback is hard to define.

Strategy B is operationally safer: each change has its own deploy and observation window. The squash itself becomes a routine, low-risk maintenance event because by then the schema is stable.

## Decision

**Squash AFTER the typing refactor (Program B) has soaked in production for ≥30 days. Defer Program C to a future branch (`db-refactor/migration-squash`).**

This branch (`db-refactor/timescaledb-migration-mo-jsonb-at-all`) only adds new migrations; it does **not** delete or modify any existing migration files.

### Squash mechanics (when it eventually happens — out of scope for this branch)
1. Snapshot the production schema with `pg_dump --schema-only --no-owner` from a fresh environment that has applied 1..N
2. Hand-format the dump into one or more well-organized baseline migration files
3. Verify by:
   - Apply baseline to a fresh DB → run regression tests
   - Apply baseline + (current) data restore → verify queries return identical results
4. Replace files `000001..000N` with the baseline (numbered `000001_baseline.up.sql`)
5. **Important:** Update the `schema_migrations` table on existing environments via a one-time admin script that translates "we've applied 1..N" into "we've applied baseline" (`UPDATE schema_migrations SET version = 1 WHERE version IN (...);`)
6. Test on a copy of production before doing on production

### Why we resist squashing on this branch
- This branch already touches 27 repos, ~50 columns, the telemetry handler, the Helm chart, and the frontend types
- Adding "and oh by the way, also collapse 141 migration files" creates a deploy that is impossible to roll back cleanly
- The squash is a one-line ROI ("faster bootstrap, easier review") that doesn't justify shared blast radius with the typing work
- Once typing is in prod and stable, the squash becomes a 2-day routine task with its own controlled rollout

## Consequences

**Positive:**
- Deployments stay focused; each has one purpose
- Rollback semantics are clear
- No need to coordinate squash with typing PR review
- Future squash benefits from a stable, typed schema (much smaller baseline file)

**Negative:**
- Bootstrap time for new environments stays slow until Program C ships (irrelevant for prod, mildly annoying for local dev)
- The repository keeps 141 + N migration files for several months

**Neutral:**
- The decision can be revisited if Program C becomes higher priority for some reason

**Risks:**
- Memory loss — by the time we get to Program C, no one remembers why the squash was deferred. Mitigation: this ADR exists.
