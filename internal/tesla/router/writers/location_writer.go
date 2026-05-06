package writers

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// locationColumnByField is the static field→column map for destination
// location_snapshot. As of phase-42a prompt 0017, routing.yaml has
// ZERO entries with `dest: location_snapshot` — the location_snapshots
// table (migration 000183 lines 343-351) is populated exclusively by
// the asynchronous geocoding worker on its own write path, NOT by any
// telemetry atomic flowing through the normalize.Pipeline.
//
// The map is therefore intentionally empty. The writer is authored
// anyway per phase-42a prompt 0017 Decision #3 so the router
// constructor in 0050's MQTT cutover can wire one writer per
// Destination const without a "no writer for destination
// location_snapshot" panic the moment a future routing.yaml entry
// adds a location_snapshot route.
//
// The location_snapshots schema declares four nullable non-PK columns:
//
//   - place       TEXT         (geocoded place label)
//   - country     TEXT         (ISO 3166-1 alpha-2)
//   - region      TEXT         (administrative region)
//   - geocoded_at TIMESTAMPTZ  (wall-clock of geocoder lookup)
//
// New routes are added by:
//
//  1. appending the entry to routing.yaml under `dest: location_snapshot`,
//  2. confirming (no migration needed) the matching column exists in
//     migrations/000183_snapshots_si.up.sql,
//  3. adding the entry below in the same commit.
//
// **Forward-compatibility caveat (TIMESTAMPTZ):** the snapshotWriter
// helper's bindSnapshotValue (snapshot_base.go lines 194-209) accepts
// only float64 / int64 / bool / string and rejects time.Time. If a
// future routing entry maps a Field to the `geocoded_at` column, the
// writer cannot stay a pure snapshotWriter composition — it must adopt
// the hybrid wrapper pattern from tire_pressure_writer.go, which
// dispatches TIMESTAMPTZ-bound fields to an in-file writeTimestamp
// helper. Routing only the three TEXT columns (place, country, region)
// stays inside the snapshotWriter happy path and only requires
// appending entries to locationColumnByField below.
//
// The reflective coverage test will fail until step 3 lands, which is
// the intended check.
var locationColumnByField = map[string]string{}

// locationColumnFor is the columnFor callback supplied to snapshotWriter
// per phase-42a prompt 0012 Decision #2 (inherited by 0017). Closes
// over locationColumnByField; with the map empty today, ok=false is
// returned for every field — the snapshot helper then errors out
// loudly per its drop-loud contract (snapshot_base.go's columnFor
// godoc). This is the desired behaviour: until routing.yaml declares
// a location_snapshot route, the writer is reachable but has no work
// to do, and any atomic that mistakenly arrives at this destination
// surfaces as a writer_failures_total{dest="location_snapshot"}
// increment rather than a silent drop.
func locationColumnFor(field string) (string, bool) {
	col, ok := locationColumnByField[field]
	return col, ok
}

// NewLocationWriter constructs the production location snapshot writer.
// Returns the router.Writer for destination location_snapshot
// (constructor signature is locked by phase-42a prompt 0017 Decision #1).
//
// Composes the unexported snapshotWriter from snapshot_base.go: the
// table is "location_snapshots" (matches migration 000183 lines 343-351)
// and the columnFor callback is locationColumnFor above. With the
// map empty today, the writer satisfies the router.Writer interface
// and returns a "no column mapping for field" error for any Write
// call; the compile-time map plus the reflective coverage test
// together guarantee routing.yaml ↔ writer alignment whenever a
// future routing entry lands.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewMotorWriter / NewMediaWriter /
// NewTirePressureWriter / NewSafetyWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewLocationWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewLocationWriter: pool must be non-nil")
	}
	w, err := newSnapshotWriter(pool, "location_snapshots", locationColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewLocationWriter: %v", err))
	}
	return w
}
