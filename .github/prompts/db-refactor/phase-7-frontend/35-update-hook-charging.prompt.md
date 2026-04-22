---
description: "Phase 7 — Drop `raw_json` from useCharging.ts; verify telemetry hook returns typed cols"
---

# 🟢 Frontend 35 — Drop `raw_json` from useCharging.ts; verify telemetry hook returns typed cols

> **Severity:** Foundational | **Priority:** Medium | **Prompt #:** 35 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useCharging.ts` |
| Depends on | 34-update-hook-driving |
| Blocks | 36-update-hook-trips |
| ADR refs | ADR-001, ADR-002 |


## Single Goal

Remove any `raw_json` references. Confirm `useChargingTelemetry` returns `ChargingTelemetry[]` matching the typed Phase 3 hypertable.

## Recommendation

### Edit `web/src/api/hooks/useCharging.ts`

```powershell
Select-String -Path src\api\hooks\useCharging.ts -Pattern 'raw_json'
```

Delete each. Verify the telemetry hook signature:
```typescript
export function useChargingTelemetry(sessionId: number | string | undefined) {
  return useQuery({
    queryKey: ['charging-telemetry', sessionId],
    queryFn: () => request<ChargingTelemetry[]>(`/charging/${sessionId}/telemetry`),
    enabled: !!sessionId,
  });
}
```

## Acceptance Criteria

- [ ] Zero `raw_json` references
- [ ] `useChargingTelemetry` returns `ChargingTelemetry[]`
- [ ] No `/api/v1/` prefix
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useCharging.ts -Pattern 'raw_json'
# Expected: 0 hits
```

## Out of Scope

- Don't update charging pages (prompt 40)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): useCharging drops raw_json; telemetry uses typed cols

Aligned with Phase 3 charging_telemetry hypertable.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
