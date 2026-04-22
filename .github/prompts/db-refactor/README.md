# db-refactor — TimescaleDB migration with typed-by-default schema

## What this is

This directory contains the **architecture and execution plan** for refactoring the TeslaSync database to:
1. Move from PostgreSQL to TimescaleDB (engine swap)
2. Eliminate JSONB columns in favor of typed schemas (typing program)
3. Squash 141 incremental migrations into a clean baseline (history cleanup)

These are **three programs**, sequenced over time. This branch (`db-refactor/timescaledb-migration-mo-jsonb-at-all`) implements **Program B (typing)** primarily, with Program A (engine) bundled in because it is already validated locally.

## What this is NOT

- It is **not** a "rewrite the database in a weekend" plan
- It is **not** a single mega-migration; rollout is staged
- It is **not** an excuse to introduce new business logic — only structural change
- It does **not** touch production until Phase 7 (the very end)

---

## The three programs

| Program | Goal | Status | Branch |
|---|---|---|---|
| **A. Engine swap** | PostgreSQL 17 → TimescaleDB-HA pg17 | Validated locally; prod cutover playbook in `-k3s-gitops/.github/prompts/teslasync-ts-cutover/` | This branch |
| **B. Schema typing** | JSONB → typed columns + child tables + tall observations table | This branch — in design | This branch |
| **C. History squash** | 141 migrations → 1 baseline | Deferred — only after B has soaked ≥30 days in prod | Future: `db-refactor/migration-squash` |

Programs A + B ship together on this branch. Program C waits.

---

## Branching strategy

> **All branches in this effort fork from `final-enhanced-commands`** (currently the production deployment source), **not** from `main`.

| Branch | Purpose | Forks from |
|---|---|---|
| `db-refactor/timescaledb-migration-mo-jsonb-at-all` | Main refactor branch (this branch). Carries Phases 1, 3, 4, 5. | `final-enhanced-commands` |
| `spike/signal-observations-perf` | Throwaway spike for ADR-002 perf validation (Phase 2). Deleted after measurement. | `final-enhanced-commands` |
| Future: `db-refactor/migration-squash` | Program C, deferred | Whatever is prod at the time |

---

## Phases

| # | Phase | Output | Branch | Deployable? |
|---|---|---|---|---|
| 1 | Architecture decisions | 9 ADRs in `adrs/` | This branch | ❌ Docs only |
| 2 | Spike (de-risk ADR-002) | Perf numbers captured in ADR-002 | `spike/signal-observations-perf` | ❌ Throwaway |
| 3 | Schema design | Annotated DDL in `schema/` | This branch | ❌ Reference material |
| 4 | Execution prompts | 7 prompts in `prompts/` | This branch | ❌ Instructions only |
| 5 | Agent execution | Migration + Go + frontend changes | This branch → PR to `main` | ⚠️ Dev/staging only |
| 6 | Soak in staging | ≥7 days observation, perf comparison | `main` (after merge) | ❌ Don't touch prod yet |
| 7 | Prod cutover | Helm/values changes via gitops | `-k3s-gitops` repo | ✅ Prod |

Total realistic timeline from "go" to prod: 3-4 weeks if nothing surprises us.

---

## Directory structure

```
.github/prompts/db-refactor/
  README.md                    ← You are here
  adrs/                        ← Phase 1: Architecture Decision Records
    ADR-001-jsonb-policy.md
    ADR-002-signal-storage-model.md
    ADR-003-snapshot-table-strategy.md
    ADR-004-automation-schema.md
    ADR-005-tesla-rawjson-deletion.md
    ADR-006-pg-functions.md
    ADR-007-engine-strategy.md
    ADR-008-migration-baseline.md
    ADR-009-future-signal-onboarding.md
  schema/                      ← Phase 3: Annotated DDL (created later)
  prompts/                     ← Phase 4: Execution prompts (created later)
```

---

## How to read the ADRs

ADRs follow the [Michael Nygard template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
**Status** · **Context** · **Decision** · **Consequences**

Each ADR is intended to be ≤1 page. Each makes **one decision**. Read them in order — later ADRs assume earlier ones are accepted.

A **proposed** ADR is open for argument. Comment in PR review, or edit and re-propose. Once **accepted**, the decision is binding for downstream phases. Changing an accepted ADR requires a new ADR that supersedes it.

---

## Non-goals

The following are explicitly **out of scope** for this refactor. Don't sneak them in:

- Multi-tenancy / per-user data isolation
- Real-time push to clients (websockets, GraphQL subscriptions)
- New analytics features
- New Tesla API integrations
- Replacing TanStack Query with another data layer
- Changing authentication/authorization
- Adding new external services (S3, Kafka, etc.)

If any of these come up during execution, they get their own ticket and ship separately.
