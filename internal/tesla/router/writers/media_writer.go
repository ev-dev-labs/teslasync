package writers

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// mediaColumnByField is the static field→column map for destination
// media_snapshot. Built at file-edit time from routing.yaml entries
// with `dest: media_snapshot` (11 routes — see the AUDIT_EVIDENCE
// section of phase-42a/0015's log for the verbatim extraction).
//
// Per phase-42a prompt 0012 Decision #3 (inherited by 0015) this map
// is a static var, NOT a runtime read of routing.yaml: the routing
// layer's loader already validated every entry at process start, the
// per-payload hot path must not re-parse a 1000-line YAML file, and
// a compile-time declaration here lets the reflective coverage test
// in media_writer_test.go catch any drift between routing.yaml and
// this file at CI time rather than at the first Write call.
//
// All routed Media* atomics are UnitKindNone per routing.yaml's
// preamble (lines 554-562) — volumes are integer percent already
// pre-scaled by the head unit and durations/positions are seconds
// (SI). normalize.toSI is a pass-through, so the snapshotWriter's
// four-scalar contract (float64, int64, bool, string) is sufficient
// without per-corner timestamp coercion (cf. tire_pressure_writer.go
// which needed a hybrid wrapper for TIMESTAMPTZ columns).
//
// New routes are added by:
//
//  1. appending the entry to routing.yaml under `dest: media_snapshot`,
//  2. adding (and verifying) the matching column in
//     migrations/000183_snapshots_si.up.sql,
//  3. adding the entry below in the same commit.
//
// The reflective coverage test will fail until step 3 lands, which is
// the intended check.
var mediaColumnByField = map[string]string{
	"MediaAudioVolume":          "volume_pct",
	"MediaAudioVolumeIncrement": "volume_increment",
	"MediaAudioVolumeMax":       "volume_max",
	"MediaNowPlayingAlbum":      "album",
	"MediaNowPlayingArtist":     "artist",
	"MediaNowPlayingDuration":   "duration_s",
	"MediaNowPlayingElapsed":    "elapsed_s",
	"MediaNowPlayingStation":    "station",
	"MediaNowPlayingTitle":      "track_name",
	"MediaPlaybackSource":       "source",
	"MediaPlaybackStatus":       "play_status",
}

// mediaColumnFor is the columnFor callback supplied to snapshotWriter
// per phase-42a prompt 0012 Decision #2 (inherited by 0015). Closes
// over mediaColumnByField so the snapshot helper has a single
// source-of-truth lookup; ok=false is returned for any field NOT
// routed here (the snapshot helper then errors out loudly per its
// drop-loud contract — see snapshot_base.go's columnFor godoc).
func mediaColumnFor(field string) (string, bool) {
	col, ok := mediaColumnByField[field]
	return col, ok
}

// NewMediaWriter constructs the production media snapshot writer.
// Returns the router.Writer for destination media_snapshot
// (constructor signature is locked by phase-42a prompt 0015 Decision #1).
//
// Composes the unexported snapshotWriter from snapshot_base.go: the
// table is "media_snapshots" (matches migration 000183 lines 273-288)
// and the columnFor callback is mediaColumnFor above. All 11 routed
// fields resolve to a column; the compile-time map plus the
// reflective coverage test together guarantee routing.yaml ↔ writer
// alignment.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewMotorWriter / NewTirePressureWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewMediaWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewMediaWriter: pool must be non-nil")
	}
	w, err := newSnapshotWriter(pool, "media_snapshots", mediaColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewMediaWriter: %v", err))
	}
	return w
}
