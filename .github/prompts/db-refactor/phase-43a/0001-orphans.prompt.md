---
description: "Phase 43a - methodology + ORPHAN hook disposition (useAlerts, useDashboardLayouts)"
---

# Prompt 0001 — Orphan hook disposition

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0001-orphans.log` |
| Depends on | `phase-42a-9999-final-gate.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `web/src/api/hooks/useAlerts.ts` (re-export only), `web/src/api/hooks/useDashboardLayouts.ts` (re-export only), `web/src/api/hooks/index.ts`, the output log; AND any feature page that re-mounts the orphan hook (limit 4 page files; list in DESIGN before editing) |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. Verify before claiming. Run every grep/test you cite.
2. Paste actual command output, not summaries.
3. No silent stubs. If a feature can't be wired, BLOCK and document.
4. Status reflects reality. EXIT=0/STATUS=DONE only when every gate check passes.
5. No skill skipping. Run prior-log sweep, build, vet, test.
6. No commit on BLOCKED.
7. No fabricated numbers. Counts come from grep, not memory.
8. No silent scope expansion. Allowed-files list is the contract.
9. Surface dependencies. If a prereq is missing, name it and BLOCK.
10. Honest commit messages. Rollback notes when one-way.
11. **No dead code retention.** If a symbol has zero callers post-migration, DELETE it (the entire purpose of phase-43a's orphan disposition).
12. **No production blind spot.** Every hook MUST have either a production consumer OR a documented intentional ORPHAN waiver in the audit allowlist.
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Phase-43 prompt 0080 audit identified 2 ORPHAN hooks (zero production
consumers):

| Hook | URLs | Consumers |
|---|---|---|
| `useAlerts.ts` | 0 | 0 |
| `useDashboardLayouts.ts` | 4 | 0 |

ORPHAN status means the hook file exists, exports query/mutation hooks,
but no page or component imports it. Two valid resolutions per ADR-004
#4 reversal ("no UI deletion"):

- **Re-mount**: Find the page that USED to consume the hook in git
  history, restore that page, mark hook as USED.
- **Document waiver**: If the hook is genuinely dead (e.g., a planned
  feature that never shipped), add it to an audit allowlist with a
  reason; ADR-004 #4 reversal applies to RENDERED UI components, not
  to never-rendered helper hook files.

This prompt forces the choice and executes it.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Disposition matrix** | For each ORPHAN hook: (a) `git log -- <hook>` to find the commit that introduced it. (b) Quote the commit message + linked issue. (c) Decide RE-MOUNT or WAIVER based on intent. |
| 2 | **`useAlerts.ts`** | This hook has 0 URLs (no backend calls at all) — it's pure dead code regardless. WAIVER if it's a documented future-feature scaffold; DELETE if it's leftover scaffolding. (Note: deletion of unused hook FILE is permitted; deletion is only forbidden for RENDERED UI per ADR-004 #4.) |
| 3 | **`useDashboardLayouts.ts`** | 4 URLs to `/dashboard/layouts/*`. If those routes exist in `internal/api/router.go` (verify), the hook is live backend-side; the missing piece is a UI page that calls it. Either re-mount (preferred) or waiver. |
| 4 | **Audit allowlist file** | New file `web/src/api/hooks/orphan-allowlist.ts` exporting `INTENTIONAL_ORPHANS = ['useAlerts'] as const` (or empty). Phase-43 audit script reads this and treats listed hooks as PASS. Each entry MUST have a comment with reason + future-mount issue link. |
| 5 | **Tests** | Update `phase-43-0080-hook-coverage-audit` script (NOT in this prompt's allowed files — surface as gap if it needs change) to consume the allowlist. Phase-43a 9999 will re-run the audit and assert 0 ORPHANs OR 0 not-allowlisted ORPHANs. |
| 6 | **No new backend routes in this prompt** | This prompt is about disposition of FRONTEND orphans. Backend route additions live in 0002-0008. |

## Action Steps

1. `git status` clean.
2. Predecessor `phase-42a-9999-final-gate.log` DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - `git log --oneline -- web/src/api/hooks/useAlerts.ts | head -5`
   - `git log --oneline -- web/src/api/hooks/useDashboardLayouts.ts | head -5`
   - `grep -rn 'useAlerts\|useDashboardLayouts' web/src --include='*.tsx' --include='*.ts' | grep -v 'api/hooks/'` (current import sites)
   - `grep -n 'dashboard/layouts' internal/api/router.go` (backend route presence)
4. `=== DESIGN ===` per Decision #1: tabulate disposition.
5. Implement the chosen disposition for each.
6. Create or update `orphan-allowlist.ts` per Decision #4.
7. Gate:
   - `cd web && npx tsc --noEmit` MUST pass.
   - `cd web && npm run lint` MUST pass.
   - `git status --short` allowed only.
8. Commit `chore(phase-43a): orphan hook disposition (useAlerts, useDashboardLayouts)`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If git history shows BOTH orphan hooks were imported by RENDERED pages
that were deleted in some prior phase, RE-MOUNT both pages (within the
4-file budget). If the budget is exceeded, BLOCK and surface — re-mount
sweep is its own prompt.

If `dashboard/layouts/*` routes do NOT exist in `internal/api/router.go`
either, the hook is doubly-dead: WAIVER + add a backlog entry to author
both backend + frontend in a future phase.
