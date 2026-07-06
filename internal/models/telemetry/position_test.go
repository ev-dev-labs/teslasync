package telemetry

import (
	"encoding/json"
	"testing"
	"time"
)

// Position carries the four high-frequency GPS/motion signals as nullable
// pointers with omitempty, plus five always-present fields. The repo boundary
// (internal/database/position) converts these legacy source-unit names
// (speed_mph, int16 heading) to/from the SI-canonical `positions` columns, so
// the wire/struct shape asserted here is a load-bearing contract: changing a
// key or a pointer-ness silently breaks that conversion and the frontend map.

func TestPosition_OptionalSignalsOmitEmpty(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 7, 5, 12, 30, 0, 0, time.UTC)

	heading := int16(275)
	zeroHeading := int16(0)
	speed := 64.5
	elev := 1120.25
	gps := "good"

	always := []string{"vehicle_id", "ts", "latitude", "longitude", "source"}
	withOptional := func(extra ...string) []string {
		return append(append([]string{}, always...), extra...)
	}

	tests := []struct {
		name     string
		pos      Position
		wantKeys []string
	}{
		{
			name: "all optional signals nil are omitted",
			pos: Position{
				VehicleID: 1, Ts: ts, Latitude: 37.5, Longitude: -122.25,
				Source: "fleet_telemetry",
			},
			wantKeys: always,
		},
		{
			name: "all signals populated",
			pos: Position{
				VehicleID: 1, Ts: ts, Latitude: 37.5, Longitude: -122.25,
				Heading: &heading, SpeedMph: &speed, ElevationM: &elev, GpsState: &gps,
				Source: "fleet_telemetry",
			},
			wantKeys: withOptional("heading", "speed_mph", "elevation_m", "gps_state"),
		},
		{
			name: "zero-valued heading pointer is still emitted",
			// omitempty on a *int16 omits only the nil pointer — a pointer to 0
			// is a meaningful reading (car pointing due north) and MUST survive.
			// This pins the pointer-ness: switching Heading to a plain int16
			// would wrongly drop a legitimate 0.
			pos: Position{
				VehicleID: 1, Ts: ts, Latitude: 37.5, Longitude: -122.25,
				Heading: &zeroHeading, Source: "fleet_telemetry",
			},
			wantKeys: withOptional("heading"),
		},
		{
			name: "partial signal set only emits present pointers",
			pos: Position{
				VehicleID: 1, Ts: ts, Latitude: 37.5, Longitude: -122.25,
				SpeedMph: &speed, Source: "fleet_telemetry",
			},
			wantKeys: withOptional("speed_mph"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assertExactKeys(t, tt.pos, tt.wantKeys...)
		})
	}
}

func TestPosition_ZeroHeadingSerializesToZero(t *testing.T) {
	t.Parallel()
	zero := int16(0)
	p := Position{Heading: &zero, Source: "fleet_telemetry"}
	obj := jsonObject(t, p)
	if !rawEquals(obj["heading"], `0`) {
		t.Errorf("heading = %s, want 0", obj["heading"])
	}
}

func TestPosition_JSONRoundTrip(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 7, 5, 12, 30, 0, 0, time.UTC)
	heading := int16(-42) // legacy int16 heading can be negative pre-normalisation
	speed := 55.5
	elev := 98.6
	gps := "good"

	orig := Position{
		VehicleID: 42, Ts: ts, Latitude: 37.5, Longitude: -122.25,
		Heading: &heading, SpeedMph: &speed, ElevationM: &elev, GpsState: &gps,
		Source: "fleet_telemetry",
	}

	decoded := assertJSONRoundTrip(t, orig)

	if decoded.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", decoded.VehicleID)
	}
	if !decoded.Ts.Equal(ts) {
		t.Errorf("Ts = %v, want %v", decoded.Ts, ts)
	}
	if decoded.Latitude != 37.5 || decoded.Longitude != -122.25 {
		t.Errorf("coords = (%v,%v), want (37.5,-122.25)", decoded.Latitude, decoded.Longitude)
	}
	if decoded.Heading == nil || *decoded.Heading != -42 {
		t.Errorf("Heading = %v, want -42", decoded.Heading)
	}
	if decoded.SpeedMph == nil || *decoded.SpeedMph != 55.5 {
		t.Errorf("SpeedMph = %v, want 55.5", decoded.SpeedMph)
	}
	if decoded.ElevationM == nil || *decoded.ElevationM != 98.6 {
		t.Errorf("ElevationM = %v, want 98.6", decoded.ElevationM)
	}
	if decoded.GpsState == nil || *decoded.GpsState != "good" {
		t.Errorf("GpsState = %v, want good", decoded.GpsState)
	}
	if decoded.Source != "fleet_telemetry" {
		t.Errorf("Source = %q, want fleet_telemetry", decoded.Source)
	}
}

func TestPosition_UnmarshalFromAPIPayload(t *testing.T) {
	t.Parallel()
	// A representative payload the frontend/consumers deserialize. Verifies the
	// snake_case json keys map onto the exported fields in both directions.
	raw := `{
		"vehicle_id": 7,
		"ts": "2026-07-05T12:30:00Z",
		"latitude": 51.5074,
		"longitude": -0.1278,
		"heading": 180,
		"speed_mph": 30.25,
		"elevation_m": 35.0,
		"gps_state": "fix",
		"source": "fleet_telemetry"
	}`

	var p Position
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatalf("json.Unmarshal Position payload: %v", err)
	}

	if p.VehicleID != 7 {
		t.Errorf("VehicleID = %d, want 7", p.VehicleID)
	}
	if p.Latitude != 51.5074 || p.Longitude != -0.1278 {
		t.Errorf("coords = (%v,%v), want (51.5074,-0.1278)", p.Latitude, p.Longitude)
	}
	if p.Heading == nil || *p.Heading != 180 {
		t.Errorf("Heading = %v, want 180", p.Heading)
	}
	if p.SpeedMph == nil || *p.SpeedMph != 30.25 {
		t.Errorf("SpeedMph = %v, want 30.25", p.SpeedMph)
	}
	if p.GpsState == nil || *p.GpsState != "fix" {
		t.Errorf("GpsState = %v, want fix", p.GpsState)
	}
}

func TestPosition_UnmarshalMissingOptionalsYieldNil(t *testing.T) {
	t.Parallel()
	// Absent optional keys must decode to nil pointers (SQL NULL), never a zero
	// value — the repo's SI conversion treats nil as "no reading".
	raw := `{"vehicle_id":7,"ts":"2026-07-05T12:30:00Z","latitude":1,"longitude":2,"source":"fleet_telemetry"}`
	var p Position
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatalf("json.Unmarshal minimal Position: %v", err)
	}
	if p.Heading != nil {
		t.Errorf("Heading = %v, want nil", p.Heading)
	}
	if p.SpeedMph != nil {
		t.Errorf("SpeedMph = %v, want nil", p.SpeedMph)
	}
	if p.ElevationM != nil {
		t.Errorf("ElevationM = %v, want nil", p.ElevationM)
	}
	if p.GpsState != nil {
		t.Errorf("GpsState = %v, want nil", p.GpsState)
	}
}
