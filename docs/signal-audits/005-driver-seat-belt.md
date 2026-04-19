# Signal Audit: DriverSeatBelt

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `DriverSeatBelt` |
| **Proto Field** | `ftproto.Field_DriverSeatBelt` |
| **Signal Type** | Enum (`TypeEnum`) |
| **Category** | Safety |
| **Risk Level** | HIGH |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go`

Tesla sends `DriverSeatBelt` as an enum string with two known values:
- `"BuckleStatusLatched"` — buckled (true)
- `"BuckleStatusUnlatched"` — unbuckled (false)

### 1a. Security events path (line 2002–2004)

```go
if v, ok := signals["DriverSeatBelt"]; ok {
    b := parseBuckleStatus(v)
    ev.DriverSeatBelt = &b
}
```

**Coercion function:** `parseBuckleStatus()` (line 1497–1515)

Correctly handles:
- Envelope unwrap: `{"value": X}` → `X`
- `bool` passthrough
- `string`: returns `true` only for `"BuckleStatusLatched"`
- `float64`: `!= 0` → `true`

### 1b. Safety snapshots trigger (line 2612–2618)

`DriverSeatBelt` is used as a **trigger** signal for writing safety snapshots, but the
`SafetySnapshot` model has no `DriverSeatBelt` field. The signal is not stored in this table.

**Subscription:** Listed in `internal/api/signals.go:65` — signal is subscribed. ✅

**Signal type registry:** `internal/enums/signal_types.go:224` — `TypeEnum` ✅

| Check | Result |
|-------|--------|
| Coercion function | `parseBuckleStatus` (security_events) ✅ |
| Envelope unwrap | Yes — `{"value": X}` handled ✅ |
| All enum values handled | YES — "BuckleStatusLatched" → true, else false ✅ |
| Potential data loss | **NO** ✅ |

---

## 2. Storage Layer

### 2a. `security_events` (historical snapshots)

**File:** `internal/database/security_repo.go:18,30`

Column: `driver_seat_belt` (BOOLEAN, nullable). Stored via `parseBuckleStatus` ✅

### 2b. `vehicle_live_state` (current state)

**File:** `internal/database/live_state_repo.go`

Column: `driver_seat_belt` (BOOLEAN, nullable).

🔴 **BUG FOUND (now fixed):** Was listed in `enumBoolSignals` map and converted via
`ParseEnumBool()`, which treats any non-empty, non-"Off" string as `true`:
- `"BuckleStatusLatched"` → `true` ✅
- `"BuckleStatusUnlatched"` → `true` ❌ **WRONG** (should be `false`)

**Fix applied:** Removed from `enumBoolSignals`, added dedicated handling via
`enums.ParseBuckleStatus()`.

### 2c. `vehicle_live_state` recovery (`LoadLiveState`)

🔴 **BUG FOUND (now fixed):** `LoadLiveState()` did not SELECT or return `driver_seat_belt`
or `passenger_seat_belt`. After pod restart, seat belt state was lost.

**Fix applied:** Added both columns to SELECT, scan, and result mapping.

### 2d. `signal_history` (time-series)

**File:** `internal/database/signal_history_writer.go:64–87`

Raw signal value is stored as-is:
- If Tesla sends `string` → stored in `value_str` (e.g., `"BuckleStatusLatched"`)
- If Tesla sends `bool` → stored in `value_bool`

No bug here — raw preservation is correct for signal_history.

### 2e. `safety_snapshots`

`DriverSeatBelt` is NOT stored in the `SafetySnapshot` model. It triggers the snapshot
write but its value is not persisted here. This is by design — the field is not a
"safety setting" but a real-time vehicle state signal.

| Check | Result |
|-------|--------|
| DB tables | `security_events`, `vehicle_live_state`, `signal_history` |
| DB column | `driver_seat_belt` (BOOLEAN) |
| live_state mapping | Yes (`signalToColumn` + dedicated buckle handler) ✅ |
| signal_history column | `value_str` or `value_bool` (raw) ✅ |

---

## 3. API Layer

### 3a. Security events endpoint

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/security/latest?vehicle_id=X` | GET | Latest security event |
| `/api/v1/security?vehicle_id=X&limit=N` | GET | Paginated security history |

**Go struct JSON tag:** `json:"driver_seat_belt,omitempty"` (`models.SecurityEvent`, models.go:914)

**Go type:** `*bool` — serialized as `true`/`false` or omitted if nil.

### 3b. SSE live state

**Endpoint:** `/api/v1/events` (SSE stream)

The in-memory SignalStore broadcasts raw signal values. After pod restart, `LoadLiveState`
now recovers `DriverSeatBelt` as a `bool`.

| Check | Result |
|-------|--------|
| API endpoints | `GET /security/latest`, `GET /security`, SSE `/events` ✅ |
| JSON field name | `driver_seat_belt` ✅ |
| Transformation | NONE (direct bool serialization) ✅ |

---

## 4. Frontend Hook Layer

### 4a. `useSecurityLatest` (SafetySettingsPage — ACTIVE)

**File:** `web/src/api/hooks/useVehicles.ts:155–161`

```ts
request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`)
```

Returns `SecurityEvent` from `api/types.ts:621`:
```ts
driver_seat_belt?: boolean
```

Uses snake_case keys — matches Go JSON tag. ✅

### 4b. `useVehicleLive` (SSE live state — ACTIVE)

**File:** `web/src/hooks/useVehicleLive.ts:320`

🔴 **BUG FOUND (now fixed):** Was using `parseEnumBool()` which has the same flaw as
the backend `ParseEnumBool`:
```ts
// BEFORE (wrong):
if (raw['DriverSeatBelt'] != null) s.driverSeatBelt = bool('DriverSeatBelt')
// bool() calls parseEnumBool() → "BuckleStatusUnlatched" → true ❌

// AFTER (fixed):
if (raw['DriverSeatBelt'] != null) s.driverSeatBelt = parseBuckleStatus(raw['DriverSeatBelt'])
```

| Check | Result |
|-------|--------|
| Active data paths | `useSecurityLatest`, `useVehicleLive` ✅ |
| TS field name | `driver_seat_belt` (API), `driverSeatBelt` (live) ✅ |
| TS type matches API | YES ✅ |

---

## 5. UI Display Layer

### 5a. SafetySettingsPage

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx:573–584`

Reads from `useSecurityLatest` (security_events table):

```tsx
<SignalCard
  icon={<UserCheck className="h-6 w-6" />}
  value={
    securityData?.driver_seat_belt == null
      ? '—'
      : securityData.driver_seat_belt
        ? t('safety.buckled', 'Buckled')
        : t('safety.unbuckled', 'Unbuckled')
  }
  label={t('safety.driverBelt', 'Driver Belt')}
  positive={securityData?.driver_seat_belt ?? null}
/>
```

### 5b. AlertStudioPage (alert rule template)

**File:** `web/src/features/notifications/pages/AlertStudioPage.tsx:103`

Pre-built alert rule: "Driver Seatbelt Unbuckled" checks `DriverSeatBelt` with `is_false`
AND `Gear == 'D'`.

### 5c. DevToolsPage

**File:** `web/src/features/admin/pages/DevToolsPage.tsx:142`

Listed in Safety category for live signal debugging.

### 5d. signalCatalog.ts

**File:** `web/src/lib/signalCatalog.ts:194`

```ts
{ name: 'DriverSeatBelt', category: 'Safety', type: 'boolean',
  description: 'Driver seat belt unbuckled warning' }
```

Type is `'boolean'` (normalized meaning: latched=true). This is correct for alert
authoring — `RuleBuilder.tsx` uses `type === 'boolean'` to enable `is_true`/`is_false`
operators.

| Check | Result |
|-------|--------|
| Displayed on page(s) | SafetySettingsPage, AlertStudioPage, DevToolsPage ✅ |
| Display format | "Buckled"/"Unbuckled" (boolean to label) ✅ |
| Null handling | YES — `== null ? '—'` + `?? null` ✅ |
| Orphaned signal | **NO** — actively displayed ✅ |

---

## 6. Parity Check

Example: Tesla reports `DriverSeatBelt = "BuckleStatusUnlatched"` (unbuckled)

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `"BuckleStatusUnlatched"` | Enum string from Fleet Telemetry |
| After `parseBuckleStatus()` | `false` | Correct: not "Latched" |
| DB `security_events` | `false` (BOOLEAN) | Column `driver_seat_belt` ✅ |
| DB `vehicle_live_state` | `false` (BOOLEAN) | **Fixed** — was `true` via `ParseEnumBool` |
| SSE live state | `false` | **Fixed** — was `true` via `parseEnumBool` |
| API Response | `"driver_seat_belt": false` | JSON boolean ✅ |
| UI Display | **"Unbuckled"** | Correct label ✅ |

**Parity Status:** 🟢 **Match** (after fix) — was 🔴 **Mismatch** in `vehicle_live_state`
and SSE paths.

---

## 7. Adjacent Findings

### 7a. Alert engine `is_true`/`is_false` uses `toBool` (NOT FIXED)

**File:** `internal/api/rule_engine.go:340–343`

The rule engine's `is_true`/`is_false` operators use `toBool(current)`, which only returns
`true` for `"true"` or `"1"` strings. For `"BuckleStatusLatched"` and `"BuckleStatusUnlatched"`,
`toBool` returns `false` for BOTH. This means:
- `is_false` returns `true` for both latched AND unlatched
- The "Driver Seatbelt Unbuckled" alert template could fire even when buckled

This is a broader issue affecting all enum-typed signals used in alert rules. A fix would
require the rule engine to use signal-specific parsing, which is out of scope for this
signal audit.

### 7b. Same bug applies to `PassengerSeatBelt` (FIXED)

`PassengerSeatBelt` uses identical enum values and had the same `ParseEnumBool` bug in both
`live_state_repo.go` and `useVehicleLive.ts`. Fixed alongside `DriverSeatBelt`.

---

## 8. Fixes Applied

| # | Severity | File(s) | Description |
|---|----------|---------|-------------|
| 1 | **HIGH** | `internal/enums/parse.go` | Added `ParseBuckleStatus()` — converts `"BuckleStatusLatched"` → `true`, all else → `false` |
| 2 | **HIGH** | `internal/database/live_state_repo.go` | Removed `DriverSeatBelt`/`PassengerSeatBelt` from `enumBoolSignals`, added dedicated handling via `ParseBuckleStatus` |
| 3 | **HIGH** | `internal/database/live_state_repo.go` | Added `driver_seat_belt`/`passenger_seat_belt` to `LoadLiveState()` for restart recovery |
| 4 | **HIGH** | `web/src/lib/parseEnums.ts` | Added `parseBuckleStatus()` frontend equivalent |
| 5 | **HIGH** | `web/src/hooks/useVehicleLive.ts` | Changed seat belt parsing from `parseEnumBool` to `parseBuckleStatus` |

| # | Severity | Status | Description |
|---|----------|--------|-------------|
| 6 | **MEDIUM** | NOT FIXED | Alert engine `toBool` doesn't understand buckle enums (broader issue) |

---

## Summary

| Aspect | Status |
|--------|--------|
| Ingestion | ✅ Correct (`parseBuckleStatus` for security_events) |
| Storage — security_events | ✅ Correct |
| Storage — vehicle_live_state | 🔴→✅ **Fixed** (was using `ParseEnumBool`) |
| Storage — LoadLiveState recovery | 🔴→✅ **Fixed** (columns were missing) |
| Storage — signal_history | ✅ Correct (raw preservation) |
| API | ✅ Correct (snake_case JSON, no transform) |
| Frontend — useSecurityLatest | ✅ Correct (reads from security_events) |
| Frontend — useVehicleLive (SSE) | 🔴→✅ **Fixed** (was using `parseEnumBool`) |
| UI Display | ✅ Correct ("Buckled"/"Unbuckled", null-safe) |
| End-to-End Parity | 🟢 **Match** (after fix) |
