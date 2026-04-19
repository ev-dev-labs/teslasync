# Signal Audit: ForwardCollisionWarning

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `ForwardCollisionWarning` |
| **Proto Field** | `ftproto.Field_ForwardCollisionWarning` |
| **Signal Type** | Enum (`TypeEnum`) |
| **Category** | Safety |
| **Risk Level** | HIGH |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go`

### 1a. Signal normalization (line 1362–1365)

```go
// normalizeFleetUnits — called in ProcessSignals() before any downstream consumer
if v, ok := signals["ForwardCollisionWarning"]; ok {
    signals["ForwardCollisionWarning"] = enums.ParseForwardCollisionWarning(toString(v))
}
```

**NEW:** `enums.ParseForwardCollisionWarning()` strips the `ForwardCollisionSensitivity` prefix.

### 1b. Safety snapshot ingestion (line 2641–2643)

```go
if v, ok := signals["ForwardCollisionWarning"]; ok {
    s := enums.ParseForwardCollisionWarning(toString(v))
    snap.ForwardCollisionWarning = &s
}
```

**Coercion chain:** Raw value → `toString()` (unwraps `{"value": X}` envelope) → `ParseForwardCollisionWarning()` (strips prefix).

### 1c. Enum value mapping

| Tesla Raw Value | After Parse | Status |
|-----------------|-------------|--------|
| `ForwardCollisionSensitivityOff` | `Off` | ✅ |
| `ForwardCollisionSensitivityLate` | `Late` | ✅ |
| `ForwardCollisionSensitivityAverage` | `Average` | ✅ |
| `ForwardCollisionSensitivityEarly` | `Early` | ✅ |
| Already-clean `Early` | `Early` | ✅ (idempotent) |

| Check | Result |
|-------|--------|
| Coercion function | `toString` → `ParseForwardCollisionWarning` ✅ |
| Envelope unwrap | Yes — `{"value": X}` handled by `toString()` ✅ |
| All enum values handled | YES ✅ |
| Potential data loss | **NO** ✅ |

**Subscription:** Listed in `internal/api/signals.go:66` — signal is subscribed. ✅

**Signal type registry:** `internal/enums/signal_types.go:226` — `TypeEnum` ✅

---

## 2. Storage Layer

### 2a. `vehicle_live_state` (current state)

**File:** `internal/database/live_state_repo.go`

- `signalToColumn` (line 261): `"ForwardCollisionWarning" → "forward_collision_warning"` ✅
- `textColumns` map (line 31): `"forward_collision_warning": true` ✅

DB column type: `VARCHAR(200)` (migration 000035). Stores clean normalized value.

### 2b. `safety_snapshots` (historical snapshots)

**File:** `internal/database/safety_repo.go:23`

Stored via `SafetyRepo.Insert()` as parameter `$7` in the INSERT query.
Column: `forward_collision_warning` (VARCHAR(100), migration 000037 converted from BOOLEAN).

**Trigger condition:** Snapshot is written whenever `AutomaticEmergencyBrakingOff`, `DriverSeatBelt`, or `ForwardCollisionWarning` arrives (telemetry_handler.go:2613–2616).

### 2c. `signal_history` (time-series)

**File:** `internal/database/signal_history_writer.go:76–78`

String values route through the `case string:` branch → stored in `value_str` column.
After normalization in `normalizeFleetUnits()`, value is clean (e.g., `"Early"` not `"ForwardCollisionSensitivityEarly"`).

| Check | Result |
|-------|--------|
| DB tables | `vehicle_live_state`, `safety_snapshots`, `signal_history` ✅ |
| DB column | `forward_collision_warning` (VARCHAR) ✅ |
| live_state mapping | Yes (`signalToColumn` + `textColumns`) ✅ |
| signal_history column | `value_str` ✅ |

---

## 3. API Layer

**File:** `internal/api/safety_handler.go`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/safety/latest?vehicle_id=X` | GET | Latest safety snapshot |
| `/api/v1/safety?vehicle_id=X&limit=N` | GET | Paginated safety history |

**Router registration:** `internal/api/router.go:599–602` ✅

**Go struct JSON tag:** `json:"forward_collision_warning,omitempty"` (models.go:1060)

**Go type:** `*string` — serialized as string or omitted if nil.

| Check | Result |
|-------|--------|
| API endpoints | `GET /safety/latest`, `GET /safety` ✅ |
| JSON field name | `forward_collision_warning` ✅ |
| Transformation | Normalized from raw enum prefix in ingestion layer ✅ |

---

## 4. Frontend Hook Layer

### 4a. Direct `request()` usage (SafetySettingsPage — ACTIVE)

The page fetches data directly:
```ts
request<SafetySnapshot>(`/safety/latest?vehicle_id=${activeId}`)
request<SafetySnapshot[]>(`/safety?vehicle_id=${activeId}&limit=100`)
```

Local interface uses **snake_case** keys (matching Go JSON tags):
```ts
forward_collision_warning: string;
```

The `camelCaseKeys()` transform in `resilientFetch` keeps **both** the original snake_case key
and adds a camelCase alias. Since the page uses snake_case, the value is always present. ✅

| Check | Result |
|-------|--------|
| Active data path | Direct `request()` with local interface ✅ |
| TS field name | `forward_collision_warning` (snake_case) ✅ |
| TS type matches API | YES (`string`) ✅ |
| Hook URL prefix | No `/api/v1/` prefix — correct ✅ |

---

## 5. UI Display Layer

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

### Display locations

1. **Feature Cards** — Shows FCW as a card with enabled/disabled status and value text
   - `buildFeatureCards()` reads `snap.forward_collision_warning`, applies `cleanEnum()` to strip
     any remaining raw prefix, compares against `'Off'`
   - Card shows clean value text (e.g., `"Early"`, `"Late"`, `"Off"`)

2. **Safety Score Gauge** — Counts FCW as "enabled" when value ≠ `"Off"`
   - `boolFeatures()` → `enabledCount()` → `RadialGauge`

3. **History Table** — Shows FCW value per-row with `cleanEnum()` applied

4. **Signal Cards** — Shows individual signal values in top section

### Null/empty handling

```ts
const fcwVal = cleanEnum(snap.forward_collision_warning ?? 'Off', 'forward_collision_warning');
```
- Missing/null → defaults to `'Off'`
- Raw prefixed values → stripped by `cleanEnum()` (backward compat with existing DB rows)

| Check | Result |
|-------|--------|
| Displayed on page(s) | `SafetySettingsPage` (feature cards, gauge, history table) ✅ |
| Display format | Clean enum value: "Off", "Late", "Average", "Early" ✅ |
| Null handling | YES — defaults to 'Off' ✅ |

---

## 6. Parity Check

| Stage | Value (example) | Notes |
|-------|-----------------|-------|
| Tesla Raw | `ForwardCollisionSensitivityEarly` | Full prefixed enum from Fleet Telemetry |
| After `normalizeFleetUnits()` | `Early` | Prefix stripped by `ParseForwardCollisionWarning()` |
| DB (`safety_snapshots`) | `Early` | Stored as clean VARCHAR |
| DB (`vehicle_live_state`) | `Early` | Stored as clean VARCHAR |
| DB (`signal_history`) | `Early` | Stored as clean `value_str` |
| API Response | `"forward_collision_warning": "Early"` | JSON serialization, omitted if nil |
| UI Display | `Early` | Clean value in feature card + history table |

**Parity Status: 🟢 Match** — value flows correctly end-to-end after normalization fix.

---

## 7. Bugs Found & Fixed

### Bug A: Missing enum prefix stripping (CRITICAL)

**Root cause:** Raw Tesla enum values like `ForwardCollisionSensitivityEarly` were stored
without normalizing. The `PrefixForwardCollision` constant existed in `constants.go` but
no parse function was ever called.

**Impact:**
- UI showed raw prefixed strings (e.g., `"ForwardCollisionSensitivityEarly"`) to users
- Off-state detection broken: `"ForwardCollisionSensitivityOff" !== "Off"` → always `true`
- Safety score calculation incorrect (FCW always counted as "enabled")

**Fix:** Added `ParseForwardCollisionWarning()` in `internal/enums/parse.go` and called it
in `normalizeFleetUnits()` (same pattern as `ParseGear()`). All downstream consumers now
receive clean values.

### Bug B: Same issue affected 3 sibling signals

| Signal | Raw Value | Expected |
|--------|-----------|----------|
| `LaneDepartureAvoidance` | `LaneAssistLevelWarning` | `Warning` |
| `SpeedLimitWarning` | `SpeedAssistLevelDisplay` | `Display` |
| `CruiseFollowDistance` | `FollowDistance7` | `7` |

All three had the same missing normalization. Fixed with corresponding `Parse*()` functions.

`CruiseFollowDistance` had an additional bug: `Number("FollowDistance7")` → `NaN` → feature
always showed as disabled in the UI.

### Bug C: Existing historical data had raw values

**Fix:** Migration `000122_normalize_safety_enum_values.up.sql` normalizes existing
`safety_snapshots` rows. Frontend `cleanEnum()` helper provides backward compatibility
for any rows not yet migrated.

---

## 8. Files Changed

| File | Change |
|------|--------|
| `internal/enums/parse.go` | Added `ParseForwardCollisionWarning`, `ParseLaneDepartureAvoidance`, `ParseSpeedLimitWarning`, `ParseCruiseFollowDistance` |
| `internal/enums/parse_test.go` | Added table-driven tests for all 4 new parse functions |
| `internal/api/telemetry_handler.go` | Added safety enum normalization in `normalizeFleetUnits()` + defense-in-depth in `trackSafety()` |
| `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx` | Added `cleanEnum()` helper, applied to all enum fields in cards, gauge, and history table |
| `migrations/000122_normalize_safety_enum_values.up.sql` | Normalizes existing safety_snapshots rows |
| `migrations/000122_normalize_safety_enum_values.down.sql` | Reverts normalization |

---

## 9. Signal Catalog

**File:** `web/src/lib/signalCatalog.ts:196`

```ts
{ name: 'ForwardCollisionWarning', category: 'Safety', type: 'string',
  description: 'Forward collision warning sensitivity',
  enumValues: ['Off', 'Late', 'Average', 'Early'] }
```

After normalization fix, these clean values now match what's stored in signal_history and
used by the RuleBuilder. **No change needed.** ✅
