package media

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// fakeStateReader is a hand-rolled signal.StateReader for handler tests.
// Behavior is configured by setting one of stateFn / signalAtFn / timelineFn;
// the fake records the last opts and fields the handler passed to Timeline so
// tests can assert the wire-up without a real DB.
type fakeStateReader struct {
	stateFn    func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	signalAtFn func(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error)
	timelineFn func(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error)

	gotTimelineOpts   signal.TimelineOptions
	gotTimelineFields []signal.FieldMapping
	gotTimelineCalls  int
}

func (f *fakeStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *fakeStateReader) SignalAt(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error) {
	if f.signalAtFn == nil {
		return nil, nil
	}
	return f.signalAtFn(ctx, vehicleID, name, at)
}

func (f *fakeStateReader) Timeline(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error) {
	f.gotTimelineCalls++
	f.gotTimelineOpts = opts
	f.gotTimelineFields = fields
	if f.timelineFn == nil {
		return nil, nil
	}
	return f.timelineFn(ctx, vehicleID, fields, from, to, opts)
}

// Compile-time guarantee: fakeStateReader implements signal.StateReader.
var _ signal.StateReader = (*fakeStateReader)(nil)

// newTestLiveStateReader wraps a fakeStateReader as a signal.LiveStateReader
// suitable for /latest handler tests. The L1+L2 layer is a no-op, so the
// handler's LiveState() call falls through to the wrapped StateReader's
// State() — letting tests continue to drive responses via fake.stateFn the
// same way they did before the LiveStateReader boundary was introduced.
func newTestLiveStateReader(state signal.StateReader) signal.LiveStateReader {
	return signal.MustNewLiveStateReader(signal.NewNoopLiveSignalStore(), state)
}

// canonicalMediaKeys is the 11-key media response shape that BOTH List rows
// and Latest envelopes carry. Keep this list in sync with mediaMappings in
// handler.go.
var canonicalMediaKeys = []string{
	"playback_status",
	"now_playing_title",
	"now_playing_artist",
	"now_playing_album",
	"playback_source",
	"audio_volume",
	"audio_volume_max",
	"audio_volume_increment",
	"now_playing_station",
	"now_playing_duration",
	"now_playing_elapsed",
}

// TestMediaHandler_List_CollapsesIdentityTuple verifies that the handler
// asks the StateReader for collapse-by the 5-element media identity tuple
// (status/title/artist/album/source) AND faithfully forwards the
// (already-collapsed) row count to the JSON envelope. The fake represents
// the output of a real StateReader.Timeline that has already collapsed the
// 5 raw change-feed events into 3 distinct identity-tuple runs.
func TestMediaHandler_List_CollapsesIdentityTuple(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	collapsedRows := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"playback_status":   "playing",
			"now_playing_title": "Track A",
			"playback_source":   "Spotify",
		}},
		{Timestamp: t0.Add(2 * time.Minute), Fields: map[string]signal.SignalValue{
			"playback_status":   "playing",
			"now_playing_title": "Track B",
			"playback_source":   "Spotify",
		}},
		{Timestamp: t0.Add(5 * time.Minute), Fields: map[string]signal.SignalValue{
			"playback_status":   "paused",
			"now_playing_title": "Track B",
			"playback_source":   "Spotify",
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return collapsedRows, nil
		},
	}
	h := NewMediaHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/media?vehicle_id=42", nil)
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	wantCollapse := []string{
		"playback_status",
		"now_playing_title",
		"now_playing_artist",
		"now_playing_album",
		"playback_source",
	}
	if !reflect.DeepEqual(fake.gotTimelineOpts.CollapseBy, wantCollapse) {
		t.Fatalf("Timeline opts.CollapseBy = %v, want %v", fake.gotTimelineOpts.CollapseBy, wantCollapse)
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 3 {
		t.Fatalf("response row count = %d, want 3 (collapsed); rows=%v", len(got), got)
	}
}

// TestMediaHandler_List_PreservesSpotifyAcrossUnchangedSignals proves the
// regression fix: in the old (raw-pivot) implementation, a row that had no
// MediaPlaybackSource emission inside its second-bucket would render with
// playback_source missing, causing the UI to display "—" or drop the
// Spotify badge — even though the source had not actually changed. With
// forward-folding, every row carries the most recently observed source, so
// once Spotify is seeded it stays present until something changes it.
func TestMediaHandler_List_PreservesSpotifyAcrossUnchangedSignals(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	rows := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"playback_status":   "playing",
			"now_playing_title": "Track A",
			"playback_source":   "Spotify",
		}},
		{Timestamp: t0.Add(time.Minute), Fields: map[string]signal.SignalValue{
			"playback_status":   "playing",
			"now_playing_title": "Track B",
			"playback_source":   "Spotify",
		}},
		{Timestamp: t0.Add(2 * time.Minute), Fields: map[string]signal.SignalValue{
			"playback_status":   "playing",
			"now_playing_title": "Track C",
			"playback_source":   "Spotify",
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return rows, nil
		},
	}
	h := NewMediaHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/media?vehicle_id=42", nil)
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(rows) {
		t.Fatalf("response row count = %d, want %d", len(got), len(rows))
	}
	for i, row := range got {
		v, ok := row["playback_source"]
		if !ok {
			t.Fatalf("row %d missing playback_source key; row=%v", i, row)
		}
		if v != "Spotify" {
			t.Fatalf("row %d playback_source = %#v, want \"Spotify\"", i, v)
		}
	}
}

// TestMediaHandler_Latest_ProjectsThroughMappings checks that every signal
// key in mediaMappings.Signal lands under its mapped Field key in the JSON
// envelope, with the same value.
func TestMediaHandler_Latest_ProjectsThroughMappings(t *testing.T) {
	full := signal.State{
		"MediaPlaybackStatus":       "playing",
		"MediaNowPlayingTitle":      "Track A",
		"MediaNowPlayingArtist":     "Artist X",
		"MediaNowPlayingAlbum":      "Album Z",
		"MediaPlaybackSource":       "Spotify",
		"MediaAudioVolume":          7.5,
		"MediaAudioVolumeMax":       10.0,
		"MediaAudioVolumeIncrement": 0.5,
		"MediaNowPlayingStation":    "—",
		"MediaNowPlayingDuration":   240.0,
		"MediaNowPlayingElapsed":    87.0,
	}
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return full, nil
		},
	}
	h := NewMediaHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/media/latest?vehicle_id=42", nil)
	h.Latest(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	for _, key := range canonicalMediaKeys {
		if _, ok := got[key]; !ok {
			t.Fatalf("response missing canonical key %q; got=%v", key, got)
		}
	}
	if got["playback_status"] != "playing" {
		t.Fatalf("playback_status = %#v, want \"playing\"", got["playback_status"])
	}
	if got["now_playing_title"] != "Track A" {
		t.Fatalf("now_playing_title = %#v, want \"Track A\"", got["now_playing_title"])
	}
	if got["playback_source"] != "Spotify" {
		t.Fatalf("playback_source = %#v, want \"Spotify\"", got["playback_source"])
	}
}

// TestMediaHandler_List_RejectsZeroVehicleID verifies the input-validation
// guard: missing or zero vehicle_id is a 400, never a passthrough to the
// reader. The fake records call counts to prove the reader was NOT called.
func TestMediaHandler_List_RejectsZeroVehicleID(t *testing.T) {
	fake := &fakeStateReader{}
	h := NewMediaHandler(fake, newTestLiveStateReader(fake))

	cases := []struct{ name, url string }{
		{"missing", "/media"},
		{"zero", "/media?vehicle_id=0"},
		{"non_numeric", "/media?vehicle_id=abc"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			h.List(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
	if fake.gotTimelineCalls != 0 {
		t.Fatalf("Timeline call count = %d, want 0 (handler must reject before calling reader)", fake.gotTimelineCalls)
	}
}

// TestMediaHandler_List_PropagatesTimelineError verifies that a Timeline
// transport error becomes a generic 500 to the client (never a 200 with a
// nil body).
func TestMediaHandler_List_PropagatesTimelineError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, wantErr
		},
	}
	h := NewMediaHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/media?vehicle_id=42", nil)
	h.List(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestMediaHandler_Latest_EmptyStateReturnsCanonicalShape locks in the
// empty-state contract: a fresh-import vehicle with no signal_log rows
// returns HTTP 200 with the canonical 11-key envelope, every value nil.
// Returning {} or absent keys would crash the existing UI, which assumes
// the keys are always present.
func TestMediaHandler_Latest_EmptyStateReturnsCanonicalShape(t *testing.T) {
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return signal.State{}, nil
		},
	}
	h := NewMediaHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/media/latest?vehicle_id=42", nil)
	h.Latest(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (empty-state must NOT 404/500); body=%s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(canonicalMediaKeys) {
		t.Fatalf("response key count = %d, want %d (canonical media shape); got=%v", len(got), len(canonicalMediaKeys), got)
	}
	for _, key := range canonicalMediaKeys {
		v, ok := got[key]
		if !ok {
			t.Fatalf("response missing canonical key %q; got=%v", key, got)
		}
		if v != nil {
			t.Fatalf("response[%q] = %#v, want nil (empty-state contract)", key, v)
		}
	}
}
