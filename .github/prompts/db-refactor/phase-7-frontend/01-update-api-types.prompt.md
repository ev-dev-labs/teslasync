---
description: "Phase 7 — Delete eliminated fields from web/src/api/types.ts"
---

# 🟢 Frontend 01 — Delete Eliminated Fields

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 1 of 5

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected file | `web/src/api/types.ts` |
| Depends on | Phase 6 complete |
| Blocks | `02-add-new-types`, `03-update-hooks` |
| ADR refs | ADR-001, ADR-002, ADR-004 |

## Single Goal

Remove every reference to legacy fields the backend no longer ships: `signals: Record<string, any>`, `raw_json: any`, `trigger_config`, `conditions`, `actions`, `raw_state`, `config` (where it was loose jsonb).

## What's Being Established

Mirror the Phase 5 Go-side deletions in TypeScript so `tsc --noEmit` will fail loudly on any page still touching dead fields.

## Recommendation

### Fields to delete

| Interface | Field | Replacement |
|-----------|-------|-------------|
| `Vehicle`, `Drive`, `ChargeSession`, all snapshots | `signals?: Record<string, unknown>` | typed columns / `SignalObservation` |
| `Drive`, `ChargeSession`, `Trip`, `Position` | `raw_json?: unknown` | typed columns only |
| `Automation` | `trigger_config: any` | `trigger: AutomationStepTrigger` (CTI child) |
| `Automation` | `conditions: any[]` | `conditions: AutomationStepCondition[]` |
| `Automation` | `actions: any[]` | `actions: AutomationStepAction[]` |
| `Vehicle` | `raw_state?: unknown` | typed `vehicle_live_state` columns |
| `NotificationChannel` | `config: Record<string, any>` | typed channel-kind interfaces (Phase 7 prompt 02) |

### Recipe

```bash
# Identify call sites BEFORE deleting (so prompt 04 can fix them)
cd web
npx grep -rn "\\.signals\\b\\|\\.raw_json\\b\\|\\.trigger_config\\b" src/ > /tmp/legacy-refs.txt
```

Then delete each field from `types.ts`. Do NOT yet add replacements (prompt 02). Expect `tsc` to fail after this prompt — that's the point.

## Suggested Fix

1. Open `web/src/api/types.ts`
2. Delete the 7 fields enumerated above
3. Save the legacy-refs grep output to `web/scripts/legacy-refs-snapshot.txt` (gitignored or committed as plan input)
4. Run `npx tsc --noEmit` — expect errors; capture count
5. Commit (deletion-only)

## Acceptance Criteria

- [ ] `web/src/api/types.ts` has no `signals`, `raw_json`, `trigger_config`, `conditions: any`, `actions: any`, `raw_state`, loose `config` jsonb fields
- [ ] `npx tsc --noEmit` produces a finite, enumerable error list (used as todo input for prompt 04)
- [ ] Error count captured in commit message
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern '\bsignals\?:|raw_json|trigger_config|conditions:\s*any|actions:\s*any|raw_state'
# Expected: 0 hits

npx tsc --noEmit 2>&1 | Tee-Object -FilePath ..\..\.github\prompts\db-refactor\logs\phase-7-01-tsc-after-delete.log
# Expected: errors exist (prompt 02-04 will resolve)
```

## Out of Scope

- Don't add replacement types (prompt 02)
- Don't touch hook files (prompt 03)
- Don't fix page errors (prompt 04)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/src/api/types.ts
git add -f .github/prompts/db-refactor/logs/phase-7-01-tsc-after-delete.log
git commit -m "web(db-refactor): delete legacy fields from api/types.ts

Removed: signals, raw_json, trigger_config, conditions:any,
actions:any, raw_state, loose channel config. Replacements added in
phase-7 prompt 02. Expect tsc errors until 02-04 land.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-001, ADR-002, ADR-004
- Phase 5 prompt 02 (Go-side deletions mirror)
