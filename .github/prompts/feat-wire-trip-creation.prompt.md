---
description: "Wire automatic trip creation from completed drives and resolve router conflict"
---

# Feature: Wire Trip Creation from Completed Drives

## Problem

The Trips page (`/trips`) shows "No trips recorded yet" despite having 6 completed drives.
The `trips` table has 0 rows. The codebase has all the building blocks but they're not connected:

1. **`TripRepo.GenerateMonthlyTrips()`** — ready-to-use method that creates monthly trip
   aggregates from drives. Finds vehicle/month combos with drives but no trip, creates one,
   and links drives via `trip_drives`.
2. **`tripsvc.Service`** — domain service with `Create()` and FSM-based lifecycle.
3. **Maintenance worker** — runs every 24 hours, handles cleanup but NOT trip generation.
4. **Telemetry session tracker** — creates drives on state transitions but never creates trips.
5. **Router conflict** — legacy `tripHandler` registered at `/trips` (line 425), new v1
   handler commented out (line 714) with note: "conflicts with legacy tripHandler".

## Implementation Plan

### Step 1: Add `GenerateMonthlyTrips()` to the maintenance worker

**File:** `internal/worker/maintenance_worker.go`

Add trip generation to `runMaintenance()`, after partition management and before cleanup:

```go
// Generate monthly trip summaries from completed drives
tripRepo := database.NewTripRepo(db)
tripsCreated, err := tripRepo.GenerateMonthlyTrips(maintCtx)
if err != nil {
    log.Error().Err(err).Msg("trip generation failed")
} else if tripsCreated > 0 {
    log.Info().Int("trips_created", tripsCreated).Msg("monthly trips generated")
}
```

This runs every 24 hours and on startup (after 5-minute delay), catching up all historical
drives that don't have trips yet.

### Step 2: Call `upsertMonthTrip()` when a drive ends

**File:** `internal/api/telemetry_sessions.go`

After the drive is completed (line ~982, after "telemetry: drive ended" log), add:

```go
// Update monthly trip for this vehicle (creates if needed)
go func() {
    tripCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    tripRepo := database.NewTripRepo(t.db)
    now := time.Now().UTC()
    monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
    if _, err := tripRepo.UpsertMonthTrip(tripCtx, vehicleID, monthStart, true); err != nil {
        log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to update monthly trip")
    }
}()
```

**Note:** `upsertMonthTrip` is currently unexported (lowercase). Export it:
```go
// Rename: upsertMonthTrip → UpsertMonthTrip
func (r *TripRepo) UpsertMonthTrip(ctx context.Context, vehicleID int64, monthStart time.Time, inProgress bool) (int64, error) {
```

### Step 3: Inject TripRepo into the session tracker

**File:** `internal/api/telemetry_sessions.go`

Add `tripRepo *database.TripRepo` field to `TelemetrySessionTracker` struct and initialize
it in the constructor:

```go
type TelemetrySessionTracker struct {
    // ... existing fields ...
    tripRepo *database.TripRepo
}

// In NewTelemetrySessionTracker or equivalent init:
tracker.tripRepo = database.NewTripRepo(db)
```

### Step 4: Fix the router conflict

**File:** `internal/api/router.go`

The legacy `tripHandler` at line 425 queries the `trips` table directly — this is the
handler the frontend actually uses. The v1 handler at line 714 uses `tripsvc` (domain
service pattern with FSM). Both serve the same data.

**Option A (recommended — simple):** Keep the legacy handler. It works correctly once trips
exist in the database. Remove the commented-out v1 handler code to avoid confusion:
```go
// Remove lines 697-714 (the commented-out v1 trip handler setup)
```

**Option B (future):** Migrate to v1 handler by registering it on a non-conflicting path
like `/v2/trips` or replacing the legacy handler entirely.

### Step 5: Verify trip creation

```bash
# After rebuild + replay:
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
  SELECT id, vehicle_id, name, drive_count, total_distance_km, start_date, end_date
  FROM trips ORDER BY start_date;
"

# Should show at least 1 trip (current month) with drive_count > 0

docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
  SELECT trip_id, drive_id FROM trip_drives ORDER BY trip_id, drive_id;
"

# Should show drives linked to trips
```

## Files to Modify

| File | Change |
|------|--------|
| `internal/worker/maintenance_worker.go` | Add `GenerateMonthlyTrips()` call |
| `internal/api/telemetry_sessions.go` | Call `UpsertMonthTrip()` after drive ends |
| `internal/database/trip_repo.go` | Export `upsertMonthTrip` → `UpsertMonthTrip` |
| `internal/api/router.go` | Remove commented-out v1 trip handler (lines ~697-714) |

## Verification

```bash
cd /path/to/teslasync && go build ./...

# Verify no test regressions
go test ./internal/database/... -run Trip -v
go test ./internal/app/tripsvc/... -v

# After deploy + wait for maintenance run (or trigger manually):
curl -s http://localhost:8080/api/v1/trips | jq '.[] | {id, name, drive_count}'
```

**COMPLETION DEFINITION:**
- [ ] `GenerateMonthlyTrips()` called in maintenance worker (runs every 24h + on startup)
- [ ] `UpsertMonthTrip()` called when a drive ends in telemetry session tracker
- [ ] `upsertMonthTrip` exported as `UpsertMonthTrip`
- [ ] TripRepo injected into TelemetrySessionTracker
- [ ] Commented-out v1 trip handler removed from router
- [ ] `go build ./...` clean
- [ ] Trips page shows at least 1 trip after replay
- [ ] `trip_drives` table has drive linkages
