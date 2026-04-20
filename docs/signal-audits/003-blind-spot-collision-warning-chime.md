# Signal Audit: BlindSpotCollisionWarningChime

**Date:** 2026-04-20 (re-verified)
**Status:** 🟢 MATCH — all fixes applied and verified

## Signal Identity

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `BlindSpotCollisionWarningChime` |
| **Proto Field** | `ftproto.Field_BlindSpotCollisionWarningChime` |
| **Signal Type** | Boolean (`TypeBool`) |
| **Category** | Safety |
| **Risk Level** | LOW |

---

## 1. Ingestion Layer

**File:** `internal/api/telemetry_handler.go:2629-2631`

| Check | Result |
|-------|--------|
| Coercion function used | ~~`toString(v)`~~ → **`toBool(v)`** (fixed) |
| All enum values handled | N/A (boolean signal) |
| Potential data loss in coercion | **YES — was present, now fixed** |

**Bug found:** The handler used `toString(v)` on a `TypeBool` signal, converting
`true` → `"true"` and `false` → `"false"` (strings). This was then stored in
`snap.BlindSpotCollisionWarning` as `*string`.

**Root cause:** Migration 000037 batch-converted several safety columns from BOOLEAN to
VARCHAR(100) to accommodate enum signals (`forward_collision_warning`,
`lane_departure_avoidance`). `blind_spot_collision_warning` was incorrectly included
in that batch — it is a true boolean, not an enum.

**Fix:** Changed to `toBool(v)` and store as `*bool`.

---

## 2. Storage Layer

### 2a. safety_snapshots table

| Check | Result |
|-------|--------|
| DB table | `safety_snapshots` |
| DB column | `blind_spot_collision_warning` |
| Column type | ~~VARCHAR(100)~~ → **BOOLEAN** (migration 000121) |
| Go model type | ~~`*string`~~ → **`*bool`** (fixed) |

**Migration chain:**
- 000017: Created as `VARCHAR(100)` (original schema)
- (internal/database/migrations/000017 had BOOLEAN, but that's the unused path)
- 000037: Kept as VARCHAR(100) (incorrectly included in enum batch conversion)
- **000121: Converts back to BOOLEAN** (this fix)

### 2b. vehicle_live_state table

| Check | Result |
|-------|--------|
| DB column | `blind_spot_collision_warning_chime` (BOOLEAN) |
| live_state mapping | ✅ `signalToColumn["BlindSpotCollisionWarningChime"] = "blind_spot_collision_warning_chime"` |
| Status | **Correct — no fix needed** |

### 2c. signal_history table

| Check | Result |
|-------|--------|
| Storage column | `value_bool` (raw value is `bool` type) |
| Status | **Correct — no fix needed** |

---

## 3. API Layer

**Endpoint:** `GET /api/v1/safety/latest?vehicle_id={id}`
**Endpoint:** `GET /api/v1/safety?vehicle_id={id}&limit={n}`
**Handler:** `internal/api/safety_handler.go`

| Check | Result |
|-------|--------|
| JSON field name | `blind_spot_collision_warning` |
| Response type | ~~string (`"true"/"false"`)~~ → **boolean** (fixed) |
| Transformation | None (direct serialization from model) |

---

## 4. Frontend Hook Layer

**Hook:** Inline `useQuery` in `SafetySettingsPage.tsx:429-434`
**Also available:** `useSafety()` / `useSafetyHistory()` in `api/hooks/useVehicleSystems.ts:85-99` (unused by page)

| Check | Result |
|-------|--------|
| TS field name | `blind_spot_collision_warning` |
| TS type | `boolean` (in `api/types.ts:1262`) |
| TS type matches API | ✅ YES (after fix) |

---

## 5. UI Display Layer

**Page:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`

| Location | Usage | Impact of Bug |
|----------|-------|---------------|
| Feature card (line 289) | `enabled: snap.blind_spot_collision_warning ?? false` | `"false"` (string) is truthy → always shows "Enabled" |
| Feature card (line 290) | `valueText: (snap.blind_spot_collision_warning ?? false) ? t('Enabled') : t('Disabled')` | Same — shows "Enabled" even when disabled |
| Chart data (line 214) | `bscw: (s.blind_spot_collision_warning ?? false) ? 1 : 0` | Chart shows 1 (on) even when off |
| History table (line 337) | `boolCell(row.blind_spot_collision_warning ?? false)` | Badge shows "On" even when off |
| Bool features score (line 86) | `snap.blind_spot_collision_warning ?? false` | Inflates safety score |

**Null handling:** ✅ Yes — `?? false` fallback throughout

---

## 6. Parity Check

### Before Fix

| Stage | Value (true) | Value (false) | Notes |
|-------|-------------|---------------|-------|
| Tesla Raw | `true` (bool) | `false` (bool) | Confirmed in signal-history-snapshot |
| After Coercion | `"true"` (string) | `"false"` (string) | `toString()` on bool |
| DB Stored | `"true"` (VARCHAR) | `"false"` (VARCHAR) | safety_snapshots |
| API Response | `"true"` (string) | `"false"` (string) | JSON string, not boolean |
| UI Display | "Enabled" ✅ | "Enabled" ❌ | JS truthy: `"false"` is truthy |

**Pre-fix parity:** 🔴 **MISMATCH** — `false` values display as "Enabled"

### After Fix

| Stage | Value (true) | Value (false) | Notes |
|-------|-------------|---------------|-------|
| Tesla Raw | `true` (bool) | `false` (bool) | |
| After Coercion | `true` (bool) | `false` (bool) | `toBool()` |
| DB Stored | `true` (BOOLEAN) | `false` (BOOLEAN) | migration 000121 |
| API Response | `true` (boolean) | `false` (boolean) | JSON boolean |
| UI Display | "Enabled" ✅ | "Disabled" ✅ | Correct |

**Post-fix parity:** 🟢 **MATCH**

---

## 7. Fixes Applied

| # | File | Change |
|---|------|--------|
| 1 | `internal/api/telemetry_handler.go:2629-2631` | `toString(v)` → `toBool(v)`, `*string` → `*bool` |
| 2 | `internal/models/models.go:1057` | `BlindSpotCollisionWarning *string` → `*bool` |
| 3 | `migrations/000121_fix_blind_spot_collision_warning_type.up.sql` | VARCHAR(100) → BOOLEAN with safe backfill |
| 4 | `migrations/000121_fix_blind_spot_collision_warning_type.down.sql` | Revert migration |

**No frontend changes required** — TypeScript types and page logic already expect `boolean`.

---

## Adjacent Findings

### Orphaned hooks
`useSafety()` and `useSafetyHistory()` in `api/hooks/useVehicleSystems.ts:85-99` are
defined but not used by `SafetySettingsPage.tsx`, which uses inline `useQuery` calls instead.

### Duplicate SafetySnapshot interfaces
Three separate `SafetySnapshot` interface definitions exist:
1. `web/src/api/types.ts:1257` — canonical, optional fields
2. `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx:42` — local, non-optional
3. Potentially in `@/types/vehicle-systems.ts` (referenced by hooks)
