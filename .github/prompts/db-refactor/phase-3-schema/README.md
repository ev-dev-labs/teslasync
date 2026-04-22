# Phase 3 — Schema Design

**Goal:** Translate the 9 ADRs into reference DDL. Each prompt produces **one** `schema/NN-*.sql` file containing **one** logical artifact (one CREATE TABLE, one hypertable + its compression policy, one CAGG, etc.).

**Output directory:** `D:\repos\teslasync\.github\prompts\db-refactor\schema\`

**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all`

---

## Atomicity rule

If a prompt's "Single goal" sentence contains "and", split the prompt. One artifact, one file, one commit.

## Execution order

Prompts are numbered in **dependency order**. Run them in sequence — later prompts may reference tables created by earlier ones (FKs).

| # | Prompt | Produces |
|---|---|---|
| 00 | `00-extensions.prompt.md` | `schema/00-extensions.sql` |
| 01 | `01-create-vehicles.prompt.md` | `schema/01-vehicles.sql` |
| 02 | `02-create-vehicle-live-state.prompt.md` | `schema/02-vehicle-live-state.sql` |
| 03 | `03-create-positions-hypertable.prompt.md` | `schema/03-positions.sql` |
| 04 | `04-create-charging-telemetry-hypertable.prompt.md` | `schema/04-charging-telemetry.sql` |
| 05 | `05-create-climate-snapshots-hypertable.prompt.md` | `schema/05-climate-snapshots.sql` |
| 06 | `06-create-motor-snapshots-hypertable.prompt.md` | `schema/06-motor-snapshots.sql` |
| 07 | `07-create-security-events-hypertable.prompt.md` | `schema/07-security-events.sql` |
| 08 | `08-create-signal-observations-hypertable.prompt.md` | `schema/08-signal-observations.sql` |
| 09 | `09-create-signal-catalog.prompt.md` | `schema/09-signal-catalog.sql` |
| 10 | `10-create-vehicle-meta-snapshots-hypertable.prompt.md` | `schema/10-vehicle-meta-snapshots.sql` |
| 11 | `11-create-drives.prompt.md` | `schema/11-drives.sql` |
| 12 | `12-create-charging-sessions.prompt.md` | `schema/12-charging-sessions.sql` |
| 13 | `13-create-trips.prompt.md` | `schema/13-trips.sql` |
| 14 | `14-create-automations-parent.prompt.md` | `schema/14-automations.sql` |
| 15 | `15-create-automation-conditions.prompt.md` | `schema/15-automation-conditions.sql` |
| 16 | `16-create-automation-actions.prompt.md` | `schema/16-automation-actions.sql` (only JSONB carve-out) |
| 17 | `17-create-automation-step-children.prompt.md` | `schema/17-automation-step-children.sql` |
| 18 | `18-create-alert-rules.prompt.md` | `schema/18-alert-rules.sql` |
| 19 | `19-create-notification-channels.prompt.md` | `schema/19-notification-channels.sql` |
| 20 | `20-create-notifications.prompt.md` | `schema/20-notifications.sql` |
| 21 | `21-create-tesla-tokens.prompt.md` | `schema/21-tesla-tokens.sql` |
| 22 | `22-create-api-call-logs.prompt.md` | `schema/22-api-call-logs.sql` |
| 23 | `23-create-system-tables.prompt.md` | `schema/23-system-tables.sql` |
| 24 | `24-create-caggs-fleet-stats.prompt.md` | `schema/24-caggs-fleet-stats.sql` |
| 25 | `25-create-caggs-charging-summary.prompt.md` | `schema/25-caggs-charging-summary.sql` |
| 26 | `26-create-caggs-signal-hourly.prompt.md` | `schema/26-caggs-signal-hourly.sql` |
| 99 | `99-validate-zero-jsonb-invariant.prompt.md` | (no file — runs invariant check across all schema/ files) |

## Binding rules (apply to every prompt's output)

These come from ADR-001 and the original Phase 3 spec. Each prompt restates the ones relevant to its file; this README is the master list.

1. **Zero `jsonb`** except `automation_actions.command_params` (ADR-004 carve-out, requires `COMMENT ON COLUMN`)
2. **Zero `json`** anywhere
3. **`timestamptz` only** for timestamps
4. **`bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY`** for surrogate keys (no `serial`/`bigserial`)
5. **`numeric(p, s)`** for monetary; **`double precision`** for sensor readings; never `real`
6. **`text` + `CHECK (col IN (...))`** OR **`CREATE TYPE … AS ENUM`** for enums
7. **`created_at` + `updated_at`** with trigger on every non-append-only table
8. **`COMMENT ON COLUMN`** for any column with non-obvious source/units
9. **Explicit `ON DELETE`** on every FK
10. **Hypertable + compression + retention** declared in the same file as the table
11. **CAGG + refresh policy** declared in the same file as the CAGG

## Each prompt ends with a commit instruction

Every prompt's final step is:

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/<file>.sql
git commit -m "schema(db-refactor): add <table-or-artifact-name>

<one-line context referencing the ADR>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

One prompt = one schema file = one commit. Easy to review, easy to revert.

## Validation harness

Each prompt self-verifies by piping its output file through `psql` against a clean throwaway TimescaleDB container (instructions in `00-extensions.prompt.md`). Prompt `99-validate-zero-jsonb-invariant.prompt.md` runs the cross-file invariant query at the end.

## When this phase is done

- 27 SQL files in `schema/`
- 28 commits on the branch (one per prompt + one for the validate-invariant)
- Invariant query returns exactly 1 (only `automation_actions.command_params`)
- Phase 5a (`02-assemble-baseline-migration`) can begin
