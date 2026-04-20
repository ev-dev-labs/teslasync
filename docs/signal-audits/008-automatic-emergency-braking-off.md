# Signal Audit: AutomaticEmergencyBrakingOff

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `AutomaticEmergencyBrakingOff` |
| **Proto Field** | `ftproto.Field_AutomaticEmergencyBrakingOff` |
| **Signal Type** | Boolean (`TypeBool`) |
| **Category** | Safety |
| **Risk Level** | LOW |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go:2730–2732`

The signal is received in `trackSafety()`. It triggers snapshot creation when present
(along with `DriverSeatBelt` and `ForwardCollisionWarning` — line 2718–2721).

```go
if v, ok := signals["AutomaticEmergencyBrakingOff"]; ok {
    b := toBool(v)
    snap.AutomaticEmergencyBrakingOff = &b
}
```

**Coercion function:** `toBool()` (line 1578–1596)
- Unwraps `{"value": X}` envelopes
- Handles `bool`, `float64` (≠ 0), `string` ("true" / "1")
- Returns `false` for all other types

**Report:**
- [x] Coercion function used: `toBool`
- [x] All enum values handled: N/A (boolean signal)
- [x] Potential data loss in coercion: NO — boolean values map cleanly

---

## 2. Storage Layer

### 2a. `vehicle_live_state` (current state)

**File:** `internal/database/live_state_repo.go:255, 478`

Mapped in both `signalToColumn` (write path) and `signalToColumnFull` (read path):
```
"AutomaticEmergencyBrakingOff" → "automatic_emergency_braking_off"
```
DB column type: `BOOLEAN` (nullable)

### 2b. `safety_snapshots` (historical snapshots)

**File:** `internal/database/safety_repo.go:18–26`

Stored via `SafetyRepo.Insert()` as parameter `$3` in the INSERT query.
DB column: `automatic_emergency_braking_off BOOLEAN` (nullable)

### 2c. `signal_history` (per-signal time series)

**File:** `internal/database/signal_history_writer.go:74–75`

Boolean values are stored in `value_bool` column:
```go
case bool:
    row.ValueBool = &v
```

### 2d. Go Model

**File:** `internal/models/models.go:1057`
```go
AutomaticEmergencyBrakingOff *bool `json:"automatic_emergency_braking_off,omitempty" db:"automatic_emergency_braking_off"`
```

**Report:**
- [x] DB tables: `vehicle_live_state`, `safety_snapshots`, `signal_history`
- [x] DB column: `automatic_emergency_braking_off` (type: `BOOLEAN`)
- [x] live_state mapping exists: YES (both read and write paths)
- [x] signal_history stores as: `value_bool`

---

## 3. API Layer

**File:** `internal/api/router.go:649–652`

Two endpoints serve this data:
```
GET /safety          → safetyHandler.List    (history, paginated)
GET /safety/latest   → safetyHandler.Latest  (most recent snapshot)
```

Both return `SafetySnapshot` model structs. The JSON field name comes from the Go
struct tag: `"automatic_emergency_braking_off"`.

No transformation is applied — the raw boolean is returned as-is.

**Report:**
- [x] API endpoint(s): `GET /safety`, `GET /safety/latest`
- [x] JSON field name: `automatic_emergency_braking_off`
- [x] Transformation applied: NONE

---

## 4. Frontend Hook Layer

**File:** `web/src/api/hooks/useVehicleSystems.ts:85–100`

```typescript
export function useSafety(vehicleId: string) {
  // → GET /api/v1/safety/latest?vehicle_id={vehicleId}
  queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`),
}

export function useSafetyHistory(vehicleId: string) {
  // → GET /api/v1/safety?vehicle_id={vehicleId}
  queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`),
}
```

**TypeScript type** (`web/src/api/types.ts:1258–1262`):
```typescript
export interface SafetySnapshot {
  automatic_emergency_braking_off?: boolean
  // ...
}
```

The page uses a local `SafetySnapshot` interface (`SafetySettingsPage.tsx:42–45`) with
`automatic_emergency_braking_off: boolean` (non-optional). This is fine because the page
applies `?? false` fallback at every usage site.

No `camelCaseKeys()` transform is applied — field stays as `automatic_emergency_braking_off`.

**Report:**
- [x] Frontend hook: `useSafety` / `useSafetyHistory` (from `useVehicleSystems.ts`)
- [x] TS field name: `automatic_emergency_braking_off` (snake_case, no camelCase transform)
- [x] TS type matches API: YES

---

## 5. UI Display Layer

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

### Inversion Logic (CRITICAL)

The signal name is `AutomaticEmergencyBraking**Off**` — when `true`, AEB is **disabled**.
The UI correctly inverts this with `isAebEnabled()` (line 77–79):

```typescript
/** AEB uses inverted logic: `off = false` means the feature IS enabled. */
function isAebEnabled(off: boolean): boolean {
  return !off;
}
```

### Display Locations

1. **Feature Cards** (line 247–263): Shows "Auto Emergency Braking" with "Enabled"/"Disabled" label
   ```typescript
   const aebOn = isAebEnabled(snap.automatic_emergency_braking_off ?? false);
   valueText: aebOn ? t('Enabled') : t('Disabled'),
   ```

2. **Safety Score** (line 102–104): Boolean included in `boolFeatures()` score calculation
   ```typescript
   isAebEnabled(snap.automatic_emergency_braking_off ?? false),
   ```

3. **History Chart** (line 233): AEB on/off plotted as 1/0 in time series
   ```typescript
   aeb: isAebEnabled(s.automatic_emergency_braking_off ?? false) ? 1 : 0,
   ```

4. **History Table** (line 346–348): Column "AEB" with green check / red X
   ```typescript
   render: (row) => boolCell(isAebEnabled(row.automatic_emergency_braking_off ?? false)),
   ```

### Null Handling

All usages apply `?? false` fallback before passing to `isAebEnabled()`. When `null`,
the fallback `false` means "AEB is not off" → `isAebEnabled(false)` → `true` (enabled).
This is a **safe default** — showing AEB as enabled when unknown is the less alarming choice.

**Report:**
- [x] Displayed on page(s): `SafetySettingsPage` (feature card, score, history chart, history table)
- [x] Display format: "Enabled" / "Disabled" with green/red indicators
- [x] Null handling: YES — `?? false` → defaults to showing as Enabled
- [x] Inversion logic correct: YES — `!off` correctly converts "off" flag to "enabled" state

---

## 6. Parity Check

| Stage | Value (when AEB is ON) | Value (when AEB is OFF) | Notes |
|-------|------------------------|-------------------------|-------|
| Tesla Raw | `false` | `true` | Signal means "is AEB **off**" |
| After `toBool()` | `false` | `true` | Direct boolean passthrough |
| DB Stored | `false` | `true` | `BOOLEAN` column, no transform |
| API Response | `false` | `true` | JSON `automatic_emergency_braking_off` |
| `isAebEnabled()` | `!false` → `true` | `!true` → `false` | Inversion applied |
| UI Display | **"Enabled" ✅** | **"Disabled" ❌** | Correct user-facing label |

**Parity Status: 🟢 Match** — value flows correctly end-to-end with proper inversion logic.

---

## 7. Fixes Required

- [x] Fix needed: **NO**

The signal flows cleanly through every layer:
1. ✅ `toBool()` coercion is appropriate for boolean signals
2. ✅ Stored in 3 tables (`vehicle_live_state`, `safety_snapshots`, `signal_history`) with correct column types
3. ✅ API serves the raw boolean without transformation
4. ✅ Frontend type matches the API response exactly
5. ✅ UI correctly inverts the "Off" semantics with well-documented `isAebEnabled()` helper
6. ✅ Null safety handled at all display sites with `?? false` default
7. ✅ History chart and table both apply the inversion consistently

---

## Signal Catalog Entry

**File:** `web/src/lib/signalCatalog.ts:191`
```typescript
{ name: 'AutomaticEmergencyBrakingOff', category: 'Safety', type: 'boolean',
  description: 'Automatic emergency braking disabled' },
```

✅ Catalog entry is accurate — the description correctly notes "disabled" (matching the "Off" semantics).

---

## Summary

| Check | Status |
|-------|--------|
| Ingestion coercion | ✅ `toBool` — correct for boolean |
| DB storage (live_state) | ✅ Mapped in both read/write paths |
| DB storage (snapshots) | ✅ `safety_snapshots.automatic_emergency_braking_off` |
| DB storage (signal_history) | ✅ `value_bool` column |
| API endpoint exists | ✅ `GET /safety/latest`, `GET /safety` |
| JSON field name matches | ✅ `automatic_emergency_braking_off` |
| Frontend type matches | ✅ `boolean` in `SafetySnapshot` |
| UI displays correctly | ✅ Inverted with `isAebEnabled(!off)` |
| Null safety | ✅ `?? false` at all usage sites |
| End-to-end parity | 🟢 **Match** |
