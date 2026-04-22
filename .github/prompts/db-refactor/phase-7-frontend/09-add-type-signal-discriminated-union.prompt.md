---
description: "Phase 7 — Add discriminated-union helper that narrows SignalObservation by value_type"
---

# 🔵 Frontend 09 — Add discriminated-union helper that narrows SignalObservation by value_type

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 9 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/signals.ts` |
| Depends on | 08-add-type-signal-catalog-entry |
| Blocks | 10-add-type-automation |
| ADR refs | ADR-002 |


## Single Goal

Add a `TypedSignalObservation` discriminated union plus a `narrowSignal()` helper that picks the populated value field based on a `SignalCatalogEntry`'s `value_type`.

## Recommendation

### Edit `web/src/types/signals.ts`

```typescript
// Discriminated children — exactly one value_* is populated
export interface NumericSignalObservation extends SignalObservation {
  value_type: 'numeric';
  value: number;
}
export interface TextSignalObservation extends SignalObservation {
  value_type: 'text';
  value: string;
}
export interface BoolSignalObservation extends SignalObservation {
  value_type: 'bool';
  value: boolean;
}

export type TypedSignalObservation =
  | NumericSignalObservation
  | TextSignalObservation
  | BoolSignalObservation;

/**
 * Narrows a raw SignalObservation against its catalog entry, surfacing the
 * single populated value via `.value` and `.value_type`. Returns null if the
 * row is malformed (e.g., value_type=numeric but value_numeric is null).
 */
export function narrowSignal(
  obs: SignalObservation,
  catalog: SignalCatalogEntry,
): TypedSignalObservation | null {
  switch (catalog.value_type) {
    case 'numeric':
      return obs.value_numeric == null
        ? null
        : { ...obs, value_type: 'numeric', value: obs.value_numeric };
    case 'text':
      return obs.value_text == null
        ? null
        : { ...obs, value_type: 'text', value: obs.value_text };
    case 'bool':
      return obs.value_bool == null
        ? null
        : { ...obs, value_type: 'bool', value: obs.value_bool };
  }
}
```

## Acceptance Criteria

- [ ] `TypedSignalObservation` union with 3 children
- [ ] `narrowSignal()` exhaustive over `value_type`
- [ ] No `: any` introduced
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\signals.ts -Pattern 'export type TypedSignalObservation'
# Expected: 1 hit
Select-String -Path src\types\signals.ts -Pattern 'export function narrowSignal'
# Expected: 1 hit
npx tsc --noEmit src/types/signals.ts 2>&1 | Select-String 'error'
# Expected: 0 hits
```

## Out of Scope

- Don't import this in pages yet (prompt 42)
- Don't add Zod validators

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add TypedSignalObservation discriminated union + narrowSignal helper

Lets pages access the populated value field type-safely instead of
branching on three nullable columns at every read site.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
