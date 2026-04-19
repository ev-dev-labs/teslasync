---
description: "Signal audit: TpmsSoftWarnings — trace from Tesla telemetry to UI display"
---

# Signal Audit: TpmsSoftWarnings

## Signal Identity

| Property | Value |
|----------|-------|
| **Tesla Signal Name** | `TpmsSoftWarnings` |
| **Proto Field** | `ftproto.Field_TpmsSoftWarnings` |
| **Signal Type** | Compound (tire locations) (`TypeTireLocation`) |
| **Category** | Service / TPMS |
| **Risk Level** | HIGH |

## Audit Objective

Trace `TpmsSoftWarnings` through the **complete data lifecycle** — from raw Tesla Fleet
Telemetry ingestion to final UI display — and verify that the value the user sees
matches the ground truth from the vehicle.

## Audit Steps

### 1. Ingestion Layer
Search `internal/api/telemetry_handler.go` for how `TpmsSoftWarnings` is received and parsed.

- What coercion function is applied? (`toBool`, `toFloat`, `toString`, direct assignment)
- Is the raw value unwrapped from a `{"value": X}` envelope?
- For enum types: does the coercion correctly map ALL possible enum values?
- For compound types: are all sub-fields extracted correctly?

**Report:**
- [ ] Coercion function used: ___
- [ ] All enum values handled: YES / NO / N/A
- [ ] Potential data loss in coercion: YES / NO

### 2. Storage Layer
Search `internal/database/` for where `TpmsSoftWarnings` is stored.

- Which table(s)? (`vehicle_live_state`, `security_events`, `climate_snapshots`, `drive_telemetry`, `signal_history`, etc.)
- What is the DB column name and type? (`BOOLEAN`, `FLOAT8`, `TEXT`, etc.)
- Is the mapping in `live_state_repo.go` `signalToColumn` correct?
- Does `signal_history` store it as `value_num`, `value_str`, or `value_bool`?

**Report:**
- [ ] DB table: ___
- [ ] DB column: ___ (type: ___)
- [ ] live_state mapping exists: YES / NO
- [ ] signal_history stores as: value_num / value_str / value_bool

### 3. API Layer
Search `internal/api/` for how `TpmsSoftWarnings` is served to the frontend.

- Which API endpoint(s) return this value?
- What JSON field name is used? (check Go struct `json:` tags)
- Is the value transformed before sending? (unit conversion, formatting)

**Report:**
- [ ] API endpoint(s): ___
- [ ] JSON field name: ___
- [ ] Transformation applied: NONE / ___

### 4. Frontend Hook Layer
Search `web/src/api/hooks/` for which hook fetches this data.

- Which hook? (`useVehicles`, `useCharging`, `useTelemetry`, etc.)
- Does `camelCaseKeys()` transform the field name correctly?
- What TypeScript type is expected? Does it match the API response?

**Report:**
- [ ] Frontend hook: ___
- [ ] TS field name (after camelCase): ___
- [ ] TS type matches API: YES / NO

### 5. UI Display Layer
Search `web/src/features/` for where this signal is rendered to the user.

- Which page(s) display this value?
- What formatting is applied? (unit conversion, rounding, labels)
- For booleans/enums: what labels are shown? (e.g., "Locked"/"Unlocked", "ON"/"OFF")
- Is there an empty/null state handler?

**Report:**
- [ ] Displayed on page(s): ___
- [ ] Display format: ___
- [ ] Null handling: YES / NO
- [ ] If not displayed anywhere: mark as **Orphaned Signal**

### 6. Parity Check

Compare the raw Tesla value with what the user sees:

| Stage | Value | Notes |
|-------|-------|-------|
| Tesla Raw | ___ | What Tesla sends |
| After Coercion | ___ | After toBool/toFloat/toString |
| DB Stored | ___ | What's in Postgres |
| API Response | ___ | What the endpoint returns |
| UI Display | ___ | What the user sees |

**Parity Status:**
- 🟢 **Match** — value flows correctly end-to-end
- 🟡 **Rounding** — minor numeric precision difference
- 🔴 **Mismatch** — value is wrong, lost, or misinterpreted
- ⚪ **Orphaned** — signal ingested but never displayed

### 7. Fixes Required

If any issues are found, document them:
- [ ] Fix needed: YES / NO
- [ ] Description: ___
- [ ] File(s) to change: ___
- [ ] Suggested fix: ___

## Output

Save the completed audit as a structured report. The synthesis prompt will
aggregate all signal reports into the final traceability matrix.

## Files to Investigate

```
internal/enums/signal_types.go          — Signal type registry
internal/api/telemetry_handler.go       — Ingestion + coercion
internal/api/signals.go                 — Subscribed signal list
internal/database/live_state_repo.go    — Signal → DB column mapping
internal/database/signal_history_writer.go — Per-signal history storage
internal/database/security_repo.go      — Security event storage (if applicable)
internal/api/router.go                  — API endpoints
web/src/api/types.ts                    — Frontend type definitions
web/src/api/hooks/                      — Data fetching hooks
web/src/features/                       — UI pages and components
web/src/lib/signalCatalog.ts            — Signal metadata (if exists)
```
