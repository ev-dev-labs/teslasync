package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// newLocationRequest builds an *http.Request for the /location handlers
// with vehicle_id pre-encoded.
func newLocationRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/location?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestLocationSnapshot_History_ChartMode is the wire-up + chart-mode
// proof for the phase-39 location-snapshot-handler migration.
//
// The location history view drives the dashboard's GPS trail / route
// chart, where every emission of Latitude / Longitude / GpsHeading /
// Elevation is a discrete data point on the time axis. This test
// asserts:
//
//  1. The handler invokes Timeline exactly once with the full
//     locationMappings field projection.
//  2. The handler asks for CHART MODE (empty CollapseBy) so every
//     change-feed emission becomes one row. A non-empty CollapseBy
//     would coalesce consecutive identical-coordinate rows (a parked
//     car sampling its lat/lon every minute would render as ONE point
//     instead of N) and break the GPS-trail chart's per-emission
//     resolution.
//  3. The handler does NOT strip, drop, or filter rows that carry
//     forward-folded values — every TimelineRow becomes one response
//     row with the legacy created_at / id aliases preserved.
//  4. Forward-folded latitude / longitude / heading values appear on
//     every row even when they did not re-emit in that bucket — a
//     stationary or slowly-moving vehicle must still produce a
//     fully-populated trail, never NULL coordinates.
func TestLocationSnapshot_History_ChartMode(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"latitude":    37.7749,
			"longitude":   -122.4194,
			"heading":     90.0,
			"elevation_m": 16.0,
			"speed_mph":   0.0,
			"gps_state":   "Stopped",
		}},
		{Timestamp: t0.Add(60 * time.Second), Fields: map[string]signal.SignalValue{
			"latitude":    37.7749,
			"longitude":   -122.4194,
			"heading":     90.0,
			"elevation_m": 16.0,
			"speed_mph":   0.0,
			"gps_state":   "Stopped",
		}},
		{Timestamp: t0.Add(120 * time.Second), Fields: map[string]signal.SignalValue{
			"latitude":    37.7749,
			"longitude":   -122.4194,
			"heading":     90.0,
			"elevation_m": 16.0,
			"speed_mph":   0.0,
			"gps_state":   "Stopped",
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewLocationSnapshotHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newLocationRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes
	// one row. A non-empty CollapseBy would collapse identical
	// "still-here" runs into a single row and break the GPS-trail
	// chart's per-emission resolution.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(locationMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(locationMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	for i, row := range got {
		// Every row must carry the forward-folded coordinates; under
		// the old raw-pivot impl, only the row with a fresh emission
		// would have these populated, leaving the rest as NULL — which
		// would render the GPS trail with gaps even though the car was
		// continuously emitting state.
		lat, ok := row["latitude"].(float64)
		if !ok || lat != 37.7749 {
			t.Fatalf("row[%d].latitude = %#v, want 37.7749 (forward-folded carry-forward)", i, row["latitude"])
		}
		lon, ok := row["longitude"].(float64)
		if !ok || lon != -122.4194 {
			t.Fatalf("row[%d].longitude = %#v, want -122.4194 (forward-folded carry-forward)", i, row["longitude"])
		}
		hd, ok := row["heading"].(float64)
		if !ok || hd != 90.0 {
			t.Fatalf("row[%d].heading = %#v, want 90.0 (forward-folded carry-forward)", i, row["heading"])
		}
		// Legacy field-name aliases must be present so the existing
		// frontend consuming created_at / id keeps working.
		if _, ok := row["created_at"]; !ok {
			t.Fatalf("row[%d] missing created_at alias; row=%v", i, row)
		}
		idVal, ok := row["id"].(float64)
		if !ok || int(idVal) != i+1 {
			t.Fatalf("row[%d].id = %#v, want %d", i, row["id"], i+1)
		}
	}
}

// TestLocationSnapshot_Latest_ReturnsParkedPosition is the carry-forward
// proof for the location-snapshot Latest endpoint.
//
// A parked Tesla emits Latitude / Longitude / Elevation / GpsHeading
// once when it parks and then NEVER re-emits those fields until it
// moves again. Under the legacy raw-pivot SnapshotAt, a /location/latest
// call against a vehicle that has been parked for HOURS would project
// NULL for lat / lon / heading / elevation, even though those values
// are perfectly known and stable. With StateReader.State forward-folding
// the change feed, the most recent emission of every signal is carried
// forward to the requested timestamp.
//
// This test:
//
//  1. Confirms Latest invokes State at ≈ time.Now() (NOT a rolling
//     window or session-anchored timestamp), with the supplied
//     vehicle_id.
//  2. Simulates a State response that contains stable lat/lon/elevation
//     /heading values forward-folded from a parked-at-park emission
//     hours ago.
//  3. Asserts the response contains every projected field under its
//     mapped JSON name — never blanks them. A blank lat/lon would
//     render the dashboard map pin as missing.
//  4. Verifies that compound-unpacked destination/origin coordinates
//     (DestinationLatitude / DestinationLongitude / OriginLatitude /
//     OriginLongitude — produced by the StateReader implementation
//     unpacking Tesla's Location compound, per Prompt 05) project
//     under their mapped Field names if present.
//  5. Confirms unmapped raw signal names do NOT leak into the
//     response — only the projected Field names.
func TestLocationSnapshot_Latest_ReturnsParkedPosition(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				// Stable parked coordinates forward-folded from an
				// emission hours ago — the canonical reason this
				// migration matters.
				"Latitude":    37.7749,
				"Longitude":   -122.4194,
				"GpsHeading":  90.0,
				"Elevation":   16.0,
				"GpsState":    "Stopped",
				"VehicleSpeed": 0.0,
				// Compound-unpacked destination coordinates (Prompt 05
				// unpacks Tesla's Location compound into these scalars).
				"DestinationLatitude":  40.7128,
				"DestinationLongitude": -74.0060,
				"DestinationName":      "New York, NY",
				// Presence flags are user-pinned home / work / favorite
				// classifications that emit rarely; they MUST carry
				// forward (a parked-at-home car's "located_at_home"
				// must not blank).
				"LocatedAtHome":     true,
				"LocatedAtWork":     false,
				"LocatedAtFavorite": false,
				// HomelinkNearby intentionally absent to confirm Latest
				// omits unmapped-but-known signals; OriginLatitude /
				// OriginLongitude / MilesToArrival / MinutesToArrival /
				// RouteTrafficMinutesDelay / RouteLastUpdated also
				// intentionally absent.
			}, nil
		},
	}
	h := NewLocationSnapshotHandler(fake, newTestLiveStateReader(fake))

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newLocationRequest("42", "/location/latest?vehicle_id=42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if stateCalls != 1 {
		t.Fatalf("State call count = %d, want 1", stateCalls)
	}
	if gotVehicleID != 42 {
		t.Fatalf("State.vehicleID = %d, want 42", gotVehicleID)
	}
	// Allow a 1-second tolerance window around the wall-clock
	// observation. Latest MUST anchor on time.Now(), NOT a rolling
	// window — a rolling-window anchor would re-introduce the very
	// "parked car has no location" bug this migration fixes.
	if gotAt.Before(before.Add(-time.Second)) || gotAt.After(after.Add(time.Second)) {
		t.Fatalf("State.at = %v, want within [%v, %v] (≈ time.Now())", gotAt, before, after)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	// CRITICAL location contract: lat / lon / heading / elevation
	// MUST round-trip even when forward-folded from an emission hours
	// ago. A NULL or missing lat/lon here would render the dashboard
	// map pin as missing and break geofence checks.
	if v, ok := got["latitude"].(float64); !ok || v != 37.7749 {
		t.Fatalf("latitude = %#v, want 37.7749 (forward-folded parked position)", got["latitude"])
	}
	if v, ok := got["longitude"].(float64); !ok || v != -122.4194 {
		t.Fatalf("longitude = %#v, want -122.4194 (forward-folded parked position)", got["longitude"])
	}
	if v, ok := got["heading"].(float64); !ok || v != 90.0 {
		t.Fatalf("heading = %#v, want 90.0 (forward-folded parked position)", got["heading"])
	}
	if v, ok := got["elevation_m"].(float64); !ok || v != 16.0 {
		t.Fatalf("elevation_m = %#v, want 16.0 (forward-folded parked position)", got["elevation_m"])
	}
	if v, ok := got["gps_state"].(string); !ok || v != "Stopped" {
		t.Fatalf("gps_state = %#v, want \"Stopped\"", got["gps_state"])
	}
	// Compound-unpacked destination coordinates project under their
	// mapped Field names.
	if v, ok := got["destination_lat"].(float64); !ok || v != 40.7128 {
		t.Fatalf("destination_lat = %#v, want 40.7128 (compound unpacked by StateReader)", got["destination_lat"])
	}
	if v, ok := got["destination_lon"].(float64); !ok || v != -74.0060 {
		t.Fatalf("destination_lon = %#v, want -74.0060 (compound unpacked by StateReader)", got["destination_lon"])
	}
	if v, ok := got["destination_name"].(string); !ok || v != "New York, NY" {
		t.Fatalf("destination_name = %#v, want \"New York, NY\"", got["destination_name"])
	}
	// Presence flags carry forward — a parked-at-home car's
	// located_at_home must NOT blank simply because the flag was last
	// emitted at park.
	if v, ok := got["located_at_home"].(bool); !ok || v != true {
		t.Fatalf("located_at_home = %#v, want true (forward-folded presence)", got["located_at_home"])
	}
	// Signals not present in the State must NOT appear in the response.
	if _, present := got["homelink_nearby"]; present {
		t.Fatalf("homelink_nearby unexpectedly present in response; got=%v", got)
	}
	if _, present := got["origin_lat"]; present {
		t.Fatalf("origin_lat unexpectedly present in response; got=%v", got)
	}
	if _, present := got["miles_to_arrival"]; present {
		t.Fatalf("miles_to_arrival unexpectedly present in response; got=%v", got)
	}
	// Raw signal names (the Signal side of locationMappings) must NOT
	// leak into the response — only the projected Field names.
	if _, present := got["Latitude"]; present {
		t.Fatalf("raw signal Latitude unexpectedly present in response; got=%v", got)
	}
	if _, present := got["Longitude"]; present {
		t.Fatalf("raw signal Longitude unexpectedly present in response; got=%v", got)
	}
}

// TestLocationSnapshot_PropagatesError verifies that BOTH endpoints
// surface upstream StateReader errors as HTTP 500, never as a silent
// 200 with an empty body. The legacy handler also returned 500 on
// Pivot / Snapshot failure; this test locks the contract for the
// migrated implementation. A silent-empty 200 here would render the
// map pin as missing on every transient pgx blip — alarming and
// indistinguishable from a real "vehicle has no location" condition.
func TestLocationSnapshot_PropagatesError(t *testing.T) {
	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewLocationSnapshotHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.List(rec, newLocationRequest("42", ""))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("Latest_StateError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on State")
		fake := &fakeStateReader{
			stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
				return nil, wantErr
			},
		}
		h := NewLocationSnapshotHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.Latest(rec, newLocationRequest("42", "/location/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}
