---
description: "Phase 7 — Drop `raw_json` from Drive; verify snake_case fields"
---

# 🟢 Frontend 02 — Drop `raw_json` from Drive; verify snake_case fields

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 2 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/types.ts` |
| Depends on | 01-update-types-vehicle |
| Blocks | 03-update-types-charging |
| ADR refs | ADR-001 |


## Single Goal

Remove `raw_json?: unknown` from the `Drive` interface and confirm every other field is snake_case matching Phase 5 Go JSON tags.

## Recommendation

### Edit `web/src/api/types.ts`

```typescript
// REMOVE from Drive interface:
//   raw_json?: unknown;
```

After removal, verify these snake_case fields exist (do not rename if already correct):
`id, vehicle_id, started_at, ended_at, distance_km, duration_min, energy_used_kwh, start_address, end_address, start_latitude, start_longitude, end_latitude, end_longitude, max_speed_kph, avg_speed_kph`.

## Acceptance Criteria

- [ ] `Drive.raw_json` deleted
- [ ] No camelCase fields on `Drive`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern 'raw_json' -Context 2,2 |
  Select-String -Pattern 'Drive\b'
# Expected: 0 hits
```

## Out of Scope

- Don't fix Drive consumers (prompt 34/39 handles)
- Don't touch ChargeSession/Trip yet

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): drop Drive.raw_json

Drive type now relies on typed columns only.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 5: internal/models/drive.go
