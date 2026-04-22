---
description: "Phase 4 — Snapshot validated phase-3-schema/*.sql under migrations/_baseline_source/ for traceability"
---

# 🟢 Migration 00 — Snapshot Schema Source

> **Severity:** Standard (traceability prerequisite) | **Priority:** High | **Prompt #:** 1 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output dir | `migrations/_baseline_source/` (new, intentionally tracked) |
| Depends on | Phase 3 complete and validated (prompt 99 passed) |
| Blocks | `01-assemble-up-migration` |
| ADR refs | ADR-008 |
| Estimated effort | tiny (~10 min) |

## Single Goal

Copy every `.sql` file from `.github/prompts/db-refactor/schema/` into `migrations/_baseline_source/` and commit. Pins the exact source-of-record snapshots that the baseline migration was assembled from.

## What's Being Established

The baseline migration `000142_baseline_typed.up.sql` will be a concatenation. Without snapshotting, future debugging cannot answer "did the assembly faithfully concatenate the validated schema?" — the schema files live under `.github/prompts/` (gitignored) and may be edited later.

## Recommendation

- Use `Copy-Item` — preserves filenames byte-identical
- Snapshot under `migrations/_baseline_source/` (NOT inside the running migrations dir)
- Add a `README.md` in the snapshot dir explaining provenance

## Suggested Fix

1. `mkdir migrations/_baseline_source/`
2. `Copy-Item .github/prompts/db-refactor/schema/*.sql migrations/_baseline_source/`
3. Write the README explaining provenance + source prompt dir + the validation gate
4. Commit

## Acceptance Criteria

- [ ] `migrations/_baseline_source/` exists with the matching count of `.sql` files
- [ ] `migrations/_baseline_source/README.md` explains provenance
- [ ] Files byte-identical to source (no inline edits)
- [ ] Committed

## Verification

```powershell
(Get-ChildItem D:\repos\teslasync\migrations\_baseline_source\*.sql).Count
(Get-ChildItem D:\repos\teslasync\.github\prompts\db-refactor\schema\*.sql).Count
# Both numbers must match

fc.exe /b `
  D:\repos\teslasync\.github\prompts\db-refactor\schema\08-signal-observations.sql `
  D:\repos\teslasync\migrations\_baseline_source\08-signal-observations.sql
# Expected: "FC: no differences encountered"
```

## Out of Scope

- Don't reformat or "tidy" SQL during copy.
- Don't snapshot non-`.sql` files.
- Don't gitignore the snapshot dir.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add migrations/_baseline_source/
git commit -m "migrations(db-refactor): snapshot phase-3 schema source

Pinned source-of-record copies of all phase-3-schema/*.sql files for
baseline migration 000142. Snapshot dir is intentionally tracked.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-008
- `.github/prompts/db-refactor/phase-3-schema/README.md`
