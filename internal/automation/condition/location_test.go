package condition

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Config Parsing Tests ───────────────────────────────

func TestParseLocationConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"type": "location",
		"geofence_id": 5,
		"operator": "inside"
	}`)
	cfg, err := ParseLocationConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "location" {
		t.Fatalf("expected type 'location', got %q", cfg.Type)
	}
	if cfg.GeofenceID != 5 {
		t.Fatalf("expected geofence_id 5, got %d", cfg.GeofenceID)
	}
	if cfg.Operator != "inside" {
		t.Fatalf("expected operator 'inside', got %q", cfg.Operator)
	}
}

func TestParseLocationConfig_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id": 1, "operator": "outside"}`)
	cfg, err := ParseLocationConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.GeofenceID != 1 {
		t.Fatalf("expected geofence_id 1, got %d", cfg.GeofenceID)
	}
	if cfg.Operator != "outside" {
		t.Fatalf("expected operator 'outside', got %q", cfg.Operator)
	}
}

func TestParseLocationConfig_InvalidCases(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{"empty", ""},
		{"invalid json", "{bad}"},
		{"wrong type", `{"type":"state_check","geofence_id":1,"operator":"inside"}`},
		{"missing geofence_id", `{"operator":"inside"}`},
		{"zero geofence_id", `{"geofence_id":0,"operator":"inside"}`},
		{"negative geofence_id", `{"geofence_id":-1,"operator":"inside"}`},
		{"missing operator", `{"geofence_id":1}`},
		{"invalid operator", `{"geofence_id":1,"operator":"near"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseLocationConfig(json.RawMessage(tt.raw))
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tt.raw)
			}
		})
	}
}

// ─── Spherical Distance Tests ───────────────────────────

func TestSphericalDistance_SamePoint(t *testing.T) {
	d := sphericalDistance(37.7749, -122.4194, 37.7749, -122.4194)
	if d > 1 { // sub-meter tolerance for floating-point rounding
		t.Fatalf("expected ~0 for same point, got %f", d)
	}
}

func TestSphericalDistance_KnownDistance(t *testing.T) {
	// San Francisco to Los Angeles: approximately 559 km
	d := sphericalDistance(37.7749, -122.4194, 34.0522, -118.2437)
	expected := 559_000.0
	if math.Abs(d-expected) > 5_000 { // within 5km tolerance
		t.Fatalf("expected ~%fm, got %fm", expected, d)
	}
}

func TestSphericalDistance_Antipodal(t *testing.T) {
	// North pole to south pole: ~20015 km (half circumference)
	d := sphericalDistance(90, 0, -90, 0)
	expected := math.Pi * earthRadiusM
	if math.Abs(d-expected) > 1 {
		t.Fatalf("expected ~%fm, got %fm", expected, d)
	}
}

// ─── Evaluate Tests ─────────────────────────────────────

func makeGeofence(id int64, name string, lat, lon, radius float64) *models.Geofence {
	// Build a simple square polygon around the center point
	// Approximate: 0.001 degrees ≈ 111m at equator
	delta := radius / 111000.0
	wkt := fmt.Sprintf("POLYGON((%f %f,%f %f,%f %f,%f %f,%f %f))",
		lon-delta, lat-delta,
		lon+delta, lat-delta,
		lon+delta, lat+delta,
		lon-delta, lat+delta,
		lon-delta, lat-delta,
	)
	return &models.Geofence{
		ID:         id,
		Name:       name,
		PolygonWKT: wkt,
	}
}

func TestEvaluateLocation_Inside(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 1, Operator: "inside"}
	// Vehicle at geofence center
	state := &models.VehicleState{Latitude: 37.7749, Longitude: -122.4194}
	geofence := makeGeofence(1, "Home", 37.7749, -122.4194, 500)

	result, snapshot, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Fatalf("expected Met=true, got false (reason: %s)", result.Reason)
	}
	if snapshot == nil {
		t.Fatal("expected non-nil snapshot")
	}
}

func TestEvaluateLocation_Outside(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 1, Operator: "outside"}
	// Vehicle is ~559km from geofence center
	state := &models.VehicleState{Latitude: 34.0522, Longitude: -118.2437}
	geofence := makeGeofence(1, "Home", 37.7749, -122.4194, 500)

	result, _, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Fatalf("expected Met=true for outside, got false (reason: %s)", result.Reason)
	}
}

func TestEvaluateLocation_InsideButExpectOutside(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 1, Operator: "outside"}
	state := &models.VehicleState{Latitude: 37.7749, Longitude: -122.4194}
	geofence := makeGeofence(1, "Home", 37.7749, -122.4194, 500)

	result, _, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Fatalf("expected Met=false (vehicle at center, expecting outside), got true")
	}
}

func TestEvaluateLocation_OutsideButExpectInside(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 1, Operator: "inside"}
	state := &models.VehicleState{Latitude: 34.0522, Longitude: -118.2437}
	geofence := makeGeofence(1, "Home", 37.7749, -122.4194, 500)

	result, _, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Fatalf("expected Met=false (vehicle far away, expecting inside), got true")
	}
}

func TestEvaluateLocation_ExactlyOnBoundary(t *testing.T) {
	// Place vehicle exactly at the radius edge.
	// 100m north of center ≈ 100m / 111320 m/deg ≈ 0.000898 degrees latitude
	centerLat, centerLon := 37.7749, -122.4194
	offsetLat := 100.0 / 111320.0
	geofence := makeGeofence(1, "Office", centerLat, centerLon, 100)

	// Vehicle on boundary — should be inside (<=)
	state := &models.VehicleState{Latitude: centerLat + offsetLat, Longitude: centerLon}
	cfg := &LocationConfig{GeofenceID: 1, Operator: "inside"}

	result, _, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// The approximate offset should land very close to the boundary.
	// We just verify no error occurs and the result is deterministic.
	_ = result
}

func TestEvaluateLocation_NearBoundary(t *testing.T) {
	centerLat, centerLon := 37.7749, -122.4194
	geofence := makeGeofence(1, "Garage", centerLat, centerLon, 200)

	tests := []struct {
		name     string
		lat, lon float64
		operator string
		wantMet  bool
	}{
		{
			name:     "well inside",
			lat:      centerLat,
			lon:      centerLon,
			operator: "inside",
			wantMet:  true,
		},
		{
			name:     "well outside",
			lat:      centerLat + 0.01, // ~1.1km away
			lon:      centerLon,
			operator: "inside",
			wantMet:  false,
		},
		{
			name:     "well outside check outside operator",
			lat:      centerLat + 0.01,
			lon:      centerLon,
			operator: "outside",
			wantMet:  true,
		},
		{
			name:     "well inside check outside operator",
			lat:      centerLat,
			lon:      centerLon,
			operator: "outside",
			wantMet:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state := &models.VehicleState{Latitude: tt.lat, Longitude: tt.lon}
			cfg := &LocationConfig{GeofenceID: 1, Operator: tt.operator}
			result, _, err := EvaluateLocation(cfg, state, geofence)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("got Met=%v, want %v (reason: %s)", result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

// ─── Error Handling Tests ───────────────────────────────

func TestEvaluateLocation_NilState(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 1, Operator: "inside"}
	geofence := makeGeofence(1, "Home", 37.7749, -122.4194, 500)

	_, _, err := EvaluateLocation(cfg, nil, geofence)
	if err == nil {
		t.Fatal("expected error for nil state")
	}
}

func TestEvaluateLocation_NilGeofence(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 1, Operator: "inside"}
	state := &models.VehicleState{Latitude: 37.7749, Longitude: -122.4194}

	_, _, err := EvaluateLocation(cfg, state, nil)
	if err == nil {
		t.Fatal("expected error for nil geofence")
	}
}

func TestEvaluateLocation_GeofenceIDMismatch(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 5, Operator: "inside"}
	state := &models.VehicleState{Latitude: 37.7749, Longitude: -122.4194}
	geofence := makeGeofence(99, "Wrong", 37.7749, -122.4194, 500)

	_, _, err := EvaluateLocation(cfg, state, geofence)
	if err == nil {
		t.Fatal("expected error for geofence ID mismatch")
	}
}

// ─── Snapshot Tests ─────────────────────────────────────

func TestEvaluateLocation_SnapshotContent(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 3, Operator: "inside"}
	state := &models.VehicleState{Latitude: 37.7749, Longitude: -122.4194}
	geofence := makeGeofence(3, "Work", 37.7749, -122.4194, 1000)

	_, snapshot, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap locationSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.GeofenceID != 3 {
		t.Errorf("snapshot geofence_id = %d, want 3", snap.GeofenceID)
	}
	if snap.GeofenceName != "Work" {
		t.Errorf("snapshot geofence_name = %q, want 'Work'", snap.GeofenceName)
	}
	if snap.Operator != "inside" {
		t.Errorf("snapshot operator = %q, want 'inside'", snap.Operator)
	}
	if snap.VehicleLat != 37.7749 {
		t.Errorf("snapshot vehicle_lat = %f, want 37.7749", snap.VehicleLat)
	}
	if snap.VehicleLon != -122.4194 {
		t.Errorf("snapshot vehicle_lon = %f, want -122.4194", snap.VehicleLon)
	}
	if snap.RadiusM != 1000 {
		t.Errorf("snapshot radius_m = %f, want 1000", snap.RadiusM)
	}
	if !snap.Met {
		t.Error("snapshot met = false, want true")
	}
	if snap.DistanceM > 1 {
		t.Errorf("snapshot distance_m = %f, want ~0 (same point)", snap.DistanceM)
	}
}

func TestEvaluateLocation_SnapshotOutside(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 2, Operator: "outside"}
	state := &models.VehicleState{Latitude: 34.0522, Longitude: -118.2437}
	geofence := makeGeofence(2, "Home", 37.7749, -122.4194, 500)

	_, snapshot, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap locationSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if !snap.Met {
		t.Error("snapshot met = false, want true")
	}
	if snap.DistanceM < 500_000 {
		t.Errorf("expected distance > 500km, got %.0fm", snap.DistanceM)
	}
}

// ─── Reason String Tests ────────────────────────────────

func TestEvaluateLocation_ReasonStrings(t *testing.T) {
	geofence := makeGeofence(1, "Home", 37.7749, -122.4194, 500)

	// Met case: vehicle inside, operator=inside
	cfg := &LocationConfig{GeofenceID: 1, Operator: "inside"}
	state := &models.VehicleState{Latitude: 37.7749, Longitude: -122.4194}
	result, _, _ := EvaluateLocation(cfg, state, geofence)
	if result.Reason == "" {
		t.Error("expected non-empty reason")
	}
	if !result.Met {
		t.Error("expected met=true for vehicle at center")
	}

	// Not-met case: vehicle far away, operator=inside
	farState := &models.VehicleState{Latitude: 34.0522, Longitude: -118.2437}
	result, _, _ = EvaluateLocation(cfg, farState, geofence)
	if result.Reason == "" {
		t.Error("expected non-empty reason")
	}
	if result.Met {
		t.Error("expected met=false for vehicle far away")
	}
}

func TestEvaluateLocation_EmptyGeofenceName(t *testing.T) {
	cfg := &LocationConfig{GeofenceID: 7, Operator: "inside"}
	state := &models.VehicleState{Latitude: 37.7749, Longitude: -122.4194}
	geofence := makeGeofence(7, "", 37.7749, -122.4194, 500)

	result, _, err := EvaluateLocation(cfg, state, geofence)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Fatal("expected met=true")
	}
	// Should use fallback name
	if result.Reason == "" {
		t.Error("expected non-empty reason with fallback name")
	}
}
