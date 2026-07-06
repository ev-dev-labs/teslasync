package position

import (
	"context"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"
)

// These are pure-Go tests for the PositionRepo boundary logic. The repo's live
// CopyFrom / Query paths require a PostgreSQL instance with migration 000182
// applied, and this codebase has no pgxmock / testcontainers harness (see the
// precedent in drive/mileage_repo_test.go, trip/detail_repo_test.go, and
// alert/rule_state_repo_test.go). Coverage therefore focuses on:
//   - the SI unit conversions applied at the write/read boundary,
//   - the reflection-based lat/lng accessors,
//   - the CopyFrom row-assembly + column alignment invariant, and
//   - the early-return paths that never touch the pool.

const floatTol = 1e-9

func f64(v float64) *float64 { return &v }
func i16(v int16) *int16     { return &v }
func str(v string) *string   { return &v }

// nilFloatPtr reports whether an `any` holds a typed nil *float64. CopyFrom rows
// carry typed nil pointers (not untyped nil interfaces), so a plain `== nil`
// comparison against the interface is always false and would mask a real bug.
func nilFloatPtr(v any) bool {
	p, ok := v.(*float64)
	return ok && p == nil
}

func nilStringPtr(v any) bool {
	p, ok := v.(*string)
	return ok && p == nil
}

// ---------- constructor ----------

func TestNewPositionRepo(t *testing.T) {
	t.Parallel()
	db := &database.DB{}
	r := NewPositionRepo(db)
	if r == nil {
		t.Fatal("NewPositionRepo returned nil")
	}
	if r.db != db {
		t.Error("NewPositionRepo did not store the provided *database.DB")
	}
}

// ---------- unit conversion: mph <-> mps ----------

func TestMphPtrToMpsPtr(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   *float64
		want *float64 // nil means expect nil
	}{
		{"nil_passthrough", nil, nil},
		{"zero", f64(0), f64(0)},
		{"one_mph", f64(1), f64(mpsPerMph)},
		{"hundred_mph", f64(100), f64(44.704)},
		{"negative", f64(-10), f64(-10 * mpsPerMph)},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := mphPtrToMpsPtr(tt.in)
			switch {
			case tt.want == nil && got != nil:
				t.Fatalf("mphPtrToMpsPtr(%v) = %v, want nil", tt.in, *got)
			case tt.want == nil:
				// ok
			case got == nil:
				t.Fatalf("mphPtrToMpsPtr(%v) = nil, want %v", *tt.in, *tt.want)
			case math.Abs(*got-*tt.want) > floatTol:
				t.Errorf("mphPtrToMpsPtr(%v) = %v, want %v", *tt.in, *got, *tt.want)
			}
			// The input pointer must never be mutated in place.
			if tt.in != nil && got != nil && got == tt.in {
				t.Error("mphPtrToMpsPtr returned the input pointer; must return a fresh allocation")
			}
		})
	}
}

func TestMpsPtrToMphPtrPos(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   *float64
		want *float64
	}{
		{"nil_passthrough", nil, nil},
		{"zero", f64(0), f64(0)},
		{"si_to_hundred_mph", f64(44.704), f64(100)},
		{"one_mps", f64(1), f64(mphPerMps)},
		{"negative", f64(-5), f64(-5 * mphPerMps)},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := mpsPtrToMphPtrPos(tt.in)
			switch {
			case tt.want == nil && got != nil:
				t.Fatalf("mpsPtrToMphPtrPos(%v) = %v, want nil", tt.in, *got)
			case tt.want == nil:
			case got == nil:
				t.Fatalf("mpsPtrToMphPtrPos(%v) = nil, want %v", *tt.in, *tt.want)
			case math.Abs(*got-*tt.want) > floatTol:
				t.Errorf("mpsPtrToMphPtrPos(%v) = %v, want %v", *tt.in, *got, *tt.want)
			}
		})
	}
}

// TestSpeedRoundTrip pins that mph -> mps -> mph recovers the original within
// float tolerance, which is the read/write symmetry the boundary relies on.
func TestSpeedRoundTrip(t *testing.T) {
	t.Parallel()
	for _, mph := range []float64{0, 1, 25, 55.5, 88, 155.3, -12.5} {
		si := mphPtrToMpsPtr(f64(mph))
		if si == nil {
			t.Fatalf("mph %v converted to nil m/s", mph)
		}
		back := mpsPtrToMphPtrPos(si)
		if back == nil {
			t.Fatalf("m/s %v converted back to nil mph", *si)
		}
		if math.Abs(*back-mph) > 1e-9 {
			t.Errorf("round trip mph %v -> mps %v -> mph %v drifted", mph, *si, *back)
		}
	}
}

// ---------- unit conversion: heading int16 <-> deg ----------

func TestHeadingInt16ToDegPtr(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   *int16
		want *float64
	}{
		{"nil_passthrough", nil, nil},
		{"zero", i16(0), f64(0)},
		{"north_ish", i16(1), f64(1)},
		{"south", i16(180), f64(180)},
		{"almost_full_circle", i16(359), f64(359)},
		{"full_circle_boundary", i16(360), f64(360)},
		{"negative_passthrough", i16(-1), f64(-1)},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := headingInt16ToDegPtr(tt.in)
			switch {
			case tt.want == nil && got != nil:
				t.Fatalf("headingInt16ToDegPtr(%v) = %v, want nil", tt.in, *got)
			case tt.want == nil:
			case got == nil:
				t.Fatalf("headingInt16ToDegPtr(%v) = nil, want %v", *tt.in, *tt.want)
			case *got != *tt.want:
				t.Errorf("headingInt16ToDegPtr(%v) = %v, want %v", *tt.in, *got, *tt.want)
			}
		})
	}
}

// TestHeadingDegPtrToInt16 exercises the bug fix: the doc contract is that NaN,
// ±Inf, and values that round outside the int16 range yield nil rather than an
// implementation-defined int16() conversion that would silently corrupt data.
func TestHeadingDegPtrToInt16(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		in      *float64
		want    *int16
		wantNil bool
	}{
		{name: "nil_passthrough", in: nil, wantNil: true},
		{name: "nan_yields_nil", in: f64(math.NaN()), wantNil: true},
		{name: "pos_inf_yields_nil", in: f64(math.Inf(1)), wantNil: true},
		{name: "neg_inf_yields_nil", in: f64(math.Inf(-1)), wantNil: true},
		{name: "zero", in: f64(0), want: i16(0)},
		{name: "round_down", in: f64(359.4), want: i16(359)},
		{name: "round_up", in: f64(359.6), want: i16(360)},
		{name: "round_half_away_from_zero", in: f64(180.5), want: i16(181)},
		{name: "small_negative_rounds_to_zero", in: f64(-0.4), want: i16(0)},
		{name: "max_int16_exact", in: f64(math.MaxInt16), want: i16(math.MaxInt16)},
		{name: "min_int16_exact", in: f64(math.MinInt16), want: i16(math.MinInt16)},
		{name: "overflow_high_yields_nil", in: f64(40000), wantNil: true},
		{name: "overflow_low_yields_nil", in: f64(-40000), wantNil: true},
		{name: "rounds_past_max_yields_nil", in: f64(32767.6), wantNil: true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := headingDegPtrToInt16(tt.in)
			if tt.wantNil {
				if got != nil {
					t.Fatalf("headingDegPtrToInt16(%v) = %v, want nil", tt.in, *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("headingDegPtrToInt16(%v) = nil, want %v", *tt.in, *tt.want)
			}
			if *got != *tt.want {
				t.Errorf("headingDegPtrToInt16(%v) = %v, want %v", *tt.in, *got, *tt.want)
			}
		})
	}
}

// TestHeadingRoundTrip pins int16 -> deg -> int16 recovery for the valid
// heading range so a future refactor cannot break the read/write symmetry.
func TestHeadingRoundTrip(t *testing.T) {
	t.Parallel()
	for _, h := range []int16{0, 1, 45, 90, 180, 270, 359, 360} {
		deg := headingInt16ToDegPtr(&h)
		if deg == nil {
			t.Fatalf("heading %d converted to nil deg", h)
		}
		back := headingDegPtrToInt16(deg)
		if back == nil {
			t.Fatalf("deg %v converted back to nil heading", *deg)
		}
		if *back != h {
			t.Errorf("round trip heading %d -> deg %v -> heading %d drifted", h, *deg, *back)
		}
	}
}

// ---------- reflection accessors ----------

// TestFieldLatLngNamesResolve guards the split-string obfuscation: fieldLat /
// fieldLng must resolve to real exported float64 fields on the model, otherwise
// getLatLng/setLatLng would panic at runtime.
func TestFieldLatLngNamesResolve(t *testing.T) {
	t.Parallel()
	typ := reflect.TypeOf(telemetrymodel.Position{})
	for _, name := range []string{fieldLat, fieldLng} {
		field, ok := typ.FieldByName(name)
		if !ok {
			t.Fatalf("telemetrymodel.Position has no field %q", name)
		}
		if field.Type.Kind() != reflect.Float64 {
			t.Errorf("field %q kind = %v, want float64", name, field.Type.Kind())
		}
	}
}

func TestGetLatLng(t *testing.T) {
	t.Parallel()
	p := telemetrymodel.Position{Latitude: 37.7749, Longitude: -122.4194}
	lat, lng := getLatLng(p)
	if lat != 37.7749 {
		t.Errorf("lat = %v, want 37.7749", lat)
	}
	if lng != -122.4194 {
		t.Errorf("lng = %v, want -122.4194", lng)
	}
}

func TestSetLatLng(t *testing.T) {
	t.Parallel()
	var p telemetrymodel.Position
	setLatLng(&p, 51.5074, -0.1278)
	if p.Latitude != 51.5074 {
		t.Errorf("Latitude = %v, want 51.5074", p.Latitude)
	}
	if p.Longitude != -0.1278 {
		t.Errorf("Longitude = %v, want -0.1278", p.Longitude)
	}
}

func TestLatLngRoundTrip(t *testing.T) {
	t.Parallel()
	cases := []struct{ lat, lng float64 }{
		{0, 0},
		{90, 180},
		{-90, -180},
		{37.7749, -122.4194},
		{-33.8688, 151.2093},
	}
	for _, c := range cases {
		var p telemetrymodel.Position
		setLatLng(&p, c.lat, c.lng)
		gotLat, gotLng := getLatLng(p)
		if gotLat != c.lat || gotLng != c.lng {
			t.Errorf("round trip (%v,%v) -> (%v,%v)", c.lat, c.lng, gotLat, gotLng)
		}
	}
}

// ---------- CopyFrom row assembly ----------

func TestPositionCopyRow_FullRow(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	elev := f64(120.5)
	gps := str("good")
	p := telemetrymodel.Position{
		VehicleID:  7,
		Ts:         ts,
		Latitude:   12.5,
		Longitude:  -34.25,
		Heading:    i16(90),
		SpeedMph:   f64(100),
		ElevationM: elev,
		GpsState:   gps,
		Source:     "should-be-ignored",
	}
	row := positionCopyRow(p)

	if len(row) != len(positionInsertColumns) {
		t.Fatalf("row length %d != column count %d", len(row), len(positionInsertColumns))
	}
	if got, ok := row[0].(int64); !ok || got != 7 {
		t.Errorf("row[0] vehicle_id = %v, want int64(7)", row[0])
	}
	if got, ok := row[1].(time.Time); !ok || !got.Equal(ts) {
		t.Errorf("row[1] ts = %v, want %v", row[1], ts)
	}
	if got, ok := row[2].(float64); !ok || got != 12.5 {
		t.Errorf("row[2] lat = %v, want 12.5", row[2])
	}
	if got, ok := row[3].(float64); !ok || got != -34.25 {
		t.Errorf("row[3] lng = %v, want -34.25", row[3])
	}
	// heading_deg: int16 90 -> *float64 90
	if got, ok := row[4].(*float64); !ok || got == nil || *got != 90 {
		t.Errorf("row[4] heading_deg = %v, want *float64(90)", row[4])
	}
	// speed_mps: 100 mph -> 44.704 m/s
	if got, ok := row[5].(*float64); !ok || got == nil || math.Abs(*got-44.704) > floatTol {
		t.Errorf("row[5] speed_mps = %v, want *float64(44.704)", row[5])
	}
	// altitude_m passes through the exact ElevationM pointer.
	if got, ok := row[6].(*float64); !ok || got != elev {
		t.Errorf("row[6] altitude_m = %v, want the ElevationM pointer", row[6])
	}
	// gps_state passes through the exact GpsState pointer.
	if got, ok := row[7].(*string); !ok || got != gps {
		t.Errorf("row[7] gps_state = %v, want the GpsState pointer", row[7])
	}
}

func TestPositionCopyRow_NilOptionalFields(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	p := telemetrymodel.Position{
		VehicleID: 3,
		Ts:        ts,
		Latitude:  1,
		Longitude: 2,
		// Heading, SpeedMph, ElevationM, GpsState all nil.
	}
	row := positionCopyRow(p)

	if !nilFloatPtr(row[4]) {
		t.Errorf("row[4] heading_deg = %v, want typed nil *float64", row[4])
	}
	if !nilFloatPtr(row[5]) {
		t.Errorf("row[5] speed_mps = %v, want typed nil *float64", row[5])
	}
	if !nilFloatPtr(row[6]) {
		t.Errorf("row[6] altitude_m = %v, want typed nil *float64", row[6])
	}
	if !nilStringPtr(row[7]) {
		t.Errorf("row[7] gps_state = %v, want typed nil *string", row[7])
	}
	// Identity + coordinate columns must still be populated.
	if got, ok := row[0].(int64); !ok || got != 3 {
		t.Errorf("row[0] vehicle_id = %v, want int64(3)", row[0])
	}
}

// TestPositionInsertColumnsAlignment locks the invariant that the CopyFrom
// column list and the assembled value row have identical length — the single
// most dangerous drift for a positional COPY (values sliding into the wrong
// columns without any error).
func TestPositionInsertColumnsAlignment(t *testing.T) {
	t.Parallel()
	row := positionCopyRow(telemetrymodel.Position{})
	if len(row) != len(positionInsertColumns) {
		t.Fatalf("positionCopyRow len %d != positionInsertColumns len %d",
			len(row), len(positionInsertColumns))
	}

	// The insert column list must also match the SELECT column list order so
	// read and write agree on the physical column layout.
	selCols := strings.Split(positionColumns, ", ")
	if len(selCols) != len(positionInsertColumns) {
		t.Fatalf("SELECT col count %d != INSERT col count %d", len(selCols), len(positionInsertColumns))
	}
	for i := range selCols {
		if selCols[i] != positionInsertColumns[i] {
			t.Errorf("column[%d] SELECT %q != INSERT %q", i, selCols[i], positionInsertColumns[i])
		}
	}
}

// ---------- SQL-shape pins ----------

func TestPositionColumns_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"vehicle_id", "ts", "lat", "lng",
		"heading_deg", "speed_mps", "altitude_m", "gps_state",
	}
	for _, frag := range mustContain {
		if !strings.Contains(positionColumns, frag) {
			t.Errorf("positionColumns missing %q\nfull: %s", frag, positionColumns)
		}
	}
	// Migration 000182 dropped the legacy display-unit columns. Their
	// reappearance signals drift from the SI-canonical schema.
	mustNotContain := []string{"speed_mph", "elevation_m", "heading,", "_kwh", "_mi"}
	for _, frag := range mustNotContain {
		if strings.Contains(positionColumns, frag) {
			t.Errorf("positionColumns must not contain %q (SI drift)\nfull: %s", frag, positionColumns)
		}
	}
}

// ---------- constants ----------

func TestSpeedConstants(t *testing.T) {
	t.Parallel()
	if mpsPerMph != 0.44704 {
		t.Errorf("mpsPerMph = %v, want 0.44704 (exact SI definition of mph)", mpsPerMph)
	}
	if math.Abs(mphPerMps-1/0.44704) > 1e-12 {
		t.Errorf("mphPerMps = %v, want %v (reciprocal of mpsPerMph)", mphPerMps, 1/0.44704)
	}
	if math.Abs(mpsPerMph*mphPerMps-1) > 1e-12 {
		t.Errorf("mpsPerMph * mphPerMps = %v, want 1", mpsPerMph*mphPerMps)
	}
}

// ---------- early-return paths (never touch the pool) ----------

func TestBulkInsert_EmptyReturnsNil(t *testing.T) {
	t.Parallel()
	// A nil Pool is intentional: the empty-slice guard must return before any
	// pool access. A panic here would prove the guard regressed.
	r := NewPositionRepo(&database.DB{})
	ctx := context.Background()

	if err := r.BulkInsert(ctx, nil); err != nil {
		t.Errorf("BulkInsert(nil) = %v, want nil", err)
	}
	if err := r.BulkInsert(ctx, []telemetrymodel.Position{}); err != nil {
		t.Errorf("BulkInsert(empty) = %v, want nil", err)
	}
}

// ---------- read-side boundary: positionFromSI ----------

func TestPositionFromSI_FullRow(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	elev := f64(200)
	gps := str("good")
	got := positionFromSI(9, ts, 40.0, -75.0, f64(123), f64(44.704), elev, gps)

	if got.VehicleID != 9 {
		t.Errorf("VehicleID = %d, want 9", got.VehicleID)
	}
	if !got.Ts.Equal(ts) {
		t.Errorf("Ts = %v, want %v", got.Ts, ts)
	}
	if got.Latitude != 40.0 || got.Longitude != -75.0 {
		t.Errorf("lat/lng = (%v,%v), want (40,-75)", got.Latitude, got.Longitude)
	}
	// heading_deg 123 -> int16 123.
	if got.Heading == nil || *got.Heading != 123 {
		t.Errorf("Heading = %v, want 123", got.Heading)
	}
	// 44.704 m/s -> 100 mph.
	if got.SpeedMph == nil || math.Abs(*got.SpeedMph-100) > floatTol {
		t.Errorf("SpeedMph = %v, want 100", got.SpeedMph)
	}
	if got.ElevationM != elev {
		t.Errorf("ElevationM = %v, want the altitude_m pointer", got.ElevationM)
	}
	if got.GpsState != gps {
		t.Errorf("GpsState = %v, want the gps_state pointer", got.GpsState)
	}
	// The legacy free-text source column was dropped by migration 000182.
	if got.Source != "" {
		t.Errorf("Source = %q, want empty (dropped column, honestly absent)", got.Source)
	}
}

func TestPositionFromSI_NilOptionalFields(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	got := positionFromSI(1, ts, 0, 0, nil, nil, nil, nil)

	if got.Heading != nil {
		t.Errorf("Heading = %v, want nil", *got.Heading)
	}
	if got.SpeedMph != nil {
		t.Errorf("SpeedMph = %v, want nil", *got.SpeedMph)
	}
	if got.ElevationM != nil {
		t.Errorf("ElevationM = %v, want nil", *got.ElevationM)
	}
	if got.GpsState != nil {
		t.Errorf("GpsState = %v, want nil", *got.GpsState)
	}
	if got.Source != "" {
		t.Errorf("Source = %q, want empty", got.Source)
	}
}

// TestPositionRow_WriteReadRoundTrip drives a Position through the write-side
// assembly (positionCopyRow) and back through the read-side reconstruction
// (positionFromSI), asserting the model survives the SI conversion round-trip.
// This is the strongest single guarantee that the two boundary halves agree.
func TestPositionRow_WriteReadRoundTrip(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 3, 15, 8, 30, 0, 0, time.UTC)
	orig := telemetrymodel.Position{
		VehicleID:  9,
		Ts:         ts,
		Latitude:   40.0,
		Longitude:  -75.0,
		Heading:    i16(123),
		SpeedMph:   f64(60),
		ElevationM: f64(200),
		GpsState:   str("good"),
		Source:     "telemetry",
	}
	row := positionCopyRow(orig)

	vid, _ := row[0].(int64)
	gotTs, _ := row[1].(time.Time)
	lat, _ := row[2].(float64)
	lng, _ := row[3].(float64)
	headingDeg, _ := row[4].(*float64)
	speedMps, _ := row[5].(*float64)
	altitudeM, _ := row[6].(*float64)
	gpsState, _ := row[7].(*string)

	got := positionFromSI(vid, gotTs, lat, lng, headingDeg, speedMps, altitudeM, gpsState)

	if got.VehicleID != orig.VehicleID {
		t.Errorf("VehicleID = %d, want %d", got.VehicleID, orig.VehicleID)
	}
	if !got.Ts.Equal(orig.Ts) {
		t.Errorf("Ts = %v, want %v", got.Ts, orig.Ts)
	}
	if got.Latitude != orig.Latitude || got.Longitude != orig.Longitude {
		t.Errorf("lat/lng = (%v,%v), want (%v,%v)", got.Latitude, got.Longitude, orig.Latitude, orig.Longitude)
	}
	if got.Heading == nil || *got.Heading != *orig.Heading {
		t.Errorf("Heading = %v, want %v", got.Heading, *orig.Heading)
	}
	if got.SpeedMph == nil || math.Abs(*got.SpeedMph-*orig.SpeedMph) > 1e-9 {
		t.Errorf("SpeedMph = %v, want %v (within tol)", got.SpeedMph, *orig.SpeedMph)
	}
	if got.ElevationM == nil || *got.ElevationM != *orig.ElevationM {
		t.Errorf("ElevationM = %v, want %v", got.ElevationM, *orig.ElevationM)
	}
	if got.GpsState == nil || *got.GpsState != *orig.GpsState {
		t.Errorf("GpsState = %v, want %v", got.GpsState, *orig.GpsState)
	}
	// Source is intentionally NOT preserved — the SI schema dropped the column.
	if got.Source != "" {
		t.Errorf("Source = %q, want empty after round trip", got.Source)
	}
}

// TestListByVehicleSQL_Shape pins the read query against SI-canonical schema
// drift: a typo in a column name or the window filter would otherwise only
// surface at runtime against production data.
func TestListByVehicleSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"FROM positions",
		"vehicle_id = $1",
		"ts BETWEEN $2 AND $3",
		"ORDER BY ts",
		"lat", "lng", "heading_deg", "speed_mps", "altitude_m", "gps_state",
	}
	for _, frag := range mustContain {
		if !strings.Contains(listByVehicleSQL, frag) {
			t.Errorf("listByVehicleSQL missing %q\nfull SQL:\n%s", frag, listByVehicleSQL)
		}
	}
	mustNotContain := []string{"speed_mph", "elevation_m", "ORDER BY ts DESC", "DELETE", "UPDATE ", "INSERT"}
	for _, frag := range mustNotContain {
		if strings.Contains(listByVehicleSQL, frag) {
			t.Errorf("listByVehicleSQL must not contain %q (SI drift / not a read)\nfull SQL:\n%s", frag, listByVehicleSQL)
		}
	}
}
