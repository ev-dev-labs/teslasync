# Phase 4 — Migration Assembly

> **Goal:** Concatenate the validated `phase-3-schema/` SQL files into ONE forward-only migration pair (`migrations/000142_baseline_typed.{up,down}.sql`) that applies cleanly on top of the existing 141 migrations.
>
> **Pre-req:** Phase 3 complete — all 28 SQL files exist and the throwaway DB validated zero-jsonb (sole carve-out: `automation_actions.command_params`).
>
> **Output:** New migration files committed under `migrations/`. Per ADR-008, this is **additive** — the 141 prior migrations stay; squash is a future Program C effort.

## Prompts in this phase

| # | File | Purpose |
|--:|------|---------|
| 00 | `00-snapshot-schema-files.prompt.md` | Snapshot the validated schema SQL under `migrations/_baseline_source/` for traceability |
| 01 | `01-assemble-up-migration.prompt.md` | Concat schema files in dependency order into `000142_baseline_typed.up.sql` (with `DROP TABLE IF EXISTS … CASCADE` preludes) |
| 02 | `02-write-down-migration.prompt.md` | Write the matching `000142_baseline_typed.down.sql` (drops new objects in reverse order) |
| 03 | `03-validate-migration-on-fresh-db.prompt.md` | Apply migration to fresh PG container (standalone + full chain); verify zero-jsonb, hypertables, CAGGs |

## Reference

- Old monolith: `prompts/02-assemble-baseline-migration.prompt.md` (superseded)
- ADR-008 (squash deferral)
