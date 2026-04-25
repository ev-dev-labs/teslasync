---
description: "Phase-16 — Charge completion audit: fix all null fields using ACTUAL schema"
---
# Prompt 05 — Charge Completion Audit
> **Severity:** Critical | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-05-charge-completion-audit.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 03 (Location flattening must land first)

## Problem

`completeChargeLocked()` (~line 2084) writes to `enhancedFields` that reference columns
which **do not exist** in `charging_sessions`, and fails to populate columns that **do exist**.

### ACTUAL charging_sessions schema (verified):
```sql
end_ts              timestamptz
duration_min        double precision
start_battery_pct   smallint
end_battery_pct     smallint
energy_added_kwh    double precision
miles_added         double precision
charger_type        text
charger_location    text          -- geocoded name of charging location
charger_power_kw_max double precision
charger_power_kw_avg double precision
cost                numeric(10,4)
cost_currency       text
ended_status        text          -- 'completed','interrupted','user_stopped','full','unknown'
```

### Columns that DO NOT EXIST (code writes to them — these silently fail via PartialUpdate):
- `latitude` — NOT a column (used only for geocoding, must not be written to table)
- `longitude` — NOT a column (used only for geocoding, must not be written to table)
- `inside_temp_avg_c` — NOT a column
- `outside_temp_avg_c` — NOT a column
- `charge_energy_used` — NOT a column
- `inside_temp_avg` — NOT a column
- `outside_temp_avg` — NOT a column
- `location_name` — NOT a column (should be `charger_location`)

### Columns that ARE NEVER populated:
- **`charger_location`** — geocoding writes to `location_name` (wrong column name!)
- **`cost_currency`** — never set
- **`ended_status`** — never set

## Task

### 1. Survey — Trace every column

In the log under `=== SURVEY ===`, list every column in `charging_sessions` and trace which
line of code populates it. Flag columns with no write path and columns written to wrong names.

### 2. Remove writes to non-existent columns

In the `enhancedFields` map building (~lines 2156-2161):
- **Remove** `"latitude"`, `"longitude"` from `enhancedFields` (keep the variables for geocoding logic, just don't add them to the map that gets written to the DB)
- **Remove** `"inside_temp_avg"` / `"inside_temp_avg_c"` / `"outside_temp_avg"` / `"outside_temp_avg_c"` from `enhancedFields`
- **Remove** `"charge_energy_used"` from `enhancedFields`

### 3. Fix geocoding column name

In the async geocoding goroutine (~lines 2354-2389), change all occurrences of
`fields["location_name"]` to `fields["charger_location"]`:

```go
// Before:
fields["location_name"] = geofences[0].Name
// After:
fields["charger_location"] = geofences[0].Name
```

### 4. Add `ended_status`

Set `ended_status` based on how the charge ended:

- If `endBattery >= 95` → `"full"` (battery effectively full)
- If charge ended by user action (FSM signal `ChargeEnableRequest = false`) → `"user_stopped"`
- If charge ended by stale-session cleanup (signals is nil) → `"interrupted"`
- If charge ended normally (signals != nil, normal FSM transition) → `"completed"`
- Default → `"unknown"`

Add to `enhancedFields["ended_status"]`.

### 5. Add `cost_currency`

When cost is calculated from geofence electricity rate, also set the currency:

```go
if geofence.ElectricityCurrency != "" {
    enhancedFields["cost_currency"] = geofence.ElectricityCurrency
} else {
    enhancedFields["cost_currency"] = "USD" // default
}
```

If the geofence model doesn't have a currency field, hardcode `"USD"` for now and add a
TODO comment referencing a future geofence enhancement.

### 6. Audit orphan closure

The orphan-closure UPDATE at ~line 819 only sets `end_ts` and `duration_min`. Add `ended_status`:

```sql
UPDATE charging_sessions SET end_ts = $1,
  duration_min = EXTRACT(EPOCH FROM ($1 - start_ts))/60,
  ended_status = 'interrupted'
WHERE end_ts IS NULL AND start_ts < $2
```

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify no writes to non-existent columns:
Select-String -Path internal\api\telemetry_sessions.go -Pattern '"latitude"|"longitude"|"inside_temp_avg"|"outside_temp_avg"|"charge_energy_used"|"location_name"'
# Should return 0 matches

# Verify charger_location is used:
Select-String -Path internal\api\telemetry_sessions.go -Pattern '"charger_location"'
# Should return at least 1 match

# Verify ended_status is set:
Select-String -Path internal\api\telemetry_sessions.go -Pattern '"ended_status".*charge'
# Or just:
$matches = Select-String -Path internal\api\telemetry_sessions.go -Pattern 'ended_status'
"ended_status refs: $($matches.Count)" # Should be >= 3 (drive + charge + orphan closures)
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/05-charge-completion-audit: fix schema mismatch, add ended_status + cost_currency + charger_location

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/05-charge-completion-audit` as the commit message prefix.
