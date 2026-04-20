# Signal Audit: PassengerSeatBelt

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `PassengerSeatBelt` |
| **Proto Field** | `ftproto.Field_PassengerSeatBelt` |
| **Signal Type** | Enum (`TypeEnum`) |
| **Category** | Safety |
| **Risk Level** | HIGH |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go`

Tesla sends `PassengerSeatBelt` as an enum string with two known values:
- `"BuckleStatusLatched"` — buckled (true)
- `"BuckleStatusUnlatched"` — unbuckled (false)

### 1a. Security events path (line 2111–2114)

```go
if v, ok := signals["PassengerSeatBelt"]; ok {
    b := parseBuckleStatus(v)
    ev.PassengerSeatBelt = &b
}
```

**Coercion function:** `parseBuckleStatus()` (line 1602–1621)

Correctly handles:
- Envelope unwrap: `{"value": X}` → `X`
- `bool` passthrough
- `string`: returns `true` only for `"BuckleStatusLatched"`
- `float64`: `!= 0` → `true`
- Default: `false`

### 1b. Safety snapshots trigger

`PassengerSeatBelt` is NOT used as a trigger for safety snapshot writes (`trackSafety` only
triggers on `DriverSeatBelt`, `AutomaticEmergencyBrakingOff`, or `ForwardCollisionWarning`).
The `SafetySnapshot` model has no `PassengerSeatBelt` field.

**Subscription:** Listed in `internal/api/signals.go:67` — signal is subscribed. ✅

**Signal type registry:** `internal/enums/signal_types.go:230` — `TypeEnum` ✅

| Check | Result |
|-------|--------|
| Coercion function | `parseBuckleStatus` (security_events) ✅ |
| Envelope unwrap | Yes — `{"value": X}` handled ✅ |
| All enum values handled | YES — "BuckleStatusLatched" → true, else false ✅ |
| Potential data loss | **NO** ✅ |

---

## 2. Storage Layer

### 2a. `security_events` (historical snapshots)

**File:** `internal/database/security_repo.go:17,30`

Column: `passenger_seat_belt` (BOOLEAN, nullable).
Added in migration `000017_comprehensive_telemetry.up.sql:89`.
Stored via `parseBuckleStatus` → `*bool`. ✅

### 2b. `vehicle_live_state` (current state)

**File:** `internal/database/live_state_repo.go`

Column: `passenger_seat_belt` (BOOLEAN, nullable).
Added in migration `000035_complete_live_state.up.sql:122`.

**Mapping:** `signalToColumn` entry at line 263 maps `"PassengerSeatBelt"` →
`"passenger_seat_belt"`. However, this generic mapping is **not used** for
PassengerSeatBelt because it has a dedicated handler at line 452–458:

```go
// Handle PassengerSeatBelt (enum → boolean: "BuckleStatusLatched" → true)
if raw, ok := signals["PassengerSeatBelt"]; ok {
    if v, use := normalizeSignalValue(raw); use {
        cols = append(cols, "passenger_seat_belt")
        vals = append(vals, enums.ParseBuckleStatus(v))
    }
}
```

Uses `enums.ParseBuckleStatus()` which correctly converts
`"BuckleStatusLatched"` → `true`, all else → `false`. ✅

### 2c. `vehicle_live_state` recovery (`LoadLiveState`)

**File:** `internal/database/live_state_repo.go:649,761`

`passenger_seat_belt` is included in the `LoadLiveState()` SELECT at line 649 and
mapped back to `result["PassengerSeatBelt"]` at line 761. ✅

### 2d. `signal_history` (time-series)

**File:** `internal/database/signal_history_writer.go:64–87`

Raw signal value is stored as-is based on Go type:
- If Tesla sends `string` → stored in `value_str` (e.g., `"BuckleStatusLatched"`)
- If Tesla sends `bool` → stored in `value_bool`

No bug — raw preservation is correct for signal_history. ✅

### 2e. `safety_snapshots`

`PassengerSeatBelt` is NOT stored in the `SafetySnapshot` model. It is not a trigger
signal for safety snapshots either. This is by design — the field is a real-time
vehicle state signal, not a safety "setting."

| Check | Result |
|-------|--------|
| DB tables | `security_events`, `vehicle_live_state`, `signal_history` |
| DB column | `passenger_seat_belt` (BOOLEAN, nullable) |
| live_state mapping | Yes — dedicated `ParseBuckleStatus` handler ✅ |
| LoadLiveState recovery | Yes — SELECT + result mapping ✅ |
| signal_history column | `value_str` or `value_bool` (raw) ✅ |

---

## 3. API Layer

### 3a. Security events endpoint

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/security/latest?vehicle_id=X` | GET | Latest security event |
| `/api/v1/security?vehicle_id=X&limit=N` | GET | Paginated security history |

**Router:** `internal/api/router.go:620–622`
**Handler:** `internal/api/security_handler.go:39` (`SecurityHandler.Latest`)

**Go struct JSON tag:** `json:"passenger_seat_belt,omitempty"` (`models.SecurityEvent`, models.go:916)

**Go type:** `*bool` — serialized as `true`/`false` or omitted if nil.

### 3b. SSE live state

**Endpoint:** `/api/v1/events` (SSE stream)

The in-memory SignalStore broadcasts raw signal values via SSE. After pod restart,
`LoadLiveState` recovers `PassengerSeatBelt` as a `bool`.

| Check | Result |
|-------|--------|
| API endpoints | `GET /security/latest`, `GET /security`, SSE `/events` ✅ |
| JSON field name | `passenger_seat_belt` ✅ |
| Transformation | NONE (direct bool serialization) ✅ |

---

## 4. Frontend Hook Layer

### 4a. `useSecurityLatest` (SafetySettingsPage — ACTIVE)

**File:** `web/src/api/hooks/useVehicles.ts:155–162`

```ts
request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`)
```

Returns `SecurityEvent` from `api/types.ts:622`:
```ts
passenger_seat_belt?: boolean
```

Uses snake_case keys — matches Go JSON tag. ✅

### 4b. `useVehicleLive` (SSE live state — ACTIVE)

**File:** `web/src/hooks/useVehicleLive.ts:321`

```ts
if (raw['PassengerSeatBelt'] != null) s.passengerSeatBelt = parseBuckleStatus(raw['PassengerSeatBelt'])
```

Uses `parseBuckleStatus` from `web/src/lib/parseEnums.ts:17–22`:
```ts
export function parseBuckleStatus(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return raw === 'BuckleStatusLatched'
  if (typeof raw === 'number') return raw !== 0
  return false
}
```

Correctly maps `"BuckleStatusLatched"` → `true`, all else → `false`. ✅

**Interface type:** `passengerSeatBelt: boolean` (`useVehicleLive.ts:97`), default `false` (line 187). ✅

| Check | Result |
|-------|--------|
| Active data paths | `useSecurityLatest`, `useVehicleLive` ✅ |
| TS field name | `passenger_seat_belt` (API), `passengerSeatBelt` (live) ✅ |
| TS type matches API | YES ✅ |

---

## 5. UI Display Layer

### 5a. SafetySettingsPage

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx:616–627`

Reads from `useSecurityLatest` (security_events table):

```tsx
<SignalCard
  icon={<UserCheck className="h-6 w-6" />}
  value={
    securityData?.passenger_seat_belt == null
      ? '—'
      : securityData.passenger_seat_belt
        ? t('safety.buckled', 'Buckled')
        : t('safety.unbuckled', 'Unbuckled')
  }
  label={t('safety.passengerBelt', 'Passenger Belt')}
  positive={securityData?.passenger_seat_belt ?? null}
/>
```

- Null handling: `== null ? '—'` — shows dash when no data ✅
- Boolean labels: `true` → "Buckled", `false` → "Unbuckled" ✅
- `positive` prop: passes boolean for green/red indicator styling ✅

### 5b. DevToolsPage

**File:** `web/src/features/admin/pages/DevToolsPage.tsx:142`

Listed in Safety category for live signal debugging:
```ts
{ category: 'Safety', fields: ['DriverSeatBelt', 'PassengerSeatBelt', ...] }
```

### 5c. signalCatalog.ts

**File:** `web/src/lib/signalCatalog.ts:200`

```ts
{ name: 'PassengerSeatBelt', category: 'Safety', type: 'boolean',
  description: 'Passenger seat belt buckled' }
```

Type is `'boolean'` (normalized meaning: latched=true). Correct for alert rule
authoring — `RuleBuilder.tsx` uses `type === 'boolean'` to show `is_true`/`is_false`
operators. ✅

### 5d. Alert Templates

Unlike `DriverSeatBelt`, there is **no** pre-built alert rule template for
`PassengerSeatBelt` in AlertStudioPage. Users can still create custom rules for it.

| Check | Result |
|-------|--------|
| Displayed on page(s) | SafetySettingsPage, DevToolsPage ✅ |
| Display format | "Buckled"/"Unbuckled" (boolean to label) ✅ |
| Null handling | YES — `== null ? '—'` + `?? null` ✅ |
| Orphaned signal | **NO** — actively displayed ✅ |

---

## 6. Parity Check

Example: Tesla reports `PassengerSeatBelt = "BuckleStatusUnlatched"` (unbuckled)

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `"BuckleStatusUnlatched"` | Enum string from Fleet Telemetry |
| After `parseBuckleStatus()` | `false` | Correct: not "BuckleStatusLatched" |
| DB `security_events` | `false` (BOOLEAN) | Column `passenger_seat_belt` ✅ |
| DB `vehicle_live_state` | `false` (BOOLEAN) | Via `ParseBuckleStatus` ✅ |
| DB `signal_history` | `"BuckleStatusUnlatched"` (TEXT) | Raw enum string preserved ✅ |
| SSE live state | `false` | Via frontend `parseBuckleStatus` ✅ |
| API Response | `"passenger_seat_belt": false` | JSON boolean ✅ |
| UI Display | **"Unbuckled"** | Correct label ✅ |

Example: Tesla reports `PassengerSeatBelt = "BuckleStatusLatched"` (buckled)

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `"BuckleStatusLatched"` | Enum string from Fleet Telemetry |
| After `parseBuckleStatus()` | `true` | Correct: matches "BuckleStatusLatched" |
| DB `security_events` | `true` (BOOLEAN) | Column `passenger_seat_belt` ✅ |
| DB `vehicle_live_state` | `true` (BOOLEAN) | Via `ParseBuckleStatus` ✅ |
| DB `signal_history` | `"BuckleStatusLatched"` (TEXT) | Raw enum string preserved ✅ |
| SSE live state | `true` | Via frontend `parseBuckleStatus` ✅ |
| API Response | `"passenger_seat_belt": true` | JSON boolean ✅ |
| UI Display | **"Buckled"** | Correct label ✅ |

**Parity Status:** 🟢 **Match** — value flows correctly end-to-end through all paths.

---

## 7. Known Limitations

### 7a. Alert engine `is_true`/`is_false` uses `toBool`

Same issue as documented in `005-driver-seat-belt.md` §7a: the rule engine's `toBool`
does not understand buckle enum strings. If a user creates a custom alert rule for
`PassengerSeatBelt` with `is_true`/`is_false`, it would not evaluate correctly against
raw enum values in signal_history. This is a broader issue affecting all enum-typed
boolean signals.

### 7b. No pre-built alert template

Unlike `DriverSeatBelt`, there is no pre-built alert template for passenger seat belt.
This is a product decision, not a bug.

---

## 8. Fixes Required

| Fix needed | NO |
|------------|-----|

All code paths are correct. The `ParseBuckleStatus` fix that was applied for
`DriverSeatBelt` (audit 005) was applied to `PassengerSeatBelt` simultaneously.

---

## Summary

| Aspect | Status |
|--------|--------|
| Ingestion | ✅ Correct (`parseBuckleStatus` for security_events) |
| Storage — security_events | ✅ Correct (BOOLEAN, `parseBuckleStatus`) |
| Storage — vehicle_live_state | ✅ Correct (dedicated `ParseBuckleStatus` handler) |
| Storage — LoadLiveState recovery | ✅ Correct (included in SELECT + result map) |
| Storage — signal_history | ✅ Correct (raw enum string preserved in `value_str`) |
| API | ✅ Correct (snake_case JSON `passenger_seat_belt`, no transform) |
| Frontend — useSecurityLatest | ✅ Correct (reads `passenger_seat_belt` as `boolean`) |
| Frontend — useVehicleLive (SSE) | ✅ Correct (uses `parseBuckleStatus`) |
| UI Display | ✅ Correct ("Buckled"/"Unbuckled", null-safe) |
| End-to-End Parity | 🟢 **Match** |
