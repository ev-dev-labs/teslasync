---
description: "Phase 7 — Replace residual `: any` and `Record<string, any>` in types.ts with concrete interfaces"
---

# 🔵 Frontend 06 — Replace residual `: any` and `Record<string, any>` in types.ts with concrete interfaces

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 6 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/types.ts` |
| Depends on | 05-update-types-snapshots |
| Blocks | 07-add-type-signal-observation |
| ADR refs | ADR-001, ADR-004 |


## Single Goal

Grep for any remaining `any` or loose `Record<string, any>` usage in `web/src/api/types.ts` and replace with concrete interfaces or `unknown`. After this prompt, `types.ts` must contain zero `: any`.

## Recommendation

### Recipe

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern ':\s*any\b|Record<string,\s*any>'
```

For each hit:
- If the field is genuinely opaque to the FE → use `unknown`
- If it's a known shape → introduce a concrete interface and reference it
- Never use `as any` to silence

Note: `command_params: Record<string, unknown>` on automation action steps is the sole permitted carve-out (ADR-001) — but that lives in `web/src/types/automations.ts`, not `api/types.ts`.

## Acceptance Criteria

- [ ] `Select-String` for `: any\b` returns 0 hits in `api/types.ts`
- [ ] `Select-String` for `Record<string, any>` returns 0 hits in `api/types.ts`
- [ ] No `as any` introduced
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern ':\s*any\b'
# Expected: 0 hits
Select-String -Path src\api\types.ts -Pattern 'Record<string,\s*any>'
# Expected: 0 hits
```

## Out of Scope

- Don't touch files outside `api/types.ts`
- Don't add new domain types here (prompts 07-30 handle those)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): purge `any` from api/types.ts

Zero `: any` and zero `Record<string, any>` remain in central API types.
All loose shapes now carry concrete interfaces or `unknown`.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
