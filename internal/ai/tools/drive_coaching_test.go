// Phase-50 / 0018 — N4 Per-drive coaching narrative.
//
// drive_coaching_test.go covers the new query_drive_telemetry_summary
// tool + the RegisterDriveCoachingTools wiring. Mirrors the shape of
// digest_test.go (slice 0012) and anomaly_test.go (slice 0014). Reuses
// the shared fakeDrives source from builtins_test.go so the
// query_drive_detail builtin and this new tool share the same test
// substrate.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// failingDrivesImpl wraps the real DriveSource signature properly via
// reuse of the shared fake. Embedding fakeDrives lets us inherit its
// GetByVehicle signature; the override below supplies the IO error
// on every GetByID call so the tool's error wrapping path is
// exercised.
type failingDrivesImpl struct {
	fakeDrives
	getByIDErr error
}

func (f *failingDrivesImpl) GetByID(_ context.Context, _ int64) (*drivemodel.Drive, error) {
	return nil, f.getByIDErr
}

// TestRegisterDriveCoachingTools_RegistersTool proves the wiring
// helper installs the new tool on a fresh registry. Mirrors the
// existing RegisterAnomalyTools / RegisterDigestTools test pattern.
func TestRegisterDriveCoachingTools_RegistersTool(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterDriveCoachingTools(r, DriveCoachingSources{Drives: &fakeDrives{}})
	if _, ok := r.Get("query_drive_telemetry_summary"); !ok {
		t.Fatal("RegisterDriveCoachingTools did not register query_drive_telemetry_summary")
	}
}

// TestRegisterDriveCoachingTools_DoesNotShadowBuiltins proves that
// installing the drive-coaching tool AFTER the 12 builtins + the
// digest / year-review / anomaly tools keeps every previously-
// registered tool reachable. Defends against an accidental same-name
// collision.
func TestRegisterDriveCoachingTools_DoesNotShadowBuiltins(t *testing.T) {
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
	RegisterDigestTools(r, DigestSources{
		Drives:  &fakeDrives{},
		Charges: &fakeCharges{},
	})
	RegisterYearReviewTools(r, YearReviewSources{
		Drives:  &fakeDrives{},
		Charges: &fakeCharges{},
	})
	RegisterAnomalyTools(r, AnomalySources{Anomaly: &fakeAnomalySource{}})
	RegisterDriveCoachingTools(r, DriveCoachingSources{Drives: &fakeDrives{}})

	for _, name := range BuiltinNames {
		if _, ok := r.Get(name); !ok {
			t.Errorf("builtin %q lost after RegisterDriveCoachingTools", name)
		}
	}
	for _, name := range []string{
		"query_weekly_digest_context",
		"query_year_in_review_context",
		"query_anomaly_context",
		"query_drive_telemetry_summary",
	} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("tool %q missing after full registration", name)
		}
	}
}

// TestQueryDriveTelemetrySummary_NameDescriptionMutates pins the
// tool's static metadata. A regression that flips Mutates() (or
// renames the tool out from under the strategy whitelist) fails
// here.
func TestQueryDriveTelemetrySummary_NameDescriptionMutates(t *testing.T) {
	t.Parallel()
	tool := &queryDriveTelemetrySummary{src: &fakeDrives{}}
	if got := tool.Name(); got != "query_drive_telemetry_summary" {
		t.Errorf("Name() = %q, want %q", got, "query_drive_telemetry_summary")
	}
	if tool.Description() == "" {
		t.Error("Description() returned empty string")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true; drive-coaching tool MUST be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// TestQueryDriveTelemetrySummary_ValidateRejectsBadInput proves the
// validator catches missing / non-positive drive_id BEFORE Execute
// runs. The dispatcher's confirm gate would never catch a typed
// input error — that's the validator's job.
func TestQueryDriveTelemetrySummary_ValidateRejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &queryDriveTelemetrySummary{src: &fakeDrives{}}

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

// TestQueryDriveTelemetrySummary_ValidateAcceptsCanonical proves the
// happy-path input shapes decode correctly.
func TestQueryDriveTelemetrySummary_ValidateAcceptsCanonical(t *testing.T) {
	t.Parallel()
	tool := &queryDriveTelemetrySummary{src: &fakeDrives{}}

	cases := []string{
		`{"drive_id": 1}`,
		`{"drive_id": 101}`,
		`{"drive_id": 999999999}`,
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(raw)); err != nil {
				t.Fatalf("Validate(%q) = %v, want nil", raw, err)
			}
		})
	}
}

// TestQueryDriveTelemetrySummary_ExecuteHappyPath is the core
// behavioural test: the tool propagates drive_id to the DriveSource,
// shapes the result into the canonical envelope, and computes the
// derived fields (regen_share_pct, kwh_per_100km,
// battery_consumed_pct) the LLM's narration depends on.
func TestQueryDriveTelemetrySummary_ExecuteHappyPath(t *testing.T) {
	t.Parallel()

	energyUsedWh := 5800.0
	regenWh := 1200.0
	avgSpeed := 15.5
	maxSpeed := 30.0
	avgPower := 12000.0
	startBat := int16(85)
	endBat := int16(70)
	outsideTemp := 18.5
	endedStatus := "completed"

	src := &fakeDrives{
		one: map[int64]*drivemodel.Drive{
			101: {
				ID:              101,
				VehicleID:       1,
				DurationS:       2460,
				DistanceM:       38400,
				EnergyUsedWh:    &energyUsedWh,
				RegenEnergyWh:   &regenWh,
				AvgSpeedMps:     &avgSpeed,
				MaxSpeedMps:     &maxSpeed,
				AvgPowerW:       &avgPower,
				StartBatteryPct: &startBat,
				EndBatteryPct:   &endBat,
				OutsideTempAvgC: &outsideTemp,
				EndedStatus:     &endedStatus,
			},
		},
	}
	tool := &queryDriveTelemetrySummary{src: src}

	in, err := tool.Validate(json.RawMessage(`{"drive_id": 101}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	envelope, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", out)
	}

	// Pin every field a goldens.yaml answer_must_contain assertion
	// could be derived from, so a regression that changes the
	// envelope shape fails here before the eval harness's diff.
	wantInt64 := func(key string, want int64) {
		t.Helper()
		got, ok := envelope[key].(int64)
		if !ok {
			t.Errorf("envelope[%q] = %T(%v), want int64", key, envelope[key], envelope[key])
			return
		}
		if got != want {
			t.Errorf("envelope[%q] = %d, want %d", key, got, want)
		}
	}
	wantFloat := func(key string, want, tol float64) {
		t.Helper()
		got, ok := envelope[key].(float64)
		if !ok {
			t.Errorf("envelope[%q] = %T(%v), want float64", key, envelope[key], envelope[key])
			return
		}
		if got < want-tol || got > want+tol {
			t.Errorf("envelope[%q] = %v, want %v ±%v", key, got, want, tol)
		}
	}

	wantInt64("drive_id", 101)
	wantInt64("vehicle_id", 1)
	wantFloat("distance_m", 38400, 0.5)
	wantInt64("duration_s", 2460)
	wantFloat("avg_speed_mps", 15.5, 0.001)
	wantFloat("max_speed_mps", 30.0, 0.001)
	wantFloat("avg_power_w", 12000, 0.5)
	wantFloat("energy_used_wh", 5800, 0.5)
	wantFloat("regen_energy_wh", 1200, 0.5)
	// regen_share_pct = 1200 / (5800 + 1200) * 100 = 17.142857...
	wantFloat("regen_share_pct", 17.142857, 0.001)
	// kwh_per_100km = (5800 / 1000) / (38400 / 100000)
	//               = 5.8 / 0.384 = 15.10416666...
	wantFloat("kwh_per_100km", 15.104166, 0.001)
	if got, ok := envelope["start_battery_pct"].(int16); !ok || got != 85 {
		t.Errorf("envelope[start_battery_pct] = %v, want 85", envelope["start_battery_pct"])
	}
	if got, ok := envelope["end_battery_pct"].(int16); !ok || got != 70 {
		t.Errorf("envelope[end_battery_pct] = %v, want 70", envelope["end_battery_pct"])
	}
	if got, ok := envelope["battery_consumed_pct"].(int16); !ok || got != 15 {
		t.Errorf("envelope[battery_consumed_pct] = %v, want 15", envelope["battery_consumed_pct"])
	}
	wantFloat("outside_temp_avg_c", 18.5, 0.001)
	wantFloat("outside_temp_avg_f", 65.3, 0.001) // (18.5 × 9/5) + 32 = 65.3
	if got, ok := envelope["ended_status"].(string); !ok || got != "completed" {
		t.Errorf("envelope[ended_status] = %v, want %q", envelope["ended_status"], "completed")
	}
}

// TestQueryDriveTelemetrySummary_NilAggregatesPropagateAsNull proves
// that nil drive aggregates appear as JSON nulls in the envelope —
// NOT as zero values — so the LLM can distinguish "we don't know"
// from "the value is exactly zero".
func TestQueryDriveTelemetrySummary_NilAggregatesPropagateAsNull(t *testing.T) {
	t.Parallel()

	src := &fakeDrives{
		one: map[int64]*drivemodel.Drive{
			202: {
				ID:        202,
				VehicleID: 1,
				DurationS: 600,
				DistanceM: 0, // stationary "drive"
				// All optional pointers nil.
			},
		},
	}
	tool := &queryDriveTelemetrySummary{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 202}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	envelope := out.(map[string]any)

	// All these MUST be JSON null, not zero.
	for _, key := range []string{
		"avg_speed_mps", "max_speed_mps", "avg_power_w",
		"energy_used_wh", "regen_energy_wh",
		"regen_share_pct", "kwh_per_100km",
		"start_battery_pct", "end_battery_pct", "battery_consumed_pct",
		"outside_temp_avg_c", "outside_temp_avg_f", "ended_status",
	} {
		if envelope[key] != nil {
			t.Errorf("envelope[%q] = %v (%T), want nil", key, envelope[key], envelope[key])
		}
	}
	// The non-optional aggregates should remain present.
	if envelope["distance_m"].(float64) != 0 {
		t.Errorf("envelope[distance_m] = %v, want 0", envelope["distance_m"])
	}
	if envelope["duration_s"].(int64) != 600 {
		t.Errorf("envelope[duration_s] = %v, want 600", envelope["duration_s"])
	}
}

// TestQueryDriveTelemetrySummary_RegenShareNilOnZeroEnvelope proves
// the divide-by-zero guard. A drive where energy_used + regen sums
// to zero MUST surface regen_share_pct=null rather than NaN/Inf.
func TestQueryDriveTelemetrySummary_RegenShareNilOnZeroEnvelope(t *testing.T) {
	t.Parallel()

	zero := 0.0
	src := &fakeDrives{
		one: map[int64]*drivemodel.Drive{
			303: {
				ID:            303,
				VehicleID:     1,
				DurationS:     120,
				DistanceM:     500,
				EnergyUsedWh:  &zero,
				RegenEnergyWh: &zero,
			},
		},
	}
	tool := &queryDriveTelemetrySummary{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 303}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	envelope := out.(map[string]any)
	if envelope["regen_share_pct"] != nil {
		t.Errorf("regen_share_pct = %v, want nil (denominator zero)", envelope["regen_share_pct"])
	}
}

// TestQueryDriveTelemetrySummary_KwhPer100KmNilOnZeroDistance proves
// the second divide-by-zero guard. A stationary drive (distance_m=0)
// MUST surface kwh_per_100km=null rather than Inf.
func TestQueryDriveTelemetrySummary_KwhPer100KmNilOnZeroDistance(t *testing.T) {
	t.Parallel()

	used := 100.0
	src := &fakeDrives{
		one: map[int64]*drivemodel.Drive{
			404: {
				ID:           404,
				VehicleID:    1,
				DurationS:    60,
				DistanceM:    0,
				EnergyUsedWh: &used,
			},
		},
	}
	tool := &queryDriveTelemetrySummary{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 404}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	envelope := out.(map[string]any)
	if envelope["kwh_per_100km"] != nil {
		t.Errorf("kwh_per_100km = %v, want nil (distance zero)", envelope["kwh_per_100km"])
	}
}

// TestQueryDriveTelemetrySummary_NoSourceWired proves the
// fail-loud-on-misconfiguration contract. A nil DriveSource MUST
// surface as an explicit error, not a panic on first request.
func TestQueryDriveTelemetrySummary_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryDriveTelemetrySummary{src: nil}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 1}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute with nil DriveSource: err = nil, want error")
	}
}

// TestQueryDriveTelemetrySummary_DriveNotFound proves a missing
// drive surfaces as an explicit error rather than a misleading
// empty envelope. The LLM would otherwise narrate "your drive
// covered 0 m, used 0 Wh" which is silently wrong.
func TestQueryDriveTelemetrySummary_DriveNotFound(t *testing.T) {
	t.Parallel()
	src := &fakeDrives{one: map[int64]*drivemodel.Drive{}} // empty
	tool := &queryDriveTelemetrySummary{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 99}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute with missing drive: err = nil, want error")
	}
}

// TestQueryDriveTelemetrySummary_GetByIDError proves the IO error
// is wrapped (not swallowed) so the dispatcher can surface a useful
// tool-error frame to the LLM.
func TestQueryDriveTelemetrySummary_GetByIDError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("connection refused")
	src := &failingDrivesImpl{getByIDErr: wantErr}
	tool := &queryDriveTelemetrySummary{src: src}
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 1}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute with failing source: err = nil, want wrapped error")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("Execute err does not wrap source err: got=%v, want wraps %v", err, wantErr)
	}
}
