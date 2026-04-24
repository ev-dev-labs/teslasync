---
description: "Phase-13 — Deduplicate frontend types and interfaces"
---
# Prompt 03 — Deduplicate Types + Interfaces (SignalRow, SignalHistoryResp, BadgeVariant)
> **Severity:** MEDIUM | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-03-fe-types.log` |
| Allowed files to change | `web/src/api/types.ts`, `web/src/components/SignalQueryControls.tsx`, page files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Duplicates to eliminate

| Type/Interface | Canonical Location | Duplicate In | Action |
|----------|-------------------|-------------|--------|
| `SignalRow` | `SignalQueryControls.tsx:15` (exported) | `SignalLogViewerPage.tsx:32-38`, `SignalExplorerPage.tsx:41-47` | Delete locals, import |
| `SignalHistoryResp` | Not centralized | `SignalLogViewerPage.tsx:40-49`, `SignalExplorerPage.tsx:49-58` | Move to `@/api/types.ts`, import in both pages |
| `BadgeVariant` | `@/types/fsm.ts` (exported) | `PowersharePage.tsx:17` (local) | Delete local, import from `@/types/fsm` or `@/api/types` |

## Task

### 1. Move `SignalHistoryResp` to `@/api/types.ts`

```typescript
export interface SignalHistoryResp {
  data: SignalRow[]
  total: number
  page: number
  per_page: number
}
```

### 2. For each duplicate

- Delete the local `type` or `interface` declaration
- Add import from the canonical location
- Verify all field names match (if they differ, use the superset)

### Important constraints

- `SignalRow` in `SignalQueryControls.tsx` is the canonical — check that page-level copies have identical fields
- `BadgeVariant` is already exported from `@/types/fsm.ts` and re-exported from `@/api/types.ts` — use whichever import path is shorter for each consumer
- Do a broad grep for `interface SignalRow` and `type BadgeVariant` to catch any copies missed by the audit

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Verify no local type duplicates
grep -rn "interface SignalRow\b\|interface SignalHistoryResp\b\|type BadgeVariant\b" --include="*.tsx" src/features/ | grep -v "import"
# Should return 0 matches
```

Log result. STATUS=DONE only if tsc passes AND zero local type duplicates.
