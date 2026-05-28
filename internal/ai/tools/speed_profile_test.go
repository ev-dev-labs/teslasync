// Phase-50 / 0022 — D2 Speed-profile insights.
//
// speed_profile_test.go covers the new query_speed_profile +
// query_drive_context tools and the RegisterSpeedProfileInsightsTools
// wiring. Mirrors the shape of drive_coaching_test.go and
// charging_diagnosis_test.go. Reuses the shared fakeDrives source
// from builtins_test.go and the failingDrivesImpl from
// drive_coaching_test.go so the existing drive-domain tools and
// these new tools share the same test substrate.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// failingDrivesImpl is a local test-only DriveSource that returns
// getByIDErr on every GetByID call. Originally lived in
// drive_coaching_test.go; duplicated here after the R6.25 carve of
// drive_coaching → coaching/ (this parent test cannot import the
// subpkg without inducing a parent→child→parent test cycle).
type failingDrivesImpl struct {
	fakeDrives
	getByIDErr error
}

func (f *failingDrivesImpl) GetByID(_ context.Context, _ int64) (*drivemodel.Drive, error) {
	return nil, f.getByIDErr
}

// TestRegisterSpeedProfileInsightsTools_RegistersBothTools proves
// the wiring helper installs the two new tools on a fresh registry.
// Mirrors the existing RegisterDriveCoachingTools test pattern.
func TestRegisterSpeedProfileInsightsTools_RegistersBothTools(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterSpeedProfileInsightsTools(r, SpeedProfileInsightsSources{Drives: &fakeDrives{}})
	for _, name := range []string{"query_speed_profile", "query_drive_context"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("RegisterSpeedProfileInsightsTools did not register %q", name)
		}
	}
}

// TestRegisterSpeedProfileInsightsTools_DoesNotShadowBuiltins proves
// that installing the new tools AFTER the 12 builtins + the
// digest/year-review/anomaly/drive-coaching tools keeps every
// previously-registered tool reachable. Defends against an
// accidental same-name collision.
func TestRegisterSpeedProfileInsightsTools_DoesNotShadowBuiltins(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	RegisterSpeedProfileInsightsTools(r, SpeedProfileInsightsSources{Drives: &fakeDrives{}})

	for _, name := range BuiltinNames {
		if _, ok := r.Get(name); !ok {
			t.Errorf("builtin %q lost after RegisterSpeedProfileInsightsTools", name)
		}
	}
	for _, name := range []string{
		"query_speed_profile",
		"query_drive_context",
	} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("tool %q missing after full registration", name)
		}
	}
}

// TestQuerySpeedProfile_NameDescriptionMutates pins the tool's
// static metadata. A regression that flips Mutates() (or renames the
// tool out from under the strategy whitelist) fails here.
func TestQuerySpeedProfile_NameDescriptionMutates(t *testing.T) {
	t.Parallel()
	tool := &querySpeedProfile{src: &fakeDrives{}}
	if got := tool.Name(); got != "query_speed_profile" {
		t.Errorf("Name() = %q, want %q", got, "query_speed_profile")
	}
	if tool.Description() == "" {
		t.Error("Description() returned empty string")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true; speed-profile-insights tool MUST be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// TestQueryDriveContext_NameDescriptionMutates pins the second
// tool's static metadata.
func TestQueryDriveContext_NameDescriptionMutates(t *testing.T) {
	t.Parallel()
	tool := &queryDriveContext{src: &fakeDrives{}}
	if got := tool.Name(); got != "query_drive_context" {
		t.Errorf("Name() = %q, want %q", got, "query_drive_context")
	}
	if tool.Description() == "" {
		t.Error("Description() returned empty string")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true; speed-profile-insights tool MUST be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// TestQuerySpeedProfile_ValidateRejectsBadInput proves the validator
// catches missing / non-positive drive_id BEFORE Execute runs.
func TestQuerySpeedProfile_ValidateRejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &querySpeedProfile{src: &fakeDrives{}}

	cases := []struct {
		name string
		raw  string
	}{
		{"missing drive_id", `{}`},
		{"zero drive_id", `{"drive_id": 0}`},
		{"negative drive_id", `{"drive_id": -1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tool.Validate(json.RawMessage(tc.raw))
			if err == nil {
				t.Fatalf("Validate(%q) = nil err, want validation error", tc.raw)
			}
		})
	}
}

// TestQueryDriveContext_ValidateRejectsBadInput mirrors the input
// validation contract for the context tool.
func TestQueryDriveContext_ValidateRejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &queryDriveContext{src: &fakeDrives{}}

	cases := []string{`{}`, `{"drive_id": 0}`, `{"drive_id": -1}`}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			_, err := tool.Validate(json.RawMessage(raw))
			if err == nil {
				t.Fatalf("Validate(%q) = nil err, want validation error", raw)
			}
		})
	}
}

// TestQuerySpeedProfile_ExecuteHappyPathHighway is the core
// behavioural test: the tool propagates drive_id to the DriveSource,
// classifies a highway-speed drive correctly, and computes the
// derived kmh/mph fields the LLM's narration depends on.
func TestQuerySpeedProfile_ExecuteHappyPathHighway(t *testing.T) {
	t.Parallel()

	// 30 m/s = highway regime (60-90 mph band: 26.8224 <= v < 40.2336)
	avgSpeed := 30.0
	maxSpeed := 33.0
	avgPower := 18000.0
	energyUsedWh := 14000.0

	src := &fakeDrives{
		one: map[int64]*drivemodel.Drive{
			702: {
				ID:           702,
				VehicleID:    1,
				DurationS:    6300,
				DistanceM:    180000,
				EnergyUsedWh: &energyUsedWh,
				AvgSpeedMps:  &avgSpeed,
				MaxSpeedMps:  &maxSpeed,
				AvgPowerW:    &avgPower,
			},
		},
	}
	tool := &querySpeedProfile{src: src}

	in, err := tool.Validate(json.RawMessage(`{"drive_id": 702}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	envelope := out.(map[string]any)

	if envelope["drive_id"].(int64) != 702 {
		t.Errorf("drive_id = %v, want 702", envelope["drive_id"])
	}
	if envelope["vehicle_id"].(int64) != 1 {
		t.Errorf("vehicle_id = %v, want 1", envelope["vehicle_id"])
	}
	// 30 m/s sits in the highway band (26.8224 <= v < 40.2336).
	if got := envelope["speed_regime"].(string); got != "highway" {
		t.Errorf("speed_regime = %q, want %q", got, "highway")
	}
	if envelope["speed_regime_label"].(string) != "Highway (60-90 mph)" {
		t.Errorf("speed_regime_label = %v, want %q", envelope["speed_regime_label"], "Highway (60-90 mph)")
	}
	if got := envelope["avg_speed_kmh"].(float64); got < 107.99 || got > 108.01 {
		t.Errorf("avg_speed_kmh = %v, want ~108", got)
	}
	if got := envelope["avg_speed_mph"].(float64); got < 67.1 || got > 67.2 {
		t.Errorf("avg_speed_mph = %v, want ~67.1", got)
	}
	// kwh_per_100km = (14000/1000) / (180000/100000) = 14/1.8 ≈ 7.78
	if got := envelope["kwh_per_100km"].(float64); got < 7.7 || got > 7.8 {
		t.Errorf("kwh_per_100km = %v, want ~7.78", got)
	}
}

// TestQuerySpeedProfile_RegimeThresholdsMatchAnalytics pins the
// regime ceiling constants to the IDENTICAL values used by the
// deterministic SQL CASE in internal/api/speed_profile_handler.go. A
// future PR that drifts one without the other will fail this test
// before the LLM narration silently disagrees with the chart on the
// same page.
//
// 13.4112 / 26.8224 / 40.2336 mps correspond to 30 / 60 / 90 mph
// (1 mph = 0.44704 mps, exact).
func TestQuerySpeedProfile_RegimeThresholdsMatchAnalytics(t *testing.T) {
	t.Parallel()
	if speedRegimeCityCeilingMps != 13.4112 {
		t.Errorf("speedRegimeCityCeilingMps = %v, want 13.4112 (30 mph)", speedRegimeCityCeilingMps)
	}
	if speedRegimeSuburbanCeilingMps != 26.8224 {
		t.Errorf("speedRegimeSuburbanCeilingMps = %v, want 26.8224 (60 mph)", speedRegimeSuburbanCeilingMps)
	}
	if speedRegimeHighwayCeilingMps != 40.2336 {
		t.Errorf("speedRegimeHighwayCeilingMps = %v, want 40.2336 (90 mph)", speedRegimeHighwayCeilingMps)
	}
}

// TestClassifySpeedRegime_EdgeCases pins regime boundaries
// inclusive-low / exclusive-high so a value exactly at a ceiling
// rolls UP to the next band, matching the SQL CASE behaviour.
func TestClassifySpeedRegime_EdgeCases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		mps       *float64
		wantKey   string
		wantLabel string
	}{
		{"nil → unknown", nil, "unknown", "Unknown"},
		{"0 m/s → city", float64Ptr(0), "city", "City (<30 mph)"},
		{"13.41 m/s (just under 30 mph) → city", float64Ptr(13.41), "city", "City (<30 mph)"},
		{"13.4112 m/s (exactly 30 mph) → suburban", float64Ptr(13.4112), "suburban", "Suburban (30-60 mph)"},
		{"20 m/s → suburban", float64Ptr(20), "suburban", "Suburban (30-60 mph)"},
		{"26.8224 m/s (exactly 60 mph) → highway", float64Ptr(26.8224), "highway", "Highway (60-90 mph)"},
		{"35 m/s → highway", float64Ptr(35), "highway", "Highway (60-90 mph)"},
		{"40.2336 m/s (exactly 90 mph) → high_speed", float64Ptr(40.2336), "high_speed", "High Speed (90+ mph)"},
		{"50 m/s → high_speed", float64Ptr(50), "high_speed", "High Speed (90+ mph)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotKey, gotLabel := classifySpeedRegime(tc.mps)
			if gotKey != tc.wantKey {
				t.Errorf("regime key = %q, want %q", gotKey, tc.wantKey)
			}
			if gotLabel != tc.wantLabel {
				t.Errorf("regime label = %q, want %q", gotLabel, tc.wantLabel)
			}
		})
	}
}

// TestQuerySpeedProfile_NilAggregatesPropagateAsNull proves that nil
// drive aggregates appear as JSON nulls in the envelope — NOT as
// zero values — so the LLM can distinguish "we don't know" from
// "the value is exactly zero".
func TestQuerySpeedProfile_NilAggregatesPropagateAsNull(t *testing.T) {
	t.Parallel()

	src := &fakeDrives{
		one: map[int64]*drivemodel.Drive{
			888: {
				ID:        888,
				VehicleID: 1,
				DurationS: 600,
				DistanceM: 0, // stationary "drive"
				// All optional pointers nil.
			},
		},
	}
	tool := &querySpeedProfile{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 888}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	envelope := out.(map[string]any)

	for _, key := range []string{
		"avg_speed_mps", "max_speed_mps",
		"avg_speed_kmh", "max_speed_kmh",
		"avg_speed_mph", "max_speed_mph",
		"avg_power_w", "energy_used_wh",
		"kwh_per_100km",
	} {
		if envelope[key] != nil {
			t.Errorf("envelope[%q] = %v (%T), want nil", key, envelope[key], envelope[key])
		}
	}
	// Regime falls back to unknown when avg speed is nil.
	if got := envelope["speed_regime"].(string); got != "unknown" {
		t.Errorf("speed_regime on nil-aggregate drive = %q, want %q", got, "unknown")
	}
}

// TestQuerySpeedProfile_NoSourceWired and _DriveNotFound and
// _GetByIDError mirror the equivalent contracts on the coaching tool.
func TestQuerySpeedProfile_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &querySpeedProfile{src: nil}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 1}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute with nil DriveSource: err = nil, want error")
	}
}

func TestQuerySpeedProfile_DriveNotFound(t *testing.T) {
	t.Parallel()
	src := &fakeDrives{one: map[int64]*drivemodel.Drive{}}
	tool := &querySpeedProfile{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 99}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute with missing drive: err = nil, want error")
	}
}

func TestQuerySpeedProfile_GetByIDError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("connection refused")
	src := &failingDrivesImpl{getByIDErr: wantErr}
	tool := &querySpeedProfile{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 1}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute with failing source: err = nil, want wrapped error")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("Execute err does not wrap source err: got=%v, want wraps %v", err, wantErr)
	}
}

// TestBuildDriveContext_ExcludesPreciseRouteData is the
// privacy-by-default pin. The context tool MUST NOT return
// lat/lon/address strings; presence flags are the only surface.
// A regression that adds a `start_lat` or `start_address` key would
// silently leak coordinates through tool output, bypassing the
// per-feature redaction policy.
func TestBuildDriveContext_ExcludesPreciseRouteData(t *testing.T) {
	t.Parallel()

	startAddr := "1 Main St, Anytown"
	endAddr := "100 High St, Othertown"
	startLat, startLon := 40.7128, -74.0060
	endLat, endLon := 34.0522, -118.2437
	temp := 18.0
	startBat := int16(85)
	endBat := int16(60)
	endStatus := "completed"

	d := &drivemodel.Drive{
		ID:              701,
		VehicleID:       1,
		StartTs:         time.Date(2024, 6, 1, 8, 0, 0, 0, time.UTC),
		DurationS:       1440,
		DistanceM:       9000,
		StartAddress:    &startAddr,
		EndAddress:      &endAddr,
		StartLat:        &startLat,
		StartLon:        &startLon,
		EndLat:          &endLat,
		EndLon:          &endLon,
		StartBatteryPct: &startBat,
		EndBatteryPct:   &endBat,
		OutsideTempAvgC: &temp,
		EndedStatus:     &endStatus,
	}

	envelope := buildDriveContext(d)

	// Presence flags must be set.
	if envelope["has_start_address"].(bool) != true {
		t.Errorf("has_start_address = %v, want true", envelope["has_start_address"])
	}
	if envelope["has_end_address"].(bool) != true {
		t.Errorf("has_end_address = %v, want true", envelope["has_end_address"])
	}
	if envelope["has_route_coordinates"].(bool) != true {
		t.Errorf("has_route_coordinates = %v, want true", envelope["has_route_coordinates"])
	}

	// And the raw strings + lat/lon MUST be absent — a failing
	// regression here would silently leak the user's home/work
	// addresses through tool output.
	for _, forbidden := range []string{
		"start_address", "end_address",
		"start_lat", "start_lon", "end_lat", "end_lon",
	} {
		if _, present := envelope[forbidden]; present {
			t.Errorf("envelope contains forbidden key %q (value = %v); this would leak route geometry", forbidden, envelope[forbidden])
		}
	}

	// Sanity: ensure the non-private fields are populated.
	if envelope["started_at"].(string) != "2024-06-01T08:00:00Z" {
		t.Errorf("started_at = %v, want %q", envelope["started_at"], "2024-06-01T08:00:00Z")
	}
	if envelope["battery_consumed_pct"].(int16) != 25 {
		t.Errorf("battery_consumed_pct = %v, want 25", envelope["battery_consumed_pct"])
	}
}

// TestBuildDriveContext_NilAddressesPresenceFalse pins the
// presence-flag contract when the underlying columns are NULL.
func TestBuildDriveContext_NilAddressesPresenceFalse(t *testing.T) {
	t.Parallel()
	d := &drivemodel.Drive{
		ID:        702,
		VehicleID: 1,
		StartTs:   time.Date(2024, 6, 2, 9, 0, 0, 0, time.UTC),
		DurationS: 60,
		DistanceM: 100,
	}
	envelope := buildDriveContext(d)
	if envelope["has_start_address"].(bool) != false {
		t.Errorf("has_start_address = %v, want false on nil column", envelope["has_start_address"])
	}
	if envelope["has_end_address"].(bool) != false {
		t.Errorf("has_end_address = %v, want false on nil column", envelope["has_end_address"])
	}
	if envelope["has_route_coordinates"].(bool) != false {
		t.Errorf("has_route_coordinates = %v, want false on nil columns", envelope["has_route_coordinates"])
	}
	if envelope["ended_at"] != nil {
		t.Errorf("ended_at = %v, want nil for in-progress drive", envelope["ended_at"])
	}
	if envelope["battery_consumed_pct"] != nil {
		t.Errorf("battery_consumed_pct = %v, want nil when start/end battery unknown", envelope["battery_consumed_pct"])
	}
}

// TestQueryDriveContext_ExecuteHappyPath proves the end-to-end
// Execute path resolves DriveSource and wraps buildDriveContext.
func TestQueryDriveContext_ExecuteHappyPath(t *testing.T) {
	t.Parallel()

	startAddr := "Home"
	startBat := int16(90)
	endBat := int16(75)

	src := &fakeDrives{
		one: map[int64]*drivemodel.Drive{
			703: {
				ID:              703,
				VehicleID:       1,
				StartTs:         time.Date(2024, 6, 3, 10, 0, 0, 0, time.UTC),
				DurationS:       300,
				DistanceM:       5000,
				StartAddress:    &startAddr,
				StartBatteryPct: &startBat,
				EndBatteryPct:   &endBat,
			},
		},
	}
	tool := &queryDriveContext{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 703}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	envelope := out.(map[string]any)
	if envelope["drive_id"].(int64) != 703 {
		t.Errorf("drive_id = %v, want 703", envelope["drive_id"])
	}
	if envelope["has_start_address"].(bool) != true {
		t.Error("has_start_address should be true for non-empty StartAddress")
	}
	if envelope["has_end_address"].(bool) != false {
		t.Error("has_end_address should be false for nil EndAddress")
	}
	if envelope["battery_consumed_pct"].(int16) != 15 {
		t.Errorf("battery_consumed_pct = %v, want 15", envelope["battery_consumed_pct"])
	}
}

// TestQueryDriveContext_NoSourceWired_DriveNotFound_GetByIDError
// covers the three error paths in a single table.
func TestQueryDriveContext_ErrorPaths(t *testing.T) {
	t.Parallel()

	t.Run("nil source", func(t *testing.T) {
		tool := &queryDriveContext{src: nil}
		in, _ := tool.Validate(json.RawMessage(`{"drive_id": 1}`))
		if _, err := tool.Execute(context.Background(), in); err == nil {
			t.Fatal("Execute with nil DriveSource: err = nil, want error")
		}
	})

	t.Run("drive not found", func(t *testing.T) {
		tool := &queryDriveContext{src: &fakeDrives{one: map[int64]*drivemodel.Drive{}}}
		in, _ := tool.Validate(json.RawMessage(`{"drive_id": 99}`))
		if _, err := tool.Execute(context.Background(), in); err == nil {
			t.Fatal("Execute with missing drive: err = nil, want error")
		}
	})

	t.Run("source error wrapped", func(t *testing.T) {
		wantErr := errors.New("connection refused")
		tool := &queryDriveContext{src: &failingDrivesImpl{getByIDErr: wantErr}}
		in, _ := tool.Validate(json.RawMessage(`{"drive_id": 1}`))
		_, err := tool.Execute(context.Background(), in)
		if err == nil {
			t.Fatal("Execute with failing source: err = nil, want wrapped error")
		}
		if !errors.Is(err, wantErr) {
			t.Errorf("Execute err does not wrap source err: got=%v, want wraps %v", err, wantErr)
		}
	})
}

// --- helpers ---------------------------------------------------------

func float64Ptr(v float64) *float64 { return &v }
