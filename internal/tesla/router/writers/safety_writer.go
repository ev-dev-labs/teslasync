package writers

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// safetyColumnByField is the static field→column map for destination
// safety_snapshot. It mirrors routing.yaml entries with
// `dest: safety_snapshot`.
//
// This map is a static var, NOT a runtime read of routing.yaml: the routing
// layer's loader already validated every entry at process start, the
// per-payload hot path must not re-parse a 1000-line YAML file, and
// a compile-time declaration here lets the reflective coverage test
// in safety_writer_test.go catch any drift between routing.yaml and
// this file at CI time rather than at the first Write call.
//
// Today's single route is ServiceMode → service_mode (BOOLEAN). The
// safety_snapshots table (migration 000183 lines 309-317) declares
// four nullable scalar columns (service_mode, service_mode_plus,
// wiper_state, crash_state); only service_mode is routed at the
// moment. The other three columns are reserved for future routing
// additions without a schema migration — adding a new entry here is
// a one-line change once the corresponding routing.yaml line lands.
//
// New routes are added by:
//
//  1. appending the entry to routing.yaml under `dest: safety_snapshot`,
//  2. confirming (no migration needed) the matching column exists in
//     migrations/000183_snapshots_si.up.sql,
//  3. adding the entry below in the same commit.
//
// The reflective coverage test will fail until step 3 lands, which is
// the intended check.
var safetyColumnByField = map[string]string{
	"ServiceMode": "service_mode",
}

// safetyColumnFor is the columnFor callback supplied to snapshotWriter.
// It closes over safetyColumnByField so the snapshot helper has a single
// source-of-truth lookup; ok=false is returned for any field NOT
// routed here (the snapshot helper then errors out loudly per its
// drop-loud contract — see snapshot_base.go's columnFor godoc).
func safetyColumnFor(field string) (string, bool) {
	col, ok := safetyColumnByField[field]
	return col, ok
}

// NewSafetyWriter constructs the production safety snapshot writer for
// destination safety_snapshot.
//
// Composes the unexported snapshotWriter from snapshot_base.go: the
// table is "safety_snapshots" (matches migration 000183 lines 309-317)
// and the columnFor callback is safetyColumnFor above. The single
// routed field resolves to a column; the compile-time map plus the
// reflective coverage test together guarantee routing.yaml ↔ writer
// alignment, and the writer is authored to handle the full column
// set so a future routing.yaml addition (service_mode_plus,
// wiper_state, crash_state — all already declared in the schema)
// Just Works after a one-line map update.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewMotorWriter / NewMediaWriter /
// NewTirePressureWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewSafetyWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewSafetyWriter: pool must be non-nil")
	}
	w, err := newSnapshotWriter(pool, "safety_snapshots", safetyColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewSafetyWriter: %v", err))
	}
	return w
}
