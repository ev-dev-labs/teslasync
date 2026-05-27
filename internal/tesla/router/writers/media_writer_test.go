package writers

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// newMediaTestWriter wires a snapshotWriter against the recording
// fake from snapshot_base_test.go (same package) using the production
// media columnFor. We deliberately build the snapshotWriter directly
// rather than going through NewMediaWriter because the public
// constructor takes a *pgxpool.Pool and the recorder is the smaller
// pgxPool interface — same seam pattern as climate_writer_test.go.
func newMediaTestWriter(t *testing.T, rec *recorder) *snapshotWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "media_snapshots", mediaColumnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter for media: %v", err)
	}
	return w
}

// TestMediaWriter_ColumnMapMatchesRoutingYAML is the reflective
// coverage gate from phase-42a prompt 0015 Decision #4. It walks
// router.LoadMap() (which parses the embedded routing.yaml), filters
// to entries with Destination == DestMediaSnapshot, and asserts the
// mediaColumnByField map in media_writer.go matches the routing
// layer entry-for-entry — same field set, same column for each field.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a media_snapshot route but media_writer.go
//     does not — Write would return "no column mapping for field" at
//     runtime, the test fails with "missing field".
//
//   - media_writer.go adds an entry that routing.yaml does not — the
//     entry is dead code, the test fails with "extra field".
//
//   - the column name in routing.yaml drifts from the column name in
//     media_writer.go — Write would target the wrong column at
//     runtime (or fail safeIdentRE), the test fails with mismatched
//     column.
func TestMediaWriter_ColumnMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]string{}
	for field, e := range m {
		if e.Destination == router.DestMediaSnapshot {
			expected[field] = e.Column
		}
	}

	if got, want := len(expected), 11; got != want {
		t.Errorf("routing.yaml has %d media_snapshot entries, expected %d "+
			"(prompt 0015 baseline; if the count legitimately changed update both this assertion and the writer map)",
			got, want)
	}

	if got, want := len(mediaColumnByField), len(expected); got != want {
		t.Errorf("mediaColumnByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, wantCol := range expected {
		gotCol, ok := mediaColumnByField[field]
		if !ok {
			t.Errorf("mediaColumnByField missing field %q (routing.yaml column=%q)",
				field, wantCol)
			continue
		}
		if gotCol != wantCol {
			t.Errorf("mediaColumnByField[%q] = %q, want %q (from routing.yaml)",
				field, gotCol, wantCol)
		}
	}
	for field, gotCol := range mediaColumnByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("mediaColumnByField has extra field %q=%q "+
				"(not declared in routing.yaml under dest: media_snapshot)",
				field, gotCol)
		}
	}
}

// TestMediaWriter_TypeMatrix exercises one positive write per kind
// from phase-42a prompt 0015 Decision #5 ("2 positive text +
// unknown-field"). The prompt's "2 positive text" floor reflects the
// fact that media_snapshots is mostly TEXT (6 of 11 columns); the
// other 5 are INTEGER (volume_pct/volume_max/volume_increment/
// duration_s/elapsed_s) which the codec emits as int64. We add an
// int64 case beyond the floor because covering both column kinds
// keeps the snapshotWriter SQL-composition coverage symmetric with
// climate_writer_test.go's matrix — the prompt floor is a minimum,
// not a ceiling.
//
// Each case asserts that the SQL contains the media_snapshots table
// identifier and the expected column identifier (both pgx.Identifier-
// quoted), that the bound $3 argument is the bare value (no
// coercion), and that exactly one Exec call was made.
func TestMediaWriter_TypeMatrix(t *testing.T) {
	const vin = "5YJ3E1EA0KF000042"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	cases := []struct {
		name    string
		field   string
		col     string
		val     any
		wantArg any
	}{
		{name: "text_MediaNowPlayingTitle", field: "MediaNowPlayingTitle", col: "track_name", val: "Bohemian Rhapsody", wantArg: "Bohemian Rhapsody"},
		{name: "text_MediaPlaybackStatus", field: "MediaPlaybackStatus", col: "play_status", val: "playing", wantArg: "playing"},
		{name: "int64_MediaAudioVolume", field: "MediaAudioVolume", col: "volume_pct", val: int64(75), wantArg: float64(75)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newMediaTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestMediaSnapshot,
				Column:      tc.col,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, "media_snapshots", tc.col)
			wantArgs := []any{vin, ts, tc.wantArg}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

// TestMediaWriter_UnknownFieldReturnsError covers phase-42a prompt
// 0015 Decision #5: a Field that is NOT routed to media_snapshot
// must produce a "no column mapping" error and MUST NOT touch the DB.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also implicitly
// guards against accidentally widening the media map to swallow
// non-media fields.
func TestMediaWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newMediaTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "VehicleSpeed",
		Value:     float64(60),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "VehicleSpeed",
		Destination: router.DestMediaSnapshot,
	})
	if err == nil {
		t.Fatal("expected error for unrouted field, got nil")
	}
	if !strings.Contains(err.Error(), "no column mapping for field") {
		t.Errorf("error does not mention missing mapping: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "VehicleSpeed") {
		t.Errorf("error does not name the offending field: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "media_snapshots") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestNewMediaWriter_NilPoolPanics locks the constructor's
// fail-fast contract from phase-42a prompt 0015 Decision #1. A nil
// pool is a wiring bug and panics so the failure surfaces at process
// start, not at the first payload.
func TestNewMediaWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewMediaWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewMediaWriter(nil)
}
