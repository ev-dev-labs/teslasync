# Signal Audit: LaneDepartureAvoidance

## Signal Identity

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `LaneDepartureAvoidance` |
| **Proto Field** | `ftproto.Field_LaneDepartureAvoidance` |
| **Signal Type** | Enum (string) (`TypeEnum`) |
| **Category** | Safety |
| **Risk Level** | HIGH |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go` (lines 1453–1454, 2750–2752)

The signal is received as a raw Tesla enum string in the `normalizeFleetUnits()` function:

```go
if v, ok := signals["LaneDepartureAvoidance"]; ok {
    signals["LaneDepartureAvoidance"] = enums.ParseLaneDepartureAvoidance(toString(v))
}
```

**Coercion:** `toString(v)` → `enums.ParseLaneDepartureAvoidance()` (string normalization).

**Parse function** (`internal/enums/parse.go:159–175`):
- Strips prefix `"LaneAssistLevel"` via `strings.TrimPrefix(raw, PrefixLaneAssist)`
- Maps known values:
  - `"LaneAssistLevelOff"` → `"Off"`
  - `"LaneAssistLevelWarning"` → `"Warning"`
  - `"LaneAssistLevelAssist"` → `"Assist"`
- Already-clean values pass through: `"Off"` → `"Off"`, `"Warning"` → `"Warning"`
- Unknown values pass through unchanged (safe fallback)

**Test coverage** (`internal/enums/parse_test.go:153–172`):
- All 3 prefixed inputs tested ✓
- Pre-cleaned inputs tested (`"Off"`, `"Warning"`) ✓
- Unknown value tested (`"SomeUnknown"` → `"SomeUnknown"`) ✓

**Report:**
- [x] Coercion function used: `toString()` → `enums.ParseLaneDepartureAvoidance()`
- [x] All enum values handled: **YES** — Off, Warning, Assist all mapped correctly
- [x] Potential data loss in coercion: **NO**

---

## 2. Storage Layer

### 2a. `vehicle_live_state` (current state)

**File:** `internal/database/live_state_repo.go` (line 262)

```go
"LaneDepartureAvoidance": "lane_departure_avoidance",
```

- **DB column:** `lane_departure_avoidance` (type: `VARCHAR(200)`, added in migration 000035)
- Mapping exists in `signalToColumn` map ✓
- Also appears in the boolean column map at line 490 for `EmergencyLaneDepartureAvoidance` (different signal) ✓

### 2b. `safety_snapshots` (historical snapshots)

**File:** `internal/database/safety_repo.go` (lines 18–26, 38–46)

- **DB column:** `lane_departure_avoidance` (type: `VARCHAR(100)`, created in migration 000017)
- Stored via `SafetySnapshot.LaneDepartureAvoidance` field
- Migration 000037 fixed column type from BOOLEAN → VARCHAR(100) (early schema error)
- Migration 000122 normalized existing raw prefix values in-place:
  `LaneAssistLevelOff` → `Off`, `LaneAssistLevelWarning` → `Warning`, etc.

### 2c. `signal_history` (per-signal time series)

**File:** `internal/database/signal_history_writer.go` (lines 64–86)

The writer uses Go type-switch: after `ParseLaneDepartureAvoidance()`, the value is a `string`,
so it gets stored as `value_str` (line 76–81).

**Report:**
- [x] DB tables: `vehicle_live_state`, `safety_snapshots`, `signal_history`
- [x] DB columns: `lane_departure_avoidance` (VARCHAR) / `value_str` (TEXT)
- [x] live_state mapping exists: **YES**
- [x] signal_history stores as: **value_str**

---

## 3. API Layer

**File:** `internal/api/safety_handler.go` (lines 20–37, 39–50)

Two endpoints serve this data:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/v1/safety?vehicle_id={id}` | `List` | Returns `[]*SafetySnapshot` (history) |
| `GET /api/v1/safety/latest?vehicle_id={id}` | `Latest` | Returns latest `*SafetySnapshot` |

**Go struct** (`internal/models/models.go:1062`):
```go
LaneDepartureAvoidance *string `json:"lane_departure_avoidance,omitempty" db:"lane_departure_avoidance"`
```

- **JSON field:** `lane_departure_avoidance`
- **Type:** `*string` (nullable)
- No transformation applied — value passes through as stored in DB.

The signal is also available via the live signals API (`/signals/{vehicleID}/live`)
which reads from `vehicle_live_state`, but the primary display path uses the safety endpoints.

**Report:**
- [x] API endpoint(s): `GET /safety/latest`, `GET /safety`
- [x] JSON field name: `lane_departure_avoidance`
- [x] Transformation applied: **NONE** (direct from DB)

---

## 4. Frontend Hook Layer

**File:** `web/src/api/hooks/useVehicleSystems.ts` (lines 85–101)

```typescript
export function useSafety(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safety(vehicleId),
    queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    refetchInterval: 30_000,
  });
}

export function useSafetyHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safetyHistory(vehicleId),
    queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}
```

- Hook URL `/safety/latest` → resolves to `/api/v1/safety/latest` (client auto-prefix) ✓
- No double-prefix issue ✓
- Query param `vehicle_id` uses snake_case ✓

**TypeScript type** (`web/src/api/types.ts:1266` and page-local `SafetySnapshot` at line 50):
```typescript
lane_departure_avoidance?: string;  // in api/types.ts
lane_departure_avoidance: string;   // in SafetySettingsPage local interface
```

- Uses snake_case field name (no `camelCaseKeys()` transform applied to this hook) ✓
- Type `string` matches Go `*string` JSON output ✓

**Report:**
- [x] Frontend hook: `useSafety()`, `useSafetyHistory()` from `useVehicleSystems.ts`
- [x] TS field name: `lane_departure_avoidance` (snake_case, no camelCase transform)
- [x] TS type matches API: **YES**

---

## 5. UI Display Layer

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

### Display locations:

1. **Feature Card** (lines 280–284):
   - Label: `"Lane Departure Avoidance"`
   - Value shown: `ldaVal` = `cleanEnum(snap.lane_departure_avoidance ?? 'Off', 'lane_departure_avoidance')`
   - Enabled status: `ldaOn = ldaVal !== 'Off'`
   - Shows: `"Off"`, `"Warning"`, or `"Assist"` directly

2. **Safety Score** (lines 102–113):
   - Used in `boolFeatures()` to compute enabled-feature count
   - Counted as enabled when `cleanEnum(...) !== 'Off'`

3. **History Table** (lines 369–377):
   - Column header: `"LDA"`
   - Cell value: `cleanEnum(row.lane_departure_avoidance ?? '—', 'lane_departure_avoidance')`
   - Handles null with `?? '—'` fallback

4. **DevTools page** (`web/src/features/admin/pages/DevToolsPage.tsx:142`):
   - Listed under Safety category for raw signal inspection

### Null handling:
- Feature card: `snap.lane_departure_avoidance ?? 'Off'` → defaults to `"Off"` ✓
- History table: `row.lane_departure_avoidance ?? '—'` → shows dash ✓
- `cleanEnum()` handles both old (prefixed) and new (clean) values for backward compat ✓

### `cleanEnum()` function (lines 90–100):
```typescript
function cleanEnum(value: string, field: keyof typeof ENUM_PREFIXES): string {
  const prefix = ENUM_PREFIXES[field]; // 'LaneAssistLevel'
  if (prefix && value.startsWith(prefix)) {
    const stripped = value.slice(prefix.length);
    if (stripped === 'None') return 'Off';
    return stripped || value;
  }
  return value;
}
```
This provides frontend-side normalization for old (pre-migration-122) data that may still have
raw prefixed values. After migration 000122, all stored values are already clean.

**Report:**
- [x] Displayed on page(s): **SafetySettingsPage** (feature card + history table + safety score)
- [x] Display format: Raw enum string (`"Off"`, `"Warning"`, `"Assist"`)
- [x] Null handling: **YES** — defaults to `"Off"` (card) or `"—"` (table)

---

## 6. Parity Check

| Stage | Value | Notes |
|-------|-------|-------|
| **Tesla Raw** | `"LaneAssistLevelWarning"` | Prefixed enum from Fleet Telemetry |
| **After Coercion** | `"Warning"` | `ParseLaneDepartureAvoidance()` strips prefix |
| **DB Stored** | `"Warning"` | VARCHAR in `safety_snapshots` and `vehicle_live_state` |
| **API Response** | `"Warning"` | `json:"lane_departure_avoidance"` — no transform |
| **UI Display** | `"Warning"` | `cleanEnum()` is no-op on already-clean value |

All three enum values traced:

| Tesla Raw | Normalized | UI Display | Status |
|-----------|-----------|------------|--------|
| `LaneAssistLevelOff` | `Off` | `Off` | 🟢 Match |
| `LaneAssistLevelWarning` | `Warning` | `Warning` | 🟢 Match |
| `LaneAssistLevelAssist` | `Assist` | `Assist` | 🟢 Match |

**Parity Status: 🟢 Match** — value flows correctly end-to-end.

---

## 7. Fixes Required

- [x] Fix needed: **NO**
- No issues found. The signal is correctly:
  - Subscribed (`signals.go` line 66)
  - Parsed with prefix-stripping (`ParseLaneDepartureAvoidance`)
  - Stored as VARCHAR in both `vehicle_live_state` and `safety_snapshots`
  - Stored as `value_str` in `signal_history`
  - Served via `/safety/latest` and `/safety` endpoints
  - Displayed on `SafetySettingsPage` with proper null handling and backward-compat `cleanEnum()`
  - Historical data normalized by migration 000122

---

## Summary

| Check | Status |
|-------|--------|
| Signal subscribed | ✅ |
| Ingestion coercion correct | ✅ |
| All enum values handled | ✅ (Off, Warning, Assist) |
| Parse function tested | ✅ (6 test cases) |
| live_state mapping | ✅ |
| safety_snapshots storage | ✅ |
| signal_history storage | ✅ (value_str) |
| API endpoint exists | ✅ (/safety/latest, /safety) |
| JSON field matches Go tag | ✅ |
| Frontend hook URL correct | ✅ (no double-prefix) |
| TS type matches API | ✅ |
| UI displays value | ✅ (card + table + score) |
| Null safety handled | ✅ |
| Backward compat (old prefix) | ✅ (cleanEnum + migration 122) |
| **End-to-end parity** | **🟢 MATCH** |
