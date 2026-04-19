# Signal Audit: SpeedLimitWarning

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `SpeedLimitWarning` |
| **Proto Field** | `ftproto.Field_SpeedLimitWarning` |
| **Signal Type** | Enum (string) (`TypeEnum`) |
| **Category** | Safety |
| **Risk Level** | HIGH |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go`

### Normalization (normalizeFleetUnits — line 1365–1366)

```go
if v, ok := signals["SpeedLimitWarning"]; ok {
    signals["SpeedLimitWarning"] = enums.ParseSpeedLimitWarning(toString(v))
}
```

- Coercion chain: raw value → `toString()` → `enums.ParseSpeedLimitWarning()` → normalized string
- `toString()` handles `string`, `float64`, `bool`, `map` (extracts `"value"` key), and `fmt.Sprint` fallback.

### Parse function (`internal/enums/parse.go:177–195`)

```go
func ParseSpeedLimitWarning(raw string) string {
    g := strings.TrimPrefix(raw, PrefixSpeedAssist)  // "SpeedAssistLevel"
    switch g {
    case "None":   return "Off"
    case "Display": return "Display"
    case "Chime":  return "Chime"
    case "Off":    return "Off"
    }
    if g != "" && g != raw { return g }
    return raw
}
```

### Enum value mapping

| Tesla Raw Value | After ParseSpeedLimitWarning | Notes |
|-----------------|------------------------------|-------|
| `SpeedAssistLevelNone` | `Off` | Prefix stripped + mapped |
| `SpeedAssistLevelDisplay` | `Display` | Prefix stripped |
| `SpeedAssistLevelChime` | `Chime` | Prefix stripped |
| `Off` | `Off` | Already clean (idempotent) |
| `Display` | `Display` | Already clean |
| `Chime` | `Chime` | Already clean (via fallback) |
| Unknown value | Passed through unchanged | Fallback preserves unknown values |

### Test coverage (`internal/enums/parse_test.go:175–194`)

6 test cases covering prefixed, clean, and unknown inputs. ✅

**Report:**
- [x] Coercion function used: `toString()` → `enums.ParseSpeedLimitWarning()`
- [x] All known enum values handled: **YES** (None/Display/Chime + already-clean values)
- [x] Potential data loss in coercion: **NO** — unknown values passed through unchanged

---

## 2. Storage Layer

### 2a. `vehicle_live_state` table

**Mapping** (`internal/database/live_state_repo.go:264`):
```go
"SpeedLimitWarning": "speed_limit_warning",
```

- Column: `speed_limit_warning VARCHAR(200)` (added in migration 000035)
- Marked as text column (`live_state_repo.go:39` — in `textColumns` map)
- Stored as the normalized string value (e.g., `"Off"`, `"Display"`, `"Chime"`)

### 2b. `safety_snapshots` table

**Repo:** `internal/database/safety_repo.go`
- Column: `speed_limit_warning VARCHAR(50)` (created in migration 000017 as `VARCHAR(20)`, widened in migration 000026 to `VARCHAR(50)`)
- Stored via `trackSafety()` in `telemetry_handler.go:2663–2665`:
  ```go
  if v, ok := signals["SpeedLimitWarning"]; ok {
      s := enums.ParseSpeedLimitWarning(toString(v))
      snap.SpeedLimitWarning = &s
  }
  ```
- Historical data normalized via migration 000122 (strips `SpeedAssistLevel` prefix from legacy rows)

### 2c. `signal_history` table

**Writer:** `internal/database/signal_history_writer.go:47–90`
- SpeedLimitWarning is a `string` after normalization → stored in `value_str` column
- The `Append()` method type-switches: `case string:` → sets `row.ValueStr`

### Go model (`internal/models/models.go:1062`)

```go
SpeedLimitWarning *string `json:"speed_limit_warning,omitempty" db:"speed_limit_warning"`
```

**Report:**
- [x] DB tables: `vehicle_live_state`, `safety_snapshots`, `signal_history`
- [x] DB column: `speed_limit_warning` (type: `VARCHAR(200)` in live_state, `VARCHAR(50)` in safety_snapshots)
- [x] live_state mapping exists: **YES** (`signalToColumn["SpeedLimitWarning"] = "speed_limit_warning"`)
- [x] signal_history stores as: **value_str**

---

## 3. API Layer

### Endpoints

| Endpoint | Method | Handler | Description |
|----------|--------|---------|-------------|
| `GET /api/v1/safety/latest?vehicle_id=X` | GET | `SafetyHandler.Latest` | Returns latest SafetySnapshot |
| `GET /api/v1/safety?vehicle_id=X` | GET | `SafetyHandler.List` | Returns SafetySnapshot array (history) |
| `GET /api/v1/vehicles/{vehicleID}/state` | GET | VehicleStateHandler | Returns vehicle_live_state (includes speed_limit_warning) |
| `GET /api/v1/signals/{vehicleID}/{signalName}/history` | GET | SignalHandler | Returns signal_history rows |

### JSON field name

From Go struct tag: `json:"speed_limit_warning,omitempty"`

The API returns `speed_limit_warning` as a nullable string with the normalized value (`"Off"`, `"Display"`, `"Chime"`).

**Report:**
- [x] API endpoint(s): `/safety/latest`, `/safety`, `/vehicles/{id}/state`, `/signals/{id}/SpeedLimitWarning/history`
- [x] JSON field name: `speed_limit_warning`
- [x] Transformation applied: **NONE** — normalized value returned as-is from DB

---

## 4. Frontend Hook Layer

### Hook: `useSafety` (`web/src/api/hooks/useVehicleSystems.ts:85–91`)

```typescript
export function useSafety(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safety(vehicleId),
    queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    refetchInterval: 30_000,
  });
}
```

### Hook: `useSafetyHistory` (`useVehicleSystems.ts:94–100`)

```typescript
export function useSafetyHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safetyHistory(vehicleId),
    queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}
```

### Type: `SafetySnapshot` (used in page — `SafetySettingsPage.tsx:42–57`)

```typescript
interface SafetySnapshot {
  // ... other fields ...
  speed_limit_warning: string;  // matches Go JSON tag ✅
  // ...
}
```

> **Note:** The page defines its own local `SafetySnapshot` interface (line 42) with snake_case fields.
> This is correct — `request<T>()` does NOT apply `camelCaseKeys()`, so the response fields
> remain in snake_case matching the Go JSON tags. The shared type in `web/src/types/vehicle-systems.ts`
> (line 70–85) uses camelCase (`speedLimitWarning`) but is NOT used by the page — no mismatch.

**Report:**
- [x] Frontend hook: `useSafety` (latest) + `useSafetyHistory` (list)
- [x] TS field name: `speed_limit_warning` (snake_case, matching Go)
- [x] TS type matches API: **YES**

---

## 5. UI Display Layer

### Page: `SafetySettingsPage.tsx`

**Location:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

#### Display contexts:

1. **Feature card** (line 292–298):
   ```tsx
   {
     key: 'slw',
     label: t('Speed Limit Warning'),
     description: t('Alerts when exceeding speed limit'),
     enabled: slwOn,           // slwVal !== 'Off'
     valueText: slwVal,        // "Off", "Display", or "Chime"
   }
   ```

2. **History table column** (line 383–391):
   ```tsx
   {
     key: 'slw',
     header: t('SLW'),
     render: (row) => (
       <span className="text-xs text-[var(--text-secondary)]">
         {cleanEnum(row.speed_limit_warning ?? '—', 'speed_limit_warning')}
       </span>
     ),
   }
   ```

3. **Enabled-features score** (line 111): counted as enabled when `cleanEnum(...) !== 'Off'`

#### Frontend cleanEnum function (line 91–100):

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

This handles legacy un-normalized DB values (before migration 000122). For current data, `cleanEnum` is a no-op since the backend already normalizes.

#### Display labels:

| Normalized Value | Displayed As | Card "Enabled" |
|------------------|-------------|-----------------|
| `Off` | "Off" | No (grey) |
| `Display` | "Display" | Yes (green) |
| `Chime` | "Chime" | Yes (green) |
| `null`/missing | `'—'` (dash) | No |

#### Null handling:
- `snap.speed_limit_warning ?? 'Off'` for feature cards ✅
- `row.speed_limit_warning ?? '—'` for history table ✅

**Report:**
- [x] Displayed on page(s): `SafetySettingsPage` (feature card + history table + enabled count)
- [x] Display format: Raw enum label ("Off" / "Display" / "Chime")
- [x] Null handling: **YES** — defaults to `'Off'` or `'—'`

---

## 6. Parity Check

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `SpeedAssistLevelChime` | Prefixed enum from Fleet Telemetry |
| After normalizeFleetUnits | `Chime` | `ParseSpeedLimitWarning` strips prefix |
| DB Stored (vehicle_live_state) | `Chime` | VARCHAR(200) column |
| DB Stored (safety_snapshots) | `Chime` | VARCHAR(50) column, `trackSafety()` also normalizes |
| DB Stored (signal_history) | `Chime` | value_str column |
| API Response | `"speed_limit_warning": "Chime"` | JSON from SafetyHandler.Latest |
| UI Display | "Chime" | Feature card shows "Chime", marked as enabled |

**Parity Status: 🟢 Match** — value flows correctly end-to-end

---

## 7. Fixes Required

- [x] Fix needed: **NO**

The signal flows correctly through every layer:
1. ✅ Ingestion normalizes the Tesla prefix (`SpeedAssistLevel*` → clean value)
2. ✅ Parser handles all 3 known enum values + unknown fallback
3. ✅ Stored in 3 tables with correct column types
4. ✅ API returns snake_case JSON matching Go struct tags
5. ✅ Frontend type uses snake_case matching API
6. ✅ UI displays human-readable label with null safety
7. ✅ Legacy data cleaned by migration 000122
8. ✅ Frontend `cleanEnum()` provides defense-in-depth for any remaining prefixed values
9. ✅ Signal catalog lists correct enum values: `['Off', 'Display', 'Chime']`
10. ✅ DevToolsPage includes `SpeedLimitWarning` in the Safety signal group

### Minor observation (non-blocking)

The history table column uses `text-[var(--text-secondary)]` (inline CSS variable in Tailwind arbitrary value) on line 388. This is technically a CSS variable reference but is within Tailwind's arbitrary value syntax, not an inline `style={}`, so it passes the project's styling rules.

---

## Signal Catalog Entry

```typescript
// web/src/lib/signalCatalog.ts:203
{ name: 'SpeedLimitWarning', category: 'Safety', type: 'string',
  description: 'Speed limit warning mode', enumValues: ['Off', 'Display', 'Chime'] }
```

✅ Catalog enum values match the parser output exactly.

---

## Summary

| Check | Status |
|-------|--------|
| Ingestion coercion correct | ✅ |
| All enum values handled | ✅ |
| DB storage correct | ✅ |
| live_state mapping exists | ✅ |
| signal_history column correct | ✅ |
| API JSON field matches Go tag | ✅ |
| Frontend type matches API | ✅ |
| UI displays correctly | ✅ |
| Null/empty handling | ✅ |
| Legacy data migration | ✅ |
| End-to-end parity | 🟢 Match |
