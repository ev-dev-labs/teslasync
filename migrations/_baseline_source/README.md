# Baseline Source Snapshot

This directory contains **pinned, byte-identical copies** of the phase-3
schema files that were used to assemble the baseline migration
`000142_baseline_typed.up.sql`.

## Provenance

- **Source directory:** `.github/prompts/db-refactor/schema/` (gitignored,
  may be edited or removed after the refactor)
- **Snapshot taken:** Phase 4, prompt 00 (after phase-3 validation gate,
  prompt 99, passed)
- **Assembled into:** `migrations/000142_baseline_typed.up.sql`
- **ADR:** ADR-008 (DB refactor baseline)

## Why this exists

The source-of-record `.sql` files under `.github/prompts/db-refactor/schema/`
are working artifacts for the refactor and are gitignored. Without this
snapshot, a future debugger cannot answer:

> "Did the baseline migration faithfully concatenate the validated schema,
> or was it edited during assembly?"

Pinning the files here gives a stable, tracked reference for diffing the
final migration against the validated source.

## Rules

- **Do not edit** files in this directory. They are a frozen snapshot.
- **Do not delete** this directory after the refactor — it remains the
  audit trail for migration `000142`.
- If a fix is needed, update the source under `.github/prompts/db-refactor/schema/`,
  re-run the validation gate, and produce a *new* snapshot under a versioned
  subdirectory (e.g. `_baseline_source/v2/`) plus a new migration.

## Verification

```powershell
# File counts must match between source and snapshot
(Get-ChildItem D:\repos\teslasync\.github\prompts\db-refactor\schema\*.sql).Count
(Get-ChildItem D:\repos\teslasync\migrations\_baseline_source\*.sql).Count

# Byte-identical check (example)
fc.exe /b `
  D:\repos\teslasync\.github\prompts\db-refactor\schema\08-signal-observations.sql `
  D:\repos\teslasync\migrations\_baseline_source\08-signal-observations.sql
# Expected: "FC: no differences encountered"
```
