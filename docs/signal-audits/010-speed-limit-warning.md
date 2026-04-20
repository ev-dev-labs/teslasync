# Signal Audit: SpeedLimitWarning

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `SpeedLimitWarning` |
| **Proto Field** | `ftproto.Field_SpeedLimitWarning` |
| **Signal Type** | Enum (`TypeEnum`) |
| **Category** | Safety |
| **Risk Level** | HIGH |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go`

### 1a. Signal registration

`internal/enums/signal_types.go` line 233:
```go
"SpeedLimitWarning": {TypeEnum, ftproto.Field_SpeedLimitWarning},
```

Subscribed in `internal/api/signals.go` line 68 — included in the safety signal group.

### 1b. Signal normalization (line 1456–1457)

```go
// normalizeFleetUnits — called in ProcessSignals() before any downstream consumer
if v, ok := signals["SpeedLimitWarning"]; ok {
    signals["SpeedLimitWarning"] = enums.ParseSpeedLimitWarning(toString(v))
}
```

`enums.ParseSpeedLimitWarning()` strips the `SpeedAssistLevel` prefix
(`internal/enums/constants.go` line 120: `PrefixSpeedAssist = "SpeedAssistLevel"`).

### 1c. Parse function (`internal/enums/parse.go` lines 177–195)

```go
func ParseSpeedLimitWarning(raw string) string {
    g := strings.TrimPrefix(raw, PrefixSpeedAssist)
    switch g {
    case "None":  return "Off"
    case "Display": return "Display"
    case "Chime":   return "Chime"
    case "Off":     return "Off"
    }
    if g != "" && g != raw { return g }
    return raw
}
```

**Enum mapping:**

| Tesla Raw Value | After Parse | Notes |
|-----------------|-------------|-------|
| `SpeedAssistLevelNone` | `Off` | Special: None → Off |
| `SpeedAssistLevelDisplay` | `Display` | |
| `SpeedAssistLevelChime` | `Chime` | |
| `Off` | `Off` | Already clean |
| `Display` | `Display` | Already clean |
| Unknown | passthrough | Fallback preserves raw |

### 1d. Safety snapshot ingestion (line 2754–2756)

Defense-in-depth: `trackSafety()` applies `ParseSpeedLimitWarning` again before writing
to the `SafetySnapshot` struct:

```go
if v, ok := signals["SpeedLimitWarning"]; ok {
    s := enums.ParseSpeedLimitWarning(toString(v))
    snap.SpeedLimitWarning = &s
}
```

**Report:**
- [x] Coercion function used: `toString()` → `ParseSpeedLimitWarning()`
- [x] All enum values handled: **YES** (None/Display/Chime + passthrough fallback)
- [x] Potential data loss in coercion: **NO**

---

## 2. Storage Layer

### 2a. `vehicle_live_state` table

**Mapping in `internal/database/live_state_repo.go` line 264:**
```go
"SpeedLimitWarning": "speed_limit_warning",
```

Column type: `TEXT` (nullable) — stores the normalized string value.

### 2b. `safety_snapshots` table

**File:** `internal/database/safety_repo.go`

Stored via `Insert()` (line 24) and read via `GetByVehicle()` (line 44):
```go
snap.SpeedLimitWarning  // *string → TEXT column "speed_limit_warning"
```

Column type: `TEXT` (nullable).

### 2c. `signal_history` table

**File:** `internal/database/signal_history_writer.go`

The `Append()` method (line 76) stores SpeedLimitWarning as a `string` type,
which routes to the `value_str` column:

```go
case string:
    if v != "" && v != "<nil>" {
        row.ValueStr = &v
    }
```

Confirmed by the signal-history snapshot (`.github/signal-history-snapshot.html` line 234):
```
SpeedLimitWarning | str | SpeedAssistLevelDisplay
```

> **Note:** The snapshot shows the raw pre-normalization value `SpeedAssistLevelDisplay`.
> This indicates the snapshot was taken before migration 122 / the parse normalization was added.
> New data will be stored as `Display` after normalization.

### 2d. Historical data migration

**Migration 122** (`migrations/000122_normalize_safety_enum_values.up.sql` lines 24–30)
retroactively cleaned old raw values in `safety_snapshots`:

```sql
UPDATE safety_snapshots SET speed_limit_warning = CASE
    WHEN speed_limit_warning = 'SpeedAssistLevelNone' THEN 'Off'
    WHEN speed_limit_warning LIKE 'SpeedAssistLevel%'
    THEN REPLACE(speed_limit_warning, 'SpeedAssistLevel', '')
    ELSE speed_limit_warning
END
WHERE speed_limit_warning LIKE 'SpeedAssistLevel%';
```

> **Note:** `signal_history` was NOT migrated — old rows may still contain raw prefixed
> values (e.g., `SpeedAssistLevelDisplay`). The frontend `cleanEnum()` helper handles this.

**Report:**
- [x] DB tables: `vehicle_live_state`, `safety_snapshots`, `signal_history`
- [x] DB column: `speed_limit_warning` (type: TEXT, nullable)
- [x] live_state mapping exists: **YES**
- [x] signal_history stores as: **value_str**

---

## 3. API Layer

### 3a. Safety endpoints

**File:** `internal/api/router.go` lines 650–652:
```go
r.Route("/safety", func(r chi.Router) {
    r.Get("/", safetyHandler.List)
    r.Get("/latest", safetyHandler.Latest)
})
```

Endpoints:
- `GET /api/v1/safety?vehicle_id={id}` → returns `[]SafetySnapshot`
- `GET /api/v1/safety/latest?vehicle_id={id}` → returns `SafetySnapshot`

### 3b. JSON field name

**Model:** `internal/models/models.go` line 1063:
```go
SpeedLimitWarning *string `json:"speed_limit_warning,omitempty" db:"speed_limit_warning"`
```

JSON output: `"speed_limit_warning": "Display"` (or `null` if not set, omitted with `omitempty`).

### 3c. Vehicle live state endpoint

Also available via `GET /api/v1/vehicles/{vehicleID}/state` through the `vehicle_live_state`
table, which includes `speed_limit_warning` as a column.

**Report:**
- [x] API endpoint(s): `/safety/latest`, `/safety`, `/vehicles/{vehicleID}/state`
- [x] JSON field name: `speed_limit_warning`
- [x] Transformation applied: **NONE** (stored normalized value is served as-is)

---

## 4. Frontend Hook Layer

### 4a. Hook

**File:** `web/src/api/hooks/useVehicleSystems.ts` lines 85–97:

```typescript
export function useSafety(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safety(vehicleId),
    queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`),
  });
}

export function useSafetyHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safetyHistory(vehicleId),
    queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`),
  });
}
```

Hook URLs: `/safety/latest` and `/safety` — correct, no double prefix.

### 4b. TypeScript type

**File:** `web/src/types/vehicle-systems.ts` line 80:
```typescript
speed_limit_warning?: string | null;
```

**File:** `web/src/api/types.ts` line 1268:
```typescript
speed_limit_warning?: string
```

Both use `string` type — matches Go `*string` JSON output. The `types/vehicle-systems.ts`
version is more precise with `| null`.

### 4c. Signal catalog

**File:** `web/src/lib/signalCatalog.ts` line 203:
```typescript
{ name: 'SpeedLimitWarning', category: 'Safety', type: 'string',
  description: 'Speed limit warning mode', enumValues: ['Off', 'Display', 'Chime'] }
```

Enum values match the `ParseSpeedLimitWarning` output exactly: `Off`, `Display`, `Chime`.

**Report:**
- [x] Frontend hook: `useSafety()` and `useSafetyHistory()` in `useVehicleSystems.ts`
- [x] TS field name: `speed_limit_warning` (snake_case, no camelCase transform)
- [x] TS type matches API: **YES**

---

## 5. UI Display Layer

### 5a. Safety Settings Page

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

**Feature card** (lines 251, 294–299):
```typescript
const slwVal = cleanEnum(snap.speed_limit_warning ?? 'Off', 'speed_limit_warning');
const slwOn = slwVal !== 'Off';

// Card definition:
{
  key: 'slw',
  label: t('Speed Limit Warning'),
  description: t('Alerts when exceeding speed limit'),
  enabled: slwOn,
  valueText: slwVal,  // displays: "Off", "Display", or "Chime"
}
```

**History table column** (lines 395–401):
```typescript
{
  header: t('SLW'),
  render: (row) => (
    <span className="text-xs text-[var(--text-secondary)]">
      {cleanEnum(row.speed_limit_warning ?? '—', 'speed_limit_warning')}
    </span>
  ),
}
```

**Safety gauge** (line 111):
```typescript
cleanEnum(snap.speed_limit_warning ?? 'Off', 'speed_limit_warning') !== 'Off',
```
Counts as an "active feature" in the safety score gauge.

### 5b. DevTools Page

**File:** `web/src/features/admin/pages/DevToolsPage.tsx` line 142:

Listed in the Safety category for raw signal inspection.

### 5c. `cleanEnum()` defense-in-depth

The frontend `cleanEnum()` function (lines 90–99) handles both old (prefixed) and new
(normalized) values from the API — critical for `signal_history` data that may still
contain raw values:

```typescript
function cleanEnum(value: string, field: keyof typeof ENUM_PREFIXES): string {
  const prefix = ENUM_PREFIXES[field]; // 'SpeedAssistLevel'
  if (prefix && value.startsWith(prefix)) {
    const stripped = value.slice(prefix.length);
    if (field === 'speed_limit_warning' && stripped === 'None') return 'Off';
    return stripped || value;
  }
  return value;
}
```

### 5d. Null handling

- Feature card: `snap.speed_limit_warning ?? 'Off'` — defaults to "Off" when null
- History table: `row.speed_limit_warning ?? '—'` — shows dash when null
- Safety gauge: `snap.speed_limit_warning ?? 'Off'` — treats null as inactive

**Report:**
- [x] Displayed on page(s): SafetySettingsPage (feature card + history table + gauge), DevToolsPage
- [x] Display format: Raw enum string (`Off` / `Display` / `Chime`)
- [x] Null handling: **YES** — explicit fallbacks at every display point

---

## 6. Parity Check

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `SpeedAssistLevelDisplay` | Raw enum with prefix |
| After `normalizeFleetUnits()` | `Display` | `ParseSpeedLimitWarning` strips prefix |
| After `trackSafety()` | `Display` | Defense-in-depth re-parse |
| DB (`safety_snapshots`) | `Display` | TEXT column, normalized |
| DB (`vehicle_live_state`) | `Display` | TEXT column, normalized |
| DB (`signal_history`) | `Display` (new) / `SpeedAssistLevelDisplay` (old) | Old rows not migrated |
| API Response | `"speed_limit_warning": "Display"` | JSON as-is |
| Frontend (new data) | `Display` | Direct passthrough |
| Frontend (old data) | `Display` | `cleanEnum()` strips prefix |
| UI Display | `Display` | Shown as feature card value |

**Parity Status: 🟢 Match** — value flows correctly end-to-end.

Old `signal_history` rows with raw prefixed values are handled by the frontend `cleanEnum()`
helper, so even historical data displays correctly.

---

## 7. Fixes Required

- [x] Fix needed: **NO**

The `SpeedLimitWarning` signal has a complete and correct data pipeline:

1. ✅ Registered as `TypeEnum` in signal type registry
2. ✅ Subscribed in the safety signal group
3. ✅ Normalized by `ParseSpeedLimitWarning()` in both `normalizeFleetUnits()` and `trackSafety()`
4. ✅ All three Tesla enum values handled (`None→Off`, `Display`, `Chime`)
5. ✅ Stored in 3 tables with correct column mapping
6. ✅ Historical data migrated (migration 122) for `safety_snapshots`
7. ✅ Frontend `cleanEnum()` handles old `signal_history` rows
8. ✅ Displayed with null safety and proper fallback values
9. ✅ Signal catalog enum values match backend parse output
10. ✅ Test coverage in `parse_test.go` with 6 test cases

### Minor observation (non-blocking)

The history table cell at line 397 uses `text-[var(--text-secondary)]` — a CSS variable in
a Tailwind arbitrary value bracket. This is an acceptable pattern per the project guidelines
(it's a dynamic/themed value, not a static inline style). No fix needed.

---

## Files Investigated

| File | Lines | Purpose |
|------|-------|---------|
| `internal/enums/signal_types.go` | 233 | Signal type registration |
| `internal/enums/constants.go` | 120 | `PrefixSpeedAssist` constant |
| `internal/enums/parse.go` | 177–195 | `ParseSpeedLimitWarning()` |
| `internal/enums/parse_test.go` | 175–195 | Parse function tests |
| `internal/api/signals.go` | 68 | Signal subscription list |
| `internal/api/telemetry_handler.go` | 1456–1457 | `normalizeFleetUnits()` |
| `internal/api/telemetry_handler.go` | 2754–2756 | `trackSafety()` |
| `internal/api/router.go` | 650–652 | Safety API endpoints |
| `internal/database/live_state_repo.go` | 264 | `signalToColumn` mapping |
| `internal/database/safety_repo.go` | 17–60 | Safety snapshot CRUD |
| `internal/database/signal_history_writer.go` | 48–90 | Signal history storage |
| `internal/models/models.go` | 1063 | `SafetySnapshot` struct |
| `migrations/000122_normalize_safety_enum_values.up.sql` | 24–30 | Historical data migration |
| `web/src/api/hooks/useVehicleSystems.ts` | 85–97 | Frontend hooks |
| `web/src/api/types.ts` | 1268 | API type definition |
| `web/src/types/vehicle-systems.ts` | 80 | Domain type definition |
| `web/src/lib/signalCatalog.ts` | 203 | Signal metadata |
| `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx` | 51,86,96,111,251,398 | UI display |
| `web/src/features/admin/pages/DevToolsPage.tsx` | 142 | DevTools signal list |
