# Signal Audit: EmergencyLaneDepartureAvoidance

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `EmergencyLaneDepartureAvoidance` |
| **Proto Field** | `ftproto.Field_EmergencyLaneDepartureAvoidance` |
| **Signal Type** | Boolean (`TypeBool`) |
| **Category** | Safety |
| **Risk Level** | LOW |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go:2742–2744`

```go
if v, ok := signals["EmergencyLaneDepartureAvoidance"]; ok {
    b := toBool(v)
    snap.EmergencyLaneDepartureAvoidance = &b
}
```

- **Coercion function:** `toBool()` (lines 1578–1597)
  - Unwraps `{"value": X}` envelope ✓
  - Handles `bool`, `float64` (≠0 → true), `string` ("true"/"1" → true)
- **All enum values handled:** N/A (boolean signal)
- **Potential data loss in coercion:** NO — `toBool` is appropriate for a boolean signal

**Subscribed:** Listed in `internal/api/signals.go:65` in the Safety group ✓

---

## 2. Storage Layer

### 2a. `vehicle_live_state` (current state)

**Mapping:** `internal/database/live_state_repo.go:260`
```
"EmergencyLaneDepartureAvoidance": "emergency_lane_departure_avoidance"
```

**Column type:** `BOOLEAN` (added in `migrations/000035_complete_live_state.up.sql:73`)

**Write path:** Handled via `enumBoolSignals` map at `live_state_repo.go:490`:
```go
"EmergencyLaneDepartureAvoidance": "emergency_lane_departure_avoidance",
```
Value is coerced through `enums.ParseEnumBool()` which converts any truthy value to `bool`.
The column is then added to `skipCols` (line 526–528) so the generic loop skips it.

**⚠️ Code Quality Issue:** `emergency_lane_departure_avoidance` is also listed in the
`isVarcharCol` map (`live_state_repo.go:41`), which marks it as a VARCHAR column. This is
**incorrect metadata** — the column is BOOLEAN. This entry is currently **dead code** because
the signal is handled by `enumBoolSignals` before the generic loop, so the `isVarcharCol`
check at line 583 is never reached for this signal. However, it would cause a silent
string-cast (`fmt.Sprintf("%v", v)`) if the `enumBoolSignals` handling were ever removed.

### 2b. `safety_snapshots` (historical snapshots)

**Table:** `safety_snapshots` (created in `migrations/000017_comprehensive_telemetry.up.sql:144`)
**Column:** `emergency_lane_departure_avoidance BOOLEAN` ✓
**Repo:** `internal/database/safety_repo.go:18,23` — Insert and GetByVehicle both handle this field ✓

### 2c. `signal_history` (per-signal time series)

**Storage:** `value_bool` column ✓ (confirmed by `signal-history-snapshot.html:129`)
**Writer:** `signal_history_writer.go:74–75` — `bool` type → `row.ValueBool = &v` ✓

### Summary

| Store | Table | Column | DB Type | Mapping | Status |
|-------|-------|--------|---------|---------|--------|
| Live state | `vehicle_live_state` | `emergency_lane_departure_avoidance` | BOOLEAN | `signalToColumn` + `enumBoolSignals` | ✅ |
| Snapshots | `safety_snapshots` | `emergency_lane_departure_avoidance` | BOOLEAN | SafetyRepo.Insert | ✅ |
| History | `signal_history` | `value_bool` | BOOLEAN | SignalHistoryWriter.Append | ✅ |

---

## 3. API Layer

### Endpoint: `GET /safety/latest?vehicle_id={id}`

**Router:** `internal/api/router.go:650–652`
```go
r.Route("/safety", func(r chi.Router) {
    r.Get("/", safetyHandler.List)
    r.Get("/latest", safetyHandler.Latest)
})
```

**Model:** `internal/models/models.go:1060`
```go
EmergencyLaneDepartureAvoidance *bool `json:"emergency_lane_departure_avoidance,omitempty" db:"emergency_lane_departure_avoidance"`
```

**JSON field name:** `emergency_lane_departure_avoidance`
**Transformation:** NONE — raw boolean serialized directly

### Endpoint: `GET /safety?vehicle_id={id}`

Returns `[]*models.SafetySnapshot` — same JSON field name and type.

---

## 4. Frontend Hook Layer

**Hook file:** `web/src/api/hooks/useVehicleSystems.ts`

```typescript
// Line 85-91
export function useSafety(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safety(vehicleId),
    queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    refetchInterval: 30_000,
  });
}

// Line 94-100
export function useSafetyHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safetyHistory(vehicleId),
    queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}
```

**TypeScript type:** `web/src/types/vehicle-systems.ts:77`
```typescript
emergency_lane_departure_avoidance?: boolean | null;
```

Also defined in `web/src/api/types.ts:1265`:
```typescript
emergency_lane_departure_avoidance?: boolean
```

**TS field name:** `emergency_lane_departure_avoidance` (snake_case — no camelCase transform) ✓
**TS type matches API:** YES — `boolean | null` matches Go `*bool` with `omitempty` ✓
**No double-prefix:** Hook URL is `/safety/latest?vehicle_id=...` — correct ✓

---

## 5. UI Display Layer

**Page:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

### Display locations:

1. **Feature card** (lines 314–320):
   ```typescript
   {
     key: 'elda',
     label: t('Emergency Lane Departure Avoidance'),
     description: t('Steers back on unintentional departure'),
     enabled: snap.emergency_lane_departure_avoidance ?? false,
     valueText: (snap.emergency_lane_departure_avoidance ?? false) ? t('Enabled') : t('Disabled'),
   }
   ```

2. **Safety score calculation** (line 107):
   ```typescript
   snap.emergency_lane_departure_avoidance ?? false,
   ```

3. **History chart data** (line 236):
   ```typescript
   elda: (s.emergency_lane_departure_avoidance ?? false) ? 1 : 0,
   ```

4. **History table column** (lines 380–382):
   ```typescript
   {
     key: 'elda',
     header: t('ELDA'),
     render: (row) => boolCell(row.emergency_lane_departure_avoidance ?? false),
   }
   ```

5. **DevTools page** (line 142): Listed in Safety category signal viewer.

### Display format:
- Feature card: "Enabled" / "Disabled" labels
- History chart: 1 / 0 (binary for chart rendering)
- History table: boolean cell (green ✓ / red ✗)

### Null handling: YES ✓
- All accesses use `?? false` fallback

---

## 6. Parity Check

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `true` / `false` (or `{"value": true}`) | Boolean signal from Fleet Telemetry |
| After Coercion | `true` / `false` | `toBool()` unwraps envelope, handles bool/float/string |
| DB Stored (live_state) | `true` / `false` | `ParseEnumBool()` → BOOLEAN column |
| DB Stored (safety_snapshots) | `true` / `false` | `toBool()` → `*bool` → BOOLEAN column |
| DB Stored (signal_history) | `true` / `false` | `value_bool` column |
| API Response | `true` / `false` | `json:"emergency_lane_departure_avoidance"` |
| UI Display | "Enabled" / "Disabled" | Human-readable label |

**Parity Status:** 🟢 **Match** — value flows correctly end-to-end

---

## 7. Issues Found

### Issue 1: `isVarcharCol` misclassification (LOW severity)

- **Fix needed:** YES (code quality, no runtime impact)
- **Description:** `emergency_lane_departure_avoidance` is listed in the `isVarcharCol` map
  (`live_state_repo.go:41`) but the `vehicle_live_state` column is `BOOLEAN`, not `VARCHAR`.
  This entry is currently dead code because the signal is processed by `enumBoolSignals`
  before the generic loop. However, it's incorrect metadata that could cause a bug if
  the code is refactored.
- **File:** `internal/database/live_state_repo.go:41`
- **Suggested fix:** Remove `"emergency_lane_departure_avoidance": true` from `isVarcharCol`.

### Issue 2: Legacy VARCHAR(50) migration (INFO)

- **Description:** `internal/database/migrations/000028_live_state_extended_columns.up.sql:150`
  defined the column as `VARCHAR(50)`, while the canonical root migration
  `migrations/000035_complete_live_state.up.sql:73` defines it as `BOOLEAN`. Both use
  `ADD COLUMN IF NOT EXISTS`, so whichever ran first determines the actual column type.
  The root migrations directory is authoritative; the internal migrations directory appears
  to be legacy. This is informational only — no action needed if the root migrations are
  applied on fresh databases.
- **File:** `internal/database/migrations/000028_live_state_extended_columns.up.sql:150`
- **Suggested fix:** None required for new deployments. Existing DBs from 000028 may have
  VARCHAR(50) — would need an `ALTER COLUMN ... TYPE BOOLEAN USING ...::BOOLEAN` migration
  if encountered.

---

## 8. Signal Catalog Entry

`web/src/lib/signalCatalog.ts:195`:
```typescript
{ name: 'EmergencyLaneDepartureAvoidance', category: 'Safety', type: 'boolean',
  description: 'Emergency lane departure avoidance enabled' },
```
✅ Correct category, type, and description.

---

## Summary

| Layer | Status | Notes |
|-------|--------|-------|
| Ingestion | ✅ | `toBool()` — correct for boolean signal |
| Storage (live_state) | ✅ | `enumBoolSignals` → `ParseEnumBool()` → BOOLEAN |
| Storage (safety_snapshots) | ✅ | `toBool()` → `*bool` → BOOLEAN |
| Storage (signal_history) | ✅ | `value_bool` column |
| API | ✅ | `emergency_lane_departure_avoidance` as `*bool` |
| Frontend hook | ✅ | `useSafety` + `useSafetyHistory` |
| UI display | ✅ | SafetySettingsPage — card, chart, table |
| Parity | 🟢 | End-to-end match |
| Code quality | ⚠️ | `isVarcharCol` has stale entry (no runtime impact) |
