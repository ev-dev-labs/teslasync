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

**File:** `internal/api/telemetry_handler.go:2625–2627`

```go
if v, ok := signals["AutomaticEmergencyBrakingOff"]; ok {
    b := toBool(v)
    snap.AutomaticEmergencyBrakingOff = &b
}
```

**Coercion function:** `toBool()` (line 1473)

The `toBool()` function correctly:
- Unwraps `{"value": X}` envelope from Fleet Telemetry protobuf payloads
- Handles native `bool`, `float64` (≠0 → true), and `string` ("true"/"1" → true)

| Check | Result |
|-------|--------|
| Coercion function | `toBool` ✅ |
| Envelope unwrap | Yes — `{"value": X}` handled ✅ |
| All enum values handled | N/A (boolean signal) |
| Potential data loss | **NO** ✅ |

**Subscription:** Listed in `internal/api/signals.go:64` — signal is subscribed. ✅

**Signal type registry:** `internal/enums/signal_types.go:221` — `TypeBool` ✅

---

## 2. Storage Layer

### 2a. `vehicle_live_state` (current state)

**File:** `internal/database/live_state_repo.go`

Two mappings exist (both correct):
- `signalToColumn` (line 255): `"AutomaticEmergencyBrakingOff" → "automatic_emergency_braking_off"`
- `boolColumns` map (line 462): `"AutomaticEmergencyBrakingOff" → "automatic_emergency_braking_off"`

DB column type: `BOOLEAN` (nullable, via pointer `*bool` in Go model)

### 2b. `safety_snapshots` (historical snapshots)

**File:** `internal/database/safety_repo.go:21`

Stored via `SafetyRepo.Insert()` as parameter `$3` in the INSERT query.
Column: `automatic_emergency_braking_off` (BOOLEAN).

**Trigger condition:** Snapshot is written whenever `AutomaticEmergencyBrakingOff`, `DriverSeatBelt`, or `ForwardCollisionWarning` arrives (telemetry_handler.go:2613–2616).

### 2c. `signal_history` (time-series)

**File:** `internal/database/signal_history_writer.go:74–75`

Boolean values route through the `case bool:` branch → stored in `value_bool` column.

| Check | Result |
|-------|--------|
| DB tables | `vehicle_live_state`, `safety_snapshots`, `signal_history` ✅ |
| DB column | `automatic_emergency_braking_off` (BOOLEAN) ✅ |
| live_state mapping | Yes (both `signalToColumn` and `boolColumns`) ✅ |
| signal_history column | `value_bool` ✅ |

---

## 3. API Layer

**File:** `internal/api/safety_handler.go`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/safety/latest?vehicle_id=X` | GET | Latest safety snapshot |
| `/api/v1/safety?vehicle_id=X&limit=N` | GET | Paginated safety history |

**Router registration:** `internal/api/router.go:599–602` ✅

**Go struct JSON tag:** `json:"automatic_emergency_braking_off,omitempty"` (models.go:1056)

**Go type:** `*bool` — serialized as `true`/`false` or omitted if nil.

| Check | Result |
|-------|--------|
| API endpoints | `GET /safety/latest`, `GET /safety` ✅ |
| JSON field name | `automatic_emergency_braking_off` ✅ |
| Transformation | NONE (direct bool serialization) ✅ |

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
automatic_emergency_braking_off: boolean;
```

The `camelCaseKeys()` transform in `resilientFetch` keeps **both** the original snake_case key
and adds a camelCase alias. Since the page uses snake_case, the value is always present. ✅

### 4b. `useSafety` / `useSafetyHistory` hooks (UNUSED)

**File:** `web/src/api/hooks/useVehicleSystems.ts:85–97`

These hooks exist but are **never called** by any page. They import `SafetySnapshot` from
`@/types/vehicle-systems.ts` which has an incorrect field name:

```ts
// @/types/vehicle-systems.ts:73
automaticEmergencyBraking: boolean;  // ← WRONG: missing "Off" suffix
```

After `camelCaseKeys`, the actual field is `automaticEmergencyBrakingOff`. Any future consumer
of this hook would get `undefined` for `data.automaticEmergencyBraking`.

| Check | Result |
|-------|--------|
| Active data path | Direct `request()` with local interface ✅ |
| TS field name | `automatic_emergency_braking_off` (snake_case) ✅ |
| TS type matches API | YES ✅ |
| Shared hook used | NO — `useSafety` hook is orphaned/unused |
| Shared hook type correct | ⚠️ NO — field name mismatch in `vehicle-systems.ts` |

---

## 5. UI Display Layer

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

### Inversion logic

The signal name `AutomaticEmergencyBrakingOff` uses **inverted semantics**: `true` = feature
disabled, `false` = feature enabled. The page correctly inverts this:

```ts
function isAebEnabled(off: boolean): boolean {
  return !off;  // off=false → enabled=true ✅
}
```

### Display locations

| Location | Display | Code |
|----------|---------|------|
| Safety Score gauge | Counts AEB as enabled feature | `boolFeatures()` → `enabledCount()` (line 82–96) |
| ADAS Feature Card | "Auto Emergency Braking" → "Enabled"/"Disabled" | `buildFeatureCards()` (line 237–242) |
| Safety States Chart | AEB line (1=on, 0=off) over time | `toChartData()` (line 213) |
| History DataTable | AEB column with On/Off badge | `buildHistoryColumns()` (line 327) |

### Null handling

All access sites use `?? false` fallback:
```ts
isAebEnabled(snap.automatic_emergency_braking_off ?? false)
```

| Check | Result |
|-------|--------|
| Displayed on page(s) | SafetySettingsPage (4 locations) ✅ |
| Display format | Boolean inverted → "Enabled"/"Disabled", On/Off badges |
| Null handling | YES — `?? false` (treats null as AEB enabled, which is safe default) ✅ |
| Orphaned signal | **NO** — actively displayed ✅ |

---

## 6. Parity Check

Example: Tesla reports `AutomaticEmergencyBrakingOff = false` (AEB is ON)

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `false` (or `{"value": false}`) | AEB is active |
| After `toBool()` | `false` | Correct boolean |
| DB Stored | `false` (BOOLEAN) | Column `automatic_emergency_braking_off` |
| API Response | `"automatic_emergency_braking_off": false` | JSON boolean |
| UI Display | **"Enabled"** (green badge) | `!false` → `true` → "Enabled" |

**Parity Status:** 🟢 **Match** — value flows correctly end-to-end with proper inversion at display layer.

---

## 7. Adjacent Findings

### 7a. `blind_spot_collision_warning` type mismatch (UNRELATED)

The Go model stores `BlindSpotCollisionWarning` as `*string`, but both the local TS interface
(SafetySettingsPage:47) and `api/types.ts:1262` declare it as `boolean`. The Go handler uses
`toString(v)` for `BlindSpotCollisionWarningChime`. This is a type mismatch but does not affect
the AEB signal.

### 7b. Orphaned `useSafety` hook

The `useSafety` and `useSafetyHistory` hooks in `useVehicleSystems.ts` are defined but never
called. Their type import from `@/types/vehicle-systems.ts` has field name mismatches
(`automaticEmergencyBraking` instead of `automaticEmergencyBrakingOff`).

### 7c. Three duplicate `SafetySnapshot` interfaces

There are three separate `SafetySnapshot` interface definitions:
1. `web/src/api/types.ts:1257` — snake_case, optional fields (most accurate)
2. `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx:42` — snake_case, non-optional
3. `web/src/types/vehicle-systems.ts:70` — camelCase, wrong field names

Should be consolidated to a single source of truth.

---

## 8. Fixes Required

| # | Fix | Severity | File(s) | Description |
|---|-----|----------|---------|-------------|
| 1 | NO | — | — | AEB signal flows correctly end-to-end. No fix needed for primary signal. |
| 2 | LOW | Latent | `web/src/types/vehicle-systems.ts:73` | Rename `automaticEmergencyBraking` → `automaticEmergencyBrakingOff` to match actual API field. |
| 3 | LOW | Latent | `web/src/types/vehicle-systems.ts:70–85` | Consolidate with `api/types.ts` SafetySnapshot and remove local duplicate in SafetySettingsPage. |

---

## Summary

| Aspect | Status |
|--------|--------|
| Ingestion | ✅ Correct (`toBool`, envelope unwrap) |
| Storage | ✅ Correct (3 tables, `value_bool` for history) |
| API | ✅ Correct (snake_case JSON, no transform) |
| Frontend | ✅ Correct (snake_case access, null-safe) |
| UI Display | ✅ Correct (inverted with `!off`, 4 display sites) |
| End-to-End Parity | 🟢 **Match** |
