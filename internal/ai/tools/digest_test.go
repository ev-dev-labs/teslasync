// Phase-50 / 0012 — U2 Weekly digest narration.
//
// digest_test.go covers the new query_weekly_digest_context tool +
// the RegisterDigestTools wiring. The fakes (fakeDrives, fakeCharges)
// live in builtins_test.go; this file is in the same package so it
// reuses them directly.

package tools

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TestRegisterDigestTools_RegistersTool proves the wiring helper
// installs the new tool on a fresh registry. Mirrors the existing
// Register12Builtins test pattern.
func TestRegisterDigestTools_RegistersTool(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterDigestTools(r, DigestSources{
		Drives:  &fakeDrives{},
		Charges: &fakeCharges{},
	})
	if _, ok := r.Get("query_weekly_digest_context"); !ok {
		t.Fatal("RegisterDigestTools did not register query_weekly_digest_context")
	}
}

// TestRegisterDigestTools_DoesNotShadowBuiltins proves that
// installing the digest tool AFTER the 12 builtins keeps every
// builtin reachable. Defends against an accidental replacement of
// a same-named tool by a future edit (Registry.Register panics on
// duplicate, so this is also a guard against accidentally renaming
// a builtin to a digest-tool name).
func TestRegisterDigestTools_DoesNotShadowBuiltins(t *testing.T) {
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
	for _, name := range BuiltinNames {
		if _, ok := r.Get(name); !ok {
			t.Errorf("builtin %q lost after RegisterDigestTools", name)
		}
	}
	if _, ok := r.Get("query_weekly_digest_context"); !ok {
		t.Error("query_weekly_digest_context missing after registration")
	}
}

// TestQueryWeeklyDigestContext_NameDescriptionMutates pins the
// tool's static metadata so a future edit that flips Mutates() (or
// renames the tool out from under the strategy whitelist) fails
// here.
func TestQueryWeeklyDigestContext_NameDescriptionMutates(t *testing.T) {
	t.Parallel()
	tool := &queryWeeklyDigestContext{drives: &fakeDrives{}, charges: &fakeCharges{}}
	if got := tool.Name(); got != "query_weekly_digest_context" {
		t.Errorf("Name() = %q, want %q", got, "query_weekly_digest_context")
	}
	if tool.Description() == "" {
		t.Error("Description() returned empty string")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true; digest tool MUST be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// TestQueryWeeklyDigestContext_ValidateRejectsBadInput proves the
// validator catches missing vehicle_id and out-of-range offsets
// BEFORE Execute runs. The dispatcher's confirm gate would never
// catch a typed-input error — that's the validator's job.
func TestQueryWeeklyDigestContext_ValidateRejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &queryWeeklyDigestContext{drives: &fakeDrives{}, charges: &fakeCharges{}}

	cases := []struct {
		name string
		raw  string
	}{
		{"missing vehicle_id", `{}`},
		{"zero vehicle_id", `{"vehicle_id": 0}`},
		{"negative vehicle_id", `{"vehicle_id": -1}`},
		{"offset too far past", `{"vehicle_id": 1, "week_offset_weeks": -13}`},
		{"offset positive", `{"vehicle_id": 1, "week_offset_weeks": 1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(tc.raw)); err == nil {
				t.Fatalf("Validate(%q) = nil err, want validation error", tc.raw)
			}
		})
	}
}

// TestQueryWeeklyDigestContext_ValidateAcceptsCanonical proves the
// happy-path input shape decodes and the offset field is optional
// (when present must be within bounds; when absent defaults to 0).
func TestQueryWeeklyDigestContext_ValidateAcceptsCanonical(t *testing.T) {
	t.Parallel()
	tool := &queryWeeklyDigestContext{drives: &fakeDrives{}, charges: &fakeCharges{}}

	cases := []string{
		`{"vehicle_id": 1}`,
		`{"vehicle_id": 1, "week_offset_weeks": 0}`,
		`{"vehicle_id": 1, "week_offset_weeks": -1}`,
		`{"vehicle_id": 42, "week_offset_weeks": -12}`,
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(raw)); err != nil {
				t.Fatalf("Validate(%q) = %v, want nil", raw, err)
			}
		})
	}
}

// TestQueryWeeklyDigestContext_ExecuteAggregates is the core
// behavioural test: build a small in-memory week of drives +
// charges and assert the SI sums the tool returns are correct.
//
// All numeric fields are SI canonical (Phase-48 contract). A
// regression that drops the EnergyUsedWh nil-skip would silently
// mis-sum energy and the user's narration would lie — this test
// catches that.
func TestQueryWeeklyDigestContext_ExecuteAggregates(t *testing.T) {
	t.Parallel()
	used1 := float64(8000)
	used2 := float64(12000)
	regen1 := float64(1500)
	added1 := float64(20000)
	added2 := float64(15000)

	drives := []*models.Drive{
		{ID: 1, VehicleID: 1, DistanceM: 50000, DurationS: 1800, EnergyUsedWh: &used1, RegenEnergyWh: &regen1},
		{ID: 2, VehicleID: 1, DistanceM: 75000, DurationS: 2700, EnergyUsedWh: &used2},
		{ID: 3, VehicleID: 1, DistanceM: 17000, DurationS: 600 /* nil energy */},
		nil, // tolerated; Execute skips
	}
	charges := []*chargingmodel.ChargingSession{
		{ID: 10, VehicleID: 1, TotalEnergyAddedWh: &added1},
		{ID: 11, VehicleID: 1, TotalEnergyAddedWh: &added2},
		{ID: 12, VehicleID: 1 /* nil energy */},
		nil, // tolerated
	}
	tool := &queryWeeklyDigestContext{
		drives:  &fakeDrives{rows: drives},
		charges: &fakeCharges{rows: charges},
	}

	in := queryWeeklyDigestContextInput{VehicleID: 1, WeekOffsetWeeks: 0}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	got, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", out)
	}

	// Spot-check the keys the strategy's system prompt and goldens
	// depend on. A future edit that renames a key breaks the LLM's
	// ability to narrate accurately.
	type kv struct {
		key string
		exp any
	}
	expect := []kv{
		{"vehicle_id", int64(1)},
		{"drives_count", 3}, // nil entry skipped
		{"drives_distance_m", float64(50000 + 75000 + 17000)},
		{"drives_duration_s", int64(1800 + 2700 + 600)},
		{"drives_energy_used_wh", used1 + used2},
		{"drives_regen_energy_wh", regen1},
		{"charges_count", 3}, // nil entry skipped
		{"charges_energy_added_wh", added1 + added2},
	}
	for _, e := range expect {
		if got[e.key] != e.exp {
			t.Errorf("out[%q] = %v (%T), want %v (%T)", e.key, got[e.key], got[e.key], e.exp, e.exp)
		}
	}
	// Window stamps are RFC3339 strings — assert presence, not
	// exact value (depends on clock).
	for _, key := range []string{"week_start_utc", "week_end_utc"} {
		v, ok := got[key].(string)
		if !ok || v == "" {
			t.Errorf("out[%q] missing or non-string: %v", key, got[key])
		}
		if _, err := time.Parse(time.RFC3339, v); err != nil {
			t.Errorf("out[%q] = %q is not RFC3339: %v", key, v, err)
		}
	}
}

// TestQueryWeeklyDigestContext_ExecuteEmptyWeek proves the tool
// returns zeroed aggregates (NOT nil) when the week is empty. The
// canonical "zero week" golden in goldens.yaml depends on this:
// the LLM must see "0 drives, 0 charges" so it can narrate "a
// quiet week" instead of inventing data.
func TestQueryWeeklyDigestContext_ExecuteEmptyWeek(t *testing.T) {
	t.Parallel()
	tool := &queryWeeklyDigestContext{
		drives:  &fakeDrives{rows: nil},
		charges: &fakeCharges{rows: nil},
	}
	out, err := tool.Execute(context.Background(), queryWeeklyDigestContextInput{VehicleID: 1})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	got := out.(map[string]any)
	if got["drives_count"] != 0 {
		t.Errorf("drives_count = %v, want 0", got["drives_count"])
	}
	if got["charges_count"] != 0 {
		t.Errorf("charges_count = %v, want 0", got["charges_count"])
	}
	if got["drives_distance_m"] != float64(0) {
		t.Errorf("drives_distance_m = %v, want 0", got["drives_distance_m"])
	}
	if got["charges_energy_added_wh"] != float64(0) {
		t.Errorf("charges_energy_added_wh = %v, want 0", got["charges_energy_added_wh"])
	}
}

// TestQueryWeeklyDigestContext_ExecuteRequiresSources proves the
// tool fails fast when wired with nil sources — a misconfigured
// boot must surface as a clear tool-execution error instead of
// nil-dereferencing.
func TestQueryWeeklyDigestContext_ExecuteRequiresSources(t *testing.T) {
	t.Parallel()
	t.Run("nil drives", func(t *testing.T) {
		tool := &queryWeeklyDigestContext{drives: nil, charges: &fakeCharges{}}
		_, err := tool.Execute(context.Background(), queryWeeklyDigestContextInput{VehicleID: 1})
		if err == nil {
			t.Fatal("Execute err = nil, want DriveSource error")
		}
	})
	t.Run("nil charges", func(t *testing.T) {
		tool := &queryWeeklyDigestContext{drives: &fakeDrives{}, charges: nil}
		_, err := tool.Execute(context.Background(), queryWeeklyDigestContextInput{VehicleID: 1})
		if err == nil {
			t.Fatal("Execute err = nil, want ChargeSource error")
		}
	})
}

// TestIsoWeekWindowUTC pins the ISO-week semantics. Monday is
// always day 1 of the week; the window is [Mon-00:00, next
// Mon-00:00). A regression to "calendar week starts Sunday" would
// silently shift every digest by one day.
func TestIsoWeekWindowUTC(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		now       time.Time
		offset    int
		wantStart time.Time
	}{
		{
			name:      "wednesday this week",
			now:       time.Date(2025, 5, 14, 12, 30, 0, 0, time.UTC), // Wed
			offset:    0,
			wantStart: time.Date(2025, 5, 12, 0, 0, 0, 0, time.UTC), // Mon
		},
		{
			name:      "monday this week",
			now:       time.Date(2025, 5, 12, 0, 1, 0, 0, time.UTC), // Mon 00:01
			offset:    0,
			wantStart: time.Date(2025, 5, 12, 0, 0, 0, 0, time.UTC),
		},
		{
			name:      "sunday this week",
			now:       time.Date(2025, 5, 18, 23, 0, 0, 0, time.UTC), // Sun
			offset:    0,
			wantStart: time.Date(2025, 5, 12, 0, 0, 0, 0, time.UTC), // still Mon May 12
		},
		{
			name:      "previous week",
			now:       time.Date(2025, 5, 14, 12, 30, 0, 0, time.UTC),
			offset:    -1,
			wantStart: time.Date(2025, 5, 5, 0, 0, 0, 0, time.UTC),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end := isoWeekWindowUTC(tc.now, tc.offset)
			if !start.Equal(tc.wantStart) {
				t.Errorf("start = %v, want %v", start, tc.wantStart)
			}
			if !end.Equal(tc.wantStart.AddDate(0, 0, 7)) {
				t.Errorf("end = %v, want start+7d %v", end, tc.wantStart.AddDate(0, 0, 7))
			}
		})
	}
}
