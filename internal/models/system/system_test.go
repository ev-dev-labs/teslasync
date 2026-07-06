package system

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
	"time"
)

// ── small pointer helpers so table rows can express optional fields inline ──
func strptr(s string) *string                        { return &s }
func f64ptr(v float64) *float64                      { return &v }
func i64ptr(v int64) *int64                          { return &v }
func i32ptr(v int32) *int32                          { return &v }
func timeptr(t time.Time) *time.Time                 { return &t }
func geoCatPtr(c GeofenceCategory) *GeofenceCategory { return &c }
func placeCatPtr(c PlaceCategory) *PlaceCategory     { return &c }

const floatEps = 1e-9

// =============================================================================
// Geofence.Centroid
// =============================================================================

func TestGeofence_Centroid(t *testing.T) {
	tests := []struct {
		name    string
		wkt     string
		wantLat float64
		wantLon float64
	}{
		{"empty string", "", 0, 0},
		{"closed unit square", "POLYGON((0 0,1 0,1 1,0 1,0 0))", 0.5, 0.5},
		{"open unit square (no closing vertex)", "POLYGON((0 0,1 0,1 1,0 1))", 0.5, 0.5},
		{"single vertex", "POLYGON((3 4))", 4, 3},
		{"negative coords", "POLYGON((-122 47,-121 47,-121 48,-122 48,-122 47))", 47.5, -121.5},
		{"whitespace padded", "POLYGON(( 2 3 , 4 5 , 2 3 ))", 4, 3},
		{"fractional", "POLYGON((0.5 1.5,1.5 2.5,0.5 1.5))", 2.0, 1.0},
		{"missing double paren", "POLYGON(1 2)", 0, 0},
		{"empty polygon parens", "POLYGON(())", 0, 0},
		{"garbage", "totally not wkt", 0, 0},
		{"non-numeric vertices skipped", "POLYGON((a b,c d))", 0, 0},
		{"malformed pair (3 fields) skipped", "POLYGON((1 2 3,4 5))", 5, 4},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := &Geofence{PolygonWKT: tt.wkt}
			gotLat, gotLon := g.Centroid()
			if math.Abs(gotLat-tt.wantLat) > floatEps {
				t.Errorf("Centroid() lat = %v, want %v", gotLat, tt.wantLat)
			}
			if math.Abs(gotLon-tt.wantLon) > floatEps {
				t.Errorf("Centroid() lon = %v, want %v", gotLon, tt.wantLon)
			}
		})
	}
}

func TestGeofence_Centroid_NilReceiver(t *testing.T) {
	var g *Geofence
	lat, lon := g.Centroid() // must not panic
	if lat != 0 || lon != 0 {
		t.Errorf("Centroid() on nil = (%v,%v), want (0,0)", lat, lon)
	}
}

// TestGeofence_LatitudeLongitude pins that the convenience accessors delegate
// to Centroid and split the tuple in the documented order (lat first, lon
// second — the reverse of WKT's own lon-lat ordering).
func TestGeofence_LatitudeLongitude(t *testing.T) {
	g := &Geofence{PolygonWKT: "POLYGON((-122 47,-121 47,-121 48,-122 48,-122 47))"}
	wantLat, wantLon := g.Centroid()
	if got := g.Latitude(); math.Abs(got-wantLat) > floatEps {
		t.Errorf("Latitude() = %v, want %v", got, wantLat)
	}
	if got := g.Longitude(); math.Abs(got-wantLon) > floatEps {
		t.Errorf("Longitude() = %v, want %v", got, wantLon)
	}
	// Latitude and Longitude must not be the same value for an asymmetric fence.
	if g.Latitude() == g.Longitude() {
		t.Errorf("Latitude() and Longitude() collapsed to the same value %v", g.Latitude())
	}
}

func TestGeofence_LatitudeLongitude_NilReceiver(t *testing.T) {
	var g *Geofence
	if got := g.Latitude(); got != 0 {
		t.Errorf("Latitude() on nil = %v, want 0", got)
	}
	if got := g.Longitude(); got != 0 {
		t.Errorf("Longitude() on nil = %v, want 0", got)
	}
}

// =============================================================================
// Geofence.Radius
// =============================================================================

func TestGeofence_Radius_DegenerateInputs(t *testing.T) {
	tests := []struct {
		name string
		wkt  string
	}{
		{"empty", ""},
		{"unparseable", "not wkt"},
		{"empty parens", "POLYGON(())"},
		{"all non-numeric", "POLYGON((a b,c d))"},
		{"centroid at null island", "POLYGON((0 0,0 0,0 0))"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := &Geofence{PolygonWKT: tt.wkt}
			if got := g.Radius(); got != 0 {
				t.Errorf("Radius() = %v, want 0", got)
			}
		})
	}
}

func TestGeofence_Radius_NilReceiver(t *testing.T) {
	var g *Geofence
	if got := g.Radius(); got != 0 {
		t.Errorf("Radius() on nil = %v, want 0", got)
	}
}

// TestGeofence_Radius_MaxVertexDistance pins that Radius returns the rounded
// maximum great-circle distance from the centroid to any vertex, computed with
// the same Haversine helper the production path uses.
func TestGeofence_Radius_MaxVertexDistance(t *testing.T) {
	g := &Geofence{PolygonWKT: "POLYGON((0 0,1 0,1 1,0 1,0 0))"}
	cLat, cLon := g.Centroid()
	verts := [][2]float64{{0, 0}, {1, 0}, {1, 1}, {0, 1}} // lon, lat
	var want float64
	for _, v := range verts {
		if d := geofenceHaversineM(cLat, cLon, v[1], v[0]); d > want {
			want = d
		}
	}
	want = math.Round(want)
	if got := g.Radius(); math.Abs(got-want) > floatEps {
		t.Errorf("Radius() = %v, want %v", got, want)
	}
	if got := g.Radius(); got <= 0 {
		t.Errorf("Radius() = %v, want a positive distance for a real polygon", got)
	}
}

// TestGeofence_Radius_ScalesWithSize pins that a larger polygon yields a larger
// radius — a cheap invariant that would catch a broken max/accumulator.
func TestGeofence_Radius_ScalesWithSize(t *testing.T) {
	small := &Geofence{PolygonWKT: "POLYGON((0 0,0.01 0,0.01 0.01,0 0.01,0 0))"}
	large := &Geofence{PolygonWKT: "POLYGON((0 0,1 0,1 1,0 1,0 0))"}
	if small.Radius() <= 0 {
		t.Fatalf("small.Radius() = %v, want > 0", small.Radius())
	}
	if large.Radius() <= small.Radius() {
		t.Errorf("large.Radius() (%v) must exceed small.Radius() (%v)", large.Radius(), small.Radius())
	}
}

// TestGeofence_Radius_SkipsMalformedVertices pins that Radius tolerates
// individual bad vertices (wrong field count or non-numeric coords) once the
// centroid is established from the good ones, computing the max distance over
// only the parseable vertices instead of erroring or panicking.
func TestGeofence_Radius_SkipsMalformedVertices(t *testing.T) {
	g := &Geofence{PolygonWKT: "POLYGON((0 0,10 10,bad vertex,1 2 3,0 0))"}
	// Centroid is derived from the two good vertices → (5,5), non-zero.
	cLat, cLon := g.Centroid()
	if cLat == 0 && cLon == 0 {
		t.Fatalf("precondition failed: centroid should be non-zero, got (%v,%v)", cLat, cLon)
	}
	want := math.Round(math.Max(
		geofenceHaversineM(cLat, cLon, 0, 0),
		geofenceHaversineM(cLat, cLon, 10, 10),
	))
	if got := g.Radius(); math.Abs(got-want) > floatEps {
		t.Errorf("Radius() = %v, want %v (max over parseable vertices)", got, want)
	}
}

// =============================================================================
// geofenceHaversineM
// =============================================================================

func TestGeofenceHaversineM(t *testing.T) {
	// One degree of arc on a great circle: R * pi/180.
	const oneDegM = 6_371_000.0 * math.Pi / 180.0

	tests := []struct {
		name                   string
		lat1, lon1, lat2, lon2 float64
		want                   float64
		tol                    float64
	}{
		{"same point", 40, -75, 40, -75, 0, floatEps},
		{"one degree latitude", 0, 0, 1, 0, oneDegM, 1e-6},
		{"one degree longitude at equator", 0, 0, 0, 1, oneDegM, 1e-6},
		{"one degree longitude at 60N shrinks by cos", 60, 0, 60, 1, oneDegM * 0.5, 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := geofenceHaversineM(tt.lat1, tt.lon1, tt.lat2, tt.lon2)
			if math.Abs(got-tt.want) > tt.tol {
				t.Errorf("geofenceHaversineM(%v,%v,%v,%v) = %v, want %v (±%v)",
					tt.lat1, tt.lon1, tt.lat2, tt.lon2, got, tt.want, tt.tol)
			}
		})
	}
}

func TestGeofenceHaversineM_Symmetric(t *testing.T) {
	ab := geofenceHaversineM(10, 20, 30, 40)
	ba := geofenceHaversineM(30, 40, 10, 20)
	if math.Abs(ab-ba) > 1e-6 {
		t.Errorf("haversine not symmetric: a->b = %v, b->a = %v", ab, ba)
	}
	if ab <= 0 {
		t.Errorf("distance between distinct points = %v, want > 0", ab)
	}
}

// =============================================================================
// Geofence JSON marshalling (custom Marshal/Unmarshal)
// =============================================================================

// TestGeofence_MarshalJSON_EmitsCircleFields locks the response shape the web
// client depends on: the derived latitude/longitude/radius appear alongside the
// canonical polygon_wkt and every base column.
func TestGeofence_MarshalJSON_EmitsCircleFields(t *testing.T) {
	g := Geofence{
		ID:           7,
		Name:         "Depot",
		PolygonWKT:   "POLYGON((0 0,1 0,1 1,0 1,0 0))",
		Enabled:      true,
		AlertOnEntry: true,
	}
	raw, err := json.Marshal(g)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("Unmarshal to map: %v", err)
	}
	for _, key := range []string{
		"id", "name", "polygon_wkt", "enabled", "alert_on_entry", "alert_on_exit",
		"created_at", "updated_at", "latitude", "longitude", "radius",
	} {
		if _, ok := m[key]; !ok {
			t.Errorf("marshaled Geofence missing key %q; got %s", key, raw)
		}
	}
	// The derived fields must equal the method outputs.
	wantLat, wantLon := g.Centroid()
	var gotLat, gotLon, gotRadius float64
	_ = json.Unmarshal(m["latitude"], &gotLat)
	_ = json.Unmarshal(m["longitude"], &gotLon)
	_ = json.Unmarshal(m["radius"], &gotRadius)
	if math.Abs(gotLat-wantLat) > 1e-9 || math.Abs(gotLon-wantLon) > 1e-9 {
		t.Errorf("derived centroid = (%v,%v), want (%v,%v)", gotLat, gotLon, wantLat, wantLon)
	}
	if math.Abs(gotRadius-g.Radius()) > 1e-9 {
		t.Errorf("derived radius = %v, want %v", gotRadius, g.Radius())
	}
}

// TestGeofence_MarshalJSON_CategoryOmitEmpty pins that the nullable category is
// omitted when unset and present when set (repo scan relies on the tag).
func TestGeofence_MarshalJSON_CategoryOmitEmpty(t *testing.T) {
	// Unset → omitted.
	raw, err := json.Marshal(Geofence{Name: "A"})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if _, ok := m["category"]; ok {
		t.Errorf("category should be omitted when nil; got %s", raw)
	}
	// Set → present with the enum value.
	raw2, _ := json.Marshal(Geofence{Name: "B", Category: geoCatPtr(GeofenceCategoryWork)})
	var m2 map[string]json.RawMessage
	if err := json.Unmarshal(raw2, &m2); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if _, ok := m2["category"]; !ok {
		t.Errorf("category should be present when set; got %s", raw2)
	}
}

// TestGeofence_UnmarshalJSON_AcceptsDerivedFields is the Phase-46 export/import
// contract: a payload produced by MarshalJSON (carrying the derived
// latitude/longitude/radius) must decode cleanly — even under
// DisallowUnknownFields — while those derived fields are discarded and the
// geometry is recovered from polygon_wkt.
func TestGeofence_UnmarshalJSON_AcceptsDerivedFields(t *testing.T) {
	orig := Geofence{
		ID:           3,
		Name:         "Roundtrip",
		PolygonWKT:   "POLYGON((0 0,1 0,1 1,0 1,0 0))",
		Category:     geoCatPtr(GeofenceCategoryHome),
		Enabled:      true,
		AlertOnEntry: true,
		AlertOnExit:  true,
	}
	raw, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	// Strict decode — this is what the settings import path does.
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var back Geofence
	if err := dec.Decode(&back); err != nil {
		t.Fatalf("strict Decode of self-marshaled geofence failed: %v\npayload: %s", err, raw)
	}

	if back.Name != orig.Name || back.PolygonWKT != orig.PolygonWKT {
		t.Errorf("round-trip identity mismatch: got %+v", back)
	}
	if back.Category == nil || *back.Category != GeofenceCategoryHome {
		t.Errorf("round-trip Category = %v, want home", back.Category)
	}
	if !back.Enabled || !back.AlertOnEntry || !back.AlertOnExit {
		t.Errorf("round-trip flags mismatch: %+v", back)
	}
	// Geometry is recomputed from polygon_wkt, not carried by the derived fields.
	oLat, oLon := orig.Centroid()
	bLat, bLon := back.Centroid()
	if math.Abs(oLat-bLat) > 1e-9 || math.Abs(oLon-bLon) > 1e-9 {
		t.Errorf("round-trip centroid drift: got (%v,%v), want (%v,%v)", bLat, bLon, oLat, oLon)
	}
}

// TestGeofence_UnmarshalJSON_ToleratesUnknownFields pins the real semantics of
// the custom unmarshaler: it delegates to a lenient json.Unmarshal, so ANY
// unrecognised top-level key is silently ignored. This is the mechanism that
// lets the derived latitude/longitude/radius trio survive a strict import
// decoder — the type opts out of field-matching entirely, so known columns
// still populate while extras are dropped.
func TestGeofence_UnmarshalJSON_ToleratesUnknownFields(t *testing.T) {
	body := []byte(`{"name":"X","polygon_wkt":"POLYGON((0 0,1 1,0 0))","bogus_key":1,"latitude":9}`)
	var g Geofence
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatalf("Unmarshal with extra keys should not error, got: %v", err)
	}
	if g.Name != "X" {
		t.Errorf("Name = %q, want X", g.Name)
	}
	if g.PolygonWKT != "POLYGON((0 0,1 1,0 0))" {
		t.Errorf("PolygonWKT = %q, not populated from body", g.PolygonWKT)
	}
	// Even under a strict decoder the extra key is tolerated (delegated path).
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	var g2 Geofence
	if err := dec.Decode(&g2); err != nil {
		t.Fatalf("strict Decode should still tolerate extras via custom unmarshaler, got: %v", err)
	}
}

// TestGeofence_MarshalUnmarshal_SliceRoundTrip exercises the value-receiver
// Marshal + pointer-receiver Unmarshal across a slice, the exact shape the
// export envelope uses (geofences: []*Geofence).
func TestGeofence_MarshalUnmarshal_SliceRoundTrip(t *testing.T) {
	in := []*Geofence{
		{ID: 1, Name: "A", PolygonWKT: "POLYGON((0 0,1 0,1 1,0 1,0 0))", Enabled: true},
		{ID: 2, Name: "B", PolygonWKT: "POLYGON((10 10,11 10,11 11,10 11,10 10))"},
	}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal slice: %v", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var out []*Geofence
	if err := dec.Decode(&out); err != nil {
		t.Fatalf("strict Decode slice: %v", err)
	}
	if len(out) != len(in) {
		t.Fatalf("round-trip length = %d, want %d", len(out), len(in))
	}
	for i := range in {
		if out[i].ID != in[i].ID || out[i].PolygonWKT != in[i].PolygonWKT {
			t.Errorf("element %d mismatch: got %+v, want %+v", i, out[i], in[i])
		}
	}
}

// =============================================================================
// CommandExecution.IsTerminal
// =============================================================================

func TestCommandExecution_IsTerminal(t *testing.T) {
	tests := []struct {
		name   string
		status CommandStatus
		want   bool
	}{
		{"queued", CommandStatusQueued, false},
		{"running", CommandStatusRunning, false},
		{"succeeded", CommandStatusSucceeded, true},
		{"failed", CommandStatusFailed, true},
		{"timed out", CommandStatusTimedOut, true},
		{"empty", CommandStatus(""), false},
		{"unknown", CommandStatus("cancelled"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &CommandExecution{Status: tt.status}
			if got := c.IsTerminal(); got != tt.want {
				t.Errorf("IsTerminal(%q) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

func TestCommandExecution_IsTerminal_NilReceiver(t *testing.T) {
	var c *CommandExecution
	if c.IsTerminal() {
		t.Error("IsTerminal() on nil = true, want false")
	}
}

// =============================================================================
// JSON wire-contract tests — snake_case keys + omitempty nullable columns.
// The doc contract: db tag == json tag == column name, verbatim.
// =============================================================================

// assertKeys is a tiny helper: marshal v, assert every wantPresent key exists
// and every wantAbsent key does not.
func assertKeys(t *testing.T, v any, wantPresent, wantAbsent []string) {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("Unmarshal to map: %v", err)
	}
	for _, k := range wantPresent {
		if _, ok := m[k]; !ok {
			t.Errorf("missing expected key %q; got %s", k, raw)
		}
	}
	for _, k := range wantAbsent {
		if _, ok := m[k]; ok {
			t.Errorf("key %q should be omitted; got %s", k, raw)
		}
	}
}

func TestSetting_JSONContract(t *testing.T) {
	// Fully-populated → optional value/description columns present.
	full := Setting{
		Key:         "theme",
		ValueText:   strptr("dark"),
		ValueNum:    f64ptr(1.5),
		ValueBool:   func() *bool { b := true; return &b }(),
		DataKind:    SettingsKindText,
		Description: strptr("UI theme"),
	}
	assertKeys(t, full,
		[]string{"key", "value_text", "value_num", "value_bool", "data_kind", "description", "created_at", "updated_at"},
		nil)

	// Bare → nullable columns omitted.
	assertKeys(t, Setting{Key: "x", DataKind: SettingsKindNumber},
		[]string{"key", "data_kind", "created_at", "updated_at"},
		[]string{"value_text", "value_num", "value_bool", "description"})

	// Round-trip preserves the discriminated value.
	raw, _ := json.Marshal(full)
	var back Setting
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("round-trip Unmarshal: %v", err)
	}
	if back.Key != full.Key || back.DataKind != full.DataKind {
		t.Errorf("round-trip scalar mismatch: got %+v", back)
	}
	if back.ValueText == nil || *back.ValueText != "dark" {
		t.Errorf("round-trip ValueText = %v, want dark", back.ValueText)
	}
	if back.ValueNum == nil || *back.ValueNum != 1.5 {
		t.Errorf("round-trip ValueNum = %v, want 1.5", back.ValueNum)
	}
}

func TestPollingConfig_JSONContract(t *testing.T) {
	pc := PollingConfig{
		VehicleID:          42,
		AwakeIntervalSec:   30,
		AsleepIntervalSec:  900,
		DrivingIntervalSec: 5,
		Enabled:            true,
	}
	assertKeys(t, pc, []string{
		"vehicle_id", "awake_interval_sec", "asleep_interval_sec",
		"driving_interval_sec", "enabled", "created_at", "updated_at",
	}, []string{"vehicleId", "awakeIntervalSec"})

	raw, _ := json.Marshal(pc)
	var back PollingConfig
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("round-trip: %v", err)
	}
	if back != pc {
		t.Errorf("round-trip mismatch: got %+v, want %+v", back, pc)
	}
}

func TestPlace_JSONContract(t *testing.T) {
	p := Place{
		ID:        1,
		Name:      "Home",
		Latitude:  40.1,
		Longitude: -75.2,
		RadiusM:   150,
		Category:  placeCatPtr(PlaceCategoryHome),
	}
	assertKeys(t, p,
		[]string{"id", "name", "latitude", "longitude", "radius_m", "category", "created_at", "updated_at"},
		nil)
	assertKeys(t, Place{ID: 2, Name: "NoCat"},
		[]string{"id", "name", "radius_m"},
		[]string{"category"})
}

func TestElectricityCost_JSONContract(t *testing.T) {
	ec := ElectricityCost{
		ID:            1,
		Region:        "CA",
		RatePerKwh:    0.32,
		Currency:      "USD",
		EffectiveFrom: time.Now(),
	}
	assertKeys(t, ec,
		[]string{"id", "region", "start_time", "end_time", "rate_per_kwh", "currency", "effective_from", "created_at", "updated_at"},
		[]string{"effective_to"}) // nil pointer omitted

	ec.EffectiveTo = timeptr(time.Now())
	assertKeys(t, ec, []string{"effective_to"}, nil)
}

func TestGasPrice_JSONContract(t *testing.T) {
	gp := GasPrice{
		ID:             1,
		Ts:             time.Now(),
		Region:         "TX",
		Grade:          GasGradeRegular,
		PricePerGallon: 3.49,
		Currency:       "USD",
		Source:         "eia",
	}
	// GasPrice is append-only: no updated_at column.
	assertKeys(t, gp,
		[]string{"id", "ts", "region", "grade", "price_per_gallon", "currency", "source"},
		[]string{"updated_at"})
}

func TestAuditLog_JSONContract(t *testing.T) {
	al := AuditLog{ID: 1, Ts: time.Now(), Actor: "admin", Action: "update", EntityType: "vehicle"}
	assertKeys(t, al,
		[]string{"id", "ts", "actor", "action", "entity_type"},
		[]string{"entity_id", "detail", "updated_at"}) // nullable + no updated_at

	al.EntityID = i64ptr(9)
	al.Detail = strptr("changed name")
	assertKeys(t, al, []string{"entity_id", "detail"}, nil)
}

func TestCommandExecution_JSONContract(t *testing.T) {
	ce := CommandExecution{
		ID:        1,
		Ts:        time.Now(),
		VehicleID: 5,
		Command:   "wake_up",
		InvokedBy: "scheduler",
		Status:    CommandStatusQueued,
	}
	assertKeys(t, ce,
		[]string{"id", "ts", "vehicle_id", "command", "invoked_by", "status"},
		[]string{"duration_ms", "error_message"})

	ce.Status = CommandStatusFailed
	ce.DurationMs = i32ptr(1200)
	ce.ErrorMessage = strptr("boom")
	assertKeys(t, ce, []string{"duration_ms", "error_message"}, nil)
}

func TestFSMTransition_JSONContract(t *testing.T) {
	f := FSMTransition{ID: 1, Ts: time.Now(), VehicleID: 3, FromState: "asleep", ToState: "online"}
	assertKeys(t, f,
		[]string{"id", "ts", "vehicle_id", "from_state", "to_state"},
		[]string{"trigger"})

	f.Trigger = strptr("wake")
	assertKeys(t, f, []string{"trigger"}, nil)
}

func TestEmbedding_JSONContract(t *testing.T) {
	e := Embedding{
		ID:         1,
		EntityType: "drive",
		EntityID:   7,
		Embedding:  []float32{0.1, 0.2, 0.3},
		Model:      "all-MiniLM",
	}
	assertKeys(t, e,
		[]string{"id", "entity_type", "entity_id", "embedding", "model", "created_at", "updated_at"},
		nil)

	raw, _ := json.Marshal(e)
	var back Embedding
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("round-trip: %v", err)
	}
	if len(back.Embedding) != 3 || back.Embedding[1] != 0.2 {
		t.Errorf("round-trip Embedding = %v, want [0.1 0.2 0.3]", back.Embedding)
	}
}

// TestSettings_JSONContract pins the wide settings wire shape the frontend
// useSettings hook consumes: snake_case keys, no camelCase leak, omitempty on
// the two AI maps, and a lossless round-trip of scalar/slice/map fields.
func TestSettings_JSONContract(t *testing.T) {
	s := Settings{
		UnitOfLength:       "mi",
		UnitOfTemp:         "F",
		UnitOfPressure:     "psi",
		PreferredRange:     "rated",
		Language:           "en",
		BaseCostPerKWh:     0.14,
		Theme:              "dark",
		CompletedTours:     []string{"main:1"},
		DecimalPrecision:   2,
		CurrencySymbol:     "$",
		Locale:             "en-US",
		TzDisplayDefault:   "vehicle",
		FontScale:          1.1,
		FontHeadingWeight:  700,
		AIMode:             "local",
		AIFeatures:         map[string]bool{"chatbot-llm": true},
		AICostCapCents:     500,
		AIProviderConfig:   map[string]any{"openai": map[string]any{"model": "gpt"}},
		AIFeaturesArchived: map[string]bool{"vision": true},
	}
	assertKeys(t, s, []string{
		"unit_of_length", "unit_of_temp", "unit_of_pressure", "preferred_range",
		"language", "base_cost_per_kwh", "api_suspended", "theme", "mode",
		"custom_primary", "custom_accent", "completed_tours", "gas_price_per_unit",
		"gas_unit", "gas_efficiency_mpg", "decimal_precision", "quiet_hours_enabled",
		"quiet_hours_start", "quiet_hours_end", "alert_digest_mode", "currency_symbol",
		"locale", "tz_display_default", "timezone_user", "tab_badge_enabled",
		"critical_flash_enabled", "ui_density", "time_format_default", "chart_palette",
		"font_family", "font_mono", "font_custom_sans", "font_custom_mono", "font_scale",
		"font_leading", "font_tracking", "font_heading_weight", "ai_mode", "ai_features",
		"ai_cost_cap_cents", "ai_provider_config", "ai_features_archived",
	}, []string{
		// camelCase leaks would break the snake_case contract.
		"unitOfLength", "aiMode", "baseCostPerKwh", "completedTours",
	})

	// Round-trip preserves scalar, slice, and map fields.
	raw, _ := json.Marshal(s)
	var back Settings
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("round-trip Unmarshal: %v", err)
	}
	if back.UnitOfLength != "mi" || back.BaseCostPerKWh != 0.14 || back.AIMode != "local" {
		t.Errorf("round-trip scalar mismatch: got %+v", back)
	}
	if len(back.CompletedTours) != 1 || back.CompletedTours[0] != "main:1" {
		t.Errorf("round-trip CompletedTours = %v, want [main:1]", back.CompletedTours)
	}
	if !back.AIFeatures["chatbot-llm"] {
		t.Errorf("round-trip AIFeatures = %v, want chatbot-llm=true", back.AIFeatures)
	}
}

// TestSettings_JSONContract_OmitsAIMapsWhenNil pins the omitempty behaviour of
// the two AI maps (redacted/absent by default per ADR-015) while the always-on
// scalars remain present.
func TestSettings_JSONContract_OmitsAIMapsWhenNil(t *testing.T) {
	assertKeys(t, Settings{},
		[]string{"ai_mode", "ai_features", "unit_of_length"},
		[]string{"ai_provider_config", "ai_features_archived"})

	set := Settings{
		AIProviderConfig:   map[string]any{"openai": map[string]any{"model": "gpt"}},
		AIFeaturesArchived: map[string]bool{"chatbot-llm": true},
	}
	assertKeys(t, set, []string{"ai_provider_config", "ai_features_archived"}, nil)
}

// =============================================================================
// Enum value pins — these strings are DB-stored discriminators; drift would
// silently corrupt existing rows, so pin them explicitly.
// =============================================================================

func TestEnumConstantValues(t *testing.T) {
	pairs := []struct {
		got  string
		want string
	}{
		{string(SettingsKindText), "text"},
		{string(SettingsKindNumber), "number"},
		{string(SettingsKindBoolean), "boolean"},

		{string(PlaceCategoryHome), "home"},
		{string(PlaceCategoryWork), "work"},
		{string(PlaceCategoryCharging), "charging"},
		{string(PlaceCategoryCustom), "custom"},

		{string(GeofenceCategoryHome), "home"},
		{string(GeofenceCategoryWork), "work"},
		{string(GeofenceCategoryRestricted), "restricted"},
		{string(GeofenceCategoryCustom), "custom"},

		{string(GasGradeRegular), "regular"},
		{string(GasGradeMidgrade), "midgrade"},
		{string(GasGradePremium), "premium"},
		{string(GasGradeDiesel), "diesel"},

		{string(CommandStatusQueued), "queued"},
		{string(CommandStatusRunning), "running"},
		{string(CommandStatusSucceeded), "succeeded"},
		{string(CommandStatusFailed), "failed"},
		{string(CommandStatusTimedOut), "timed_out"},
	}
	for _, p := range pairs {
		if p.got != p.want {
			t.Errorf("enum value = %q, want %q", p.got, p.want)
		}
	}
}
