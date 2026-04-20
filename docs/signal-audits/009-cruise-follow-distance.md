# Signal Audit 009: CruiseFollowDistance

**Date:** 2026-04-20
**Auditor:** Copilot
**Risk Level:** HIGH
**Parity Status:** 🟢 Match (with 3 bugs fixed)

## Signal Identity

| Property | Value |
|----------|-------|
| Tesla Signal Name | `CruiseFollowDistance` |
| Proto Field | `ftproto.Field_CruiseFollowDistance` |
| Signal Type | `TypeEnum` (string) |
| Category | Safety |
| Raw Tesla Value | `FollowDistance1` through `FollowDistance7` |

## 1. Ingestion Layer

| Check | Result |
|-------|--------|
| Coercion function | `toString(v)` → `enums.ParseCruiseFollowDistance()` |
| Normalization in `normalizeFleetUnits()` | ✅ Line 1459–1460 of `telemetry_handler.go` |
| Defense-in-depth in `trackSafety()` | ✅ Line 2738–2740 of `telemetry_handler.go` |
| All enum values handled | ✅ `FollowDistance1`–`FollowDistance7` → `1`–`7` |
| Unknown values | Pass through unchanged |
| Potential data loss | NO |

**Parser:** `ParseCruiseFollowDistance` (parse.go:199) strips `FollowDistance` prefix via
`strings.TrimPrefix(raw, PrefixFollowDistance)`. Validates single digit 1–7.

## 2. Storage Layer

| Storage | Table | Column | Type |
|---------|-------|--------|------|
| Live state | `vehicle_live_state` | `cruise_follow_distance` | TEXT |
| Snapshot | `safety_snapshots` | `cruise_follow_distance` | TEXT |
| History | `signal_history` | `value_str` | TEXT |

| Check | Result |
|-------|--------|
| `signalToColumn` mapping | ✅ `"CruiseFollowDistance": "cruise_follow_distance"` (live_state_repo.go:257) |
| `safety_repo.go` Insert | ✅ Position $5 in INSERT (safety_repo.go:22) |
| `signal_history_writer.go` | ✅ String type routes to `value_str` column (line 76–79) |
| Migration 122 | ✅ Normalizes historical `FollowDistance*` prefixes in `safety_snapshots` |

## 3. API Layer

| Check | Result |
|-------|--------|
| Endpoints | `GET /safety/latest?vehicle_id=X`, `GET /safety?vehicle_id=X` |
| JSON field | `cruise_follow_distance` (snake_case) |
| Go type | `*string` (nullable) |
| Transformation | NONE — raw from DB |
| Handler | `SafetyHandler.Latest` / `SafetyHandler.List` (safety_handler.go) |

## 4. Frontend Hook Layer

| Check | Result |
|-------|--------|
| Hook | Inline `useQuery` in `SafetySettingsPage.tsx` (line 450–455) |
| Also available | `useSafety()` / `useSafetyHistory()` in `useVehicleSystems.ts` |
| TS field name | `cruise_follow_distance` (snake_case — no camelCase transform) |
| TS type | `string` (matches API) ✅ |

## 5. UI Display Layer

| Check | Result |
|-------|--------|
| Displayed on | `SafetySettingsPage.tsx` — feature card + history table |
| Card label | "Cruise Follow Distance" |
| Card value | Cleaned enum value (e.g., `"7"`) |
| Enabled logic | `Number(cfdVal) > 0` |
| Null handling | `snap.cruise_follow_distance ?? '0'` ✅ |
| `cleanEnum()` | Strips `FollowDistance` prefix for old data ✅ |

## 6. Parity Check

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | `FollowDistance7` | Enum from Fleet Telemetry |
| After Coercion | `7` | `ParseCruiseFollowDistance` strips prefix |
| DB Stored | `7` | TEXT in `safety_snapshots` and `vehicle_live_state` |
| API Response | `"7"` | JSON string in `cruise_follow_distance` |
| UI Display | `"7"` | Feature card shows `7`, enabled=true |

**Parity Status:** 🟢 Match — value flows correctly end-to-end after normalization.

## 7. Bugs Found & Fixed

### Bug A: Safety score excluded CruiseFollowDistance (FIXED)

**Severity:** Medium — safety score could never reach 100%

`boolFeatures()` had 8 entries but `TOTAL_FEATURES = 9`. CruiseFollowDistance was displayed
as a feature card but never counted in the safety score calculation.

**Fix:** Added `Number(cleanEnum(snap.cruise_follow_distance ?? '0', 'cruise_follow_distance')) > 0`
to the `boolFeatures()` array.

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

### Bug B: History table missing CruiseFollowDistance column (FIXED)

**Severity:** Low — historical changes were invisible for this signal

`buildHistoryColumns()` included FCW, LDA, SLW, ELDA but not CFD.

**Fix:** Added CFD column between ELDA and SLW in `buildHistoryColumns()`.

**File:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

### Bug C: Shared type had wrong field names and types (FIXED)

**Severity:** Medium — would cause runtime issues if hooks were used

`types/vehicle-systems.ts` defined `SafetySnapshot` with:
- camelCase field names (API returns snake_case)
- `cruiseFollowDistance: number` (should be `string | null`)
- Missing optional markers on nullable fields

**Fix:** Rewrote interface to match Go model's JSON tags exactly (snake_case, proper types).

**File:** `web/src/types/vehicle-systems.ts`

## Verification

- `npx tsc --noEmit` — ✅ 0 errors
- Signal normalization tested in `internal/enums/parse_test.go` — `TestParseCruiseFollowDistance`
- Migration 122 normalizes historical data in `safety_snapshots`
