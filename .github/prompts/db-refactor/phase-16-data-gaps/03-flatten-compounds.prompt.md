---
description: "Phase-16 — Flatten Location compounds in writer + unpack Location in SnapshotAt reader"
---
# Prompt 03 — Flatten Location Compounds (Writer + Reader)
> **Severity:** Critical | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-03-flatten-compounds.log` |
| Allowed files to change | `internal/database/signal_history_writer.go`, `internal/database/signal_log_reader.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

### Writer side
`signal_history_writer.go` (~line 87-121) handles `map[string]interface{}` compound signals.
Currently, if the map has `"invalid": true` it skips; otherwise it JSON-marshals the entire
map into `value_jsonb`. This means **Location** compounds (which contain `latitude` and
`longitude` keys) are stored as opaque JSON blobs — downstream consumers expecting flat
`"Latitude"` and `"Longitude"` signal rows never see them.

### Reader side
`signal_log_reader.go` `SnapshotAt()` (~line 42-72) builds a `map[string]interface{}` by
scanning rows. For historical data where Location was stored as `value_jsonb`, the result map
contains `"Location" → {"latitude": 37.xx, "longitude": -122.xx}` instead of flat
`"Latitude" → 37.xx` and `"Longitude" → -122.xx`. Consumers like `completeDriveLocked()`
call `snapFloat(snap, "Latitude")` which silently returns false, leaving lat/lon null.

## Task

### 1. Writer — Flatten Location-type compounds ONLY

In the `Append()` method, when value is `map[string]interface{}`:

- **If the signal name is `"Location"`, `"OriginLocation"`, or `"DestinationLocation"`:**
  Extract `latitude` and `longitude` from the map. Write **two separate rows** to signal_log:
  - Signal `"Latitude"` (or `"OriginLatitude"` / `"DestinationLatitude"`) with `value_num = lat`
  - Signal `"Longitude"` (or `"OriginLongitude"` / `"DestinationLongitude"`) with `value_num = lon`
  Skip the original compound row entirely (don't also store the JSON blob).

- **For ALL other compound signals** (e.g., `"ChargingState"`, `"MediaInfo"`, etc.):
  Keep the existing behavior — JSON-marshal into `value_jsonb`.

Example mapping:
```
"Location"            → "Latitude" + "Longitude"
"OriginLocation"      → "OriginLatitude" + "OriginLongitude"
"DestinationLocation" → "DestinationLatitude" + "DestinationLongitude"
```

### 2. Reader — Unpack historical Location from value_jsonb

In `SnapshotAt()`, after building the result map from scanned rows, add a post-processing step:

```go
// Unpack historical Location compounds stored as value_jsonb
if locRaw, ok := result["Location"]; ok {
    if locMap, mapOk := locRaw.(map[string]interface{}); mapOk {
        if lat, latOk := locMap["latitude"]; latOk {
            if _, exists := result["Latitude"]; !exists {
                result["Latitude"] = lat
            }
        }
        if lon, lonOk := locMap["longitude"]; lonOk {
            if _, exists := result["Longitude"]; !exists {
                result["Longitude"] = lon
            }
        }
    }
}
```

Do the same for `"OriginLocation"` → `"OriginLatitude"` / `"OriginLongitude"` and
`"DestinationLocation"` → `"DestinationLatitude"` / `"DestinationLongitude"`.

Only set the flat key if it doesn't already exist (newer flattened rows take precedence).

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify Location flattening logic exists in writer:
Select-String -Path internal\database\signal_history_writer.go -Pattern "Location|OriginLocation|DestinationLocation"
# Should return matches for the flattening logic

# Verify Location unpacking exists in reader:
Select-String -Path internal\database\signal_log_reader.go -Pattern "Location.*latitude|Unpack|unpack"
# Should return matches
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/03-flatten-compounds: flatten Location→Lat/Lng in writer, unpack historical Location in SnapshotAt reader

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/03-flatten-compounds` as the commit message prefix.
