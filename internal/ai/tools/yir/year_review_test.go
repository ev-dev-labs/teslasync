// Phase-50 / 0013 — U3 Year-in-review narration.
//
// year_review_test.go covers the new query_year_in_review_context
// tool + the RegisterYearReviewTools wiring. The fakes (toolstest.FakeDrives,
// toolstest.FakeCharges) live in builtins_test.go; this file is in the same
// package so it reuses them directly.

package yir

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/toolstest"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// TestRegisterYearReviewTools_RegistersTool proves the wiring helper
// installs the new tool on a fresh registry. Mirrors the existing
// digest.RegisterDigestTools test pattern.
func TestRegisterYearReviewTools_RegistersTool(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterYearReviewTools(r, YearReviewSources{
		Drives:  &toolstest.FakeDrives{},
		Charges: &toolstest.FakeCharges{},
	})
	if _, ok := r.Get("query_year_in_review_context"); !ok {
		t.Fatal("RegisterYearReviewTools did not register query_year_in_review_context")
	}
}

// TestRegisterYearReviewTools_DoesNotShadowBuiltins proves that
// installing the YIR tool AFTER the 12 builtins + the digest tool
// keeps every previously-registered tool reachable. Defends against
// an accidental replacement of a same-named tool by a future edit
// (Registry.Register panics on duplicate, so this is also a guard
// against accidentally renaming a builtin to a YIR-tool name).
func TestRegisterYearReviewTools_DoesNotShadowBuiltins(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	tools.Register12Builtins(r, tools.Sources{
		Vehicles:      &toolstest.FakeVehicles{},
		VehicleState:  &toolstest.FakeState{},
		Drives:        &toolstest.FakeDrives{},
		Charges:       &toolstest.FakeCharges{},
		AlertRules:    &toolstest.FakeRules{},
		Notifications: &toolstest.FakeNotif{},
		Geofences:     &toolstest.FakeFences{},
		Efficiency:    &toolstest.FakeDrives{},
	})
	RegisterYearReviewTools(r, YearReviewSources{
		Drives:  &toolstest.FakeDrives{},
		Charges: &toolstest.FakeCharges{},
	})
	for _, name := range tools.BuiltinNames {
		if _, ok := r.Get(name); !ok {
			t.Errorf("builtin %q lost after RegisterYearReviewTools", name)
		}
	}
	if _, ok := r.Get("query_year_in_review_context"); !ok {
		t.Error("query_year_in_review_context missing after registration")
	}
}

// TestQueryYearInReviewContext_NameDescriptionMutates pins the
// tool's static metadata so a future edit that flips Mutates() (or
// renames the tool out from under the strategy whitelist) fails
// here.
func TestQueryYearInReviewContext_NameDescriptionMutates(t *testing.T) {
	t.Parallel()
	tool := &queryYearInReviewContext{drives: &toolstest.FakeDrives{}, charges: &toolstest.FakeCharges{}}
	if got := tool.Name(); got != "query_year_in_review_context" {
		t.Errorf("Name() = %q, want %q", got, "query_year_in_review_context")
	}
	if tool.Description() == "" {
		t.Error("Description() returned empty string")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true; YIR tool MUST be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// TestQueryYearInReviewContext_ValidateRejectsBadInput proves the
// validator catches missing vehicle_id and out-of-range years
// BEFORE Execute runs. The dispatcher's confirm gate would never
// catch a typed-input error — that's the validator's job.
func TestQueryYearInReviewContext_ValidateRejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &queryYearInReviewContext{drives: &toolstest.FakeDrives{}, charges: &toolstest.FakeCharges{}}

	cases := []struct {
		name string
		raw  string
	}{
		{"missing vehicle_id", `{"year": 2025}`},
		{"zero vehicle_id", `{"vehicle_id": 0, "year": 2025}`},
		{"negative vehicle_id", `{"vehicle_id": -1, "year": 2025}`},
		{"missing year", `{"vehicle_id": 1}`},
		{"year too far past", `{"vehicle_id": 1, "year": 2009}`},
		{"year too far future", `{"vehicle_id": 1, "year": 2101}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(tc.raw)); err == nil {
				t.Fatalf("Validate(%q) = nil err, want validation error", tc.raw)
			}
		})
	}
}

// TestQueryYearInReviewContext_ValidateAcceptsCanonical proves the
// happy-path input shape decodes for the supported year range.
func TestQueryYearInReviewContext_ValidateAcceptsCanonical(t *testing.T) {
	t.Parallel()
	tool := &queryYearInReviewContext{drives: &toolstest.FakeDrives{}, charges: &toolstest.FakeCharges{}}

	cases := []string{
		`{"vehicle_id": 1, "year": 2010}`,
		`{"vehicle_id": 1, "year": 2025}`,
		`{"vehicle_id": 42, "year": 2099}`,
		`{"vehicle_id": 7, "year": 2100}`,
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(raw)); err != nil {
				t.Fatalf("Validate(%q) = %v, want nil", raw, err)
			}
		})
	}
}

// TestQueryYearInReviewContext_ExecuteAggregates is the core
// behavioural test: build a small in-memory year of drives +
// charges and assert the SI sums the tool returns are correct.
//
// All numeric fields are SI canonical (Phase-48 contract). A
// regression that drops the EnergyUsedWh nil-skip would silently
// mis-sum energy and the user's narration would lie — this test
// catches that.
func TestQueryYearInReviewContext_ExecuteAggregates(t *testing.T) {
	t.Parallel()
	used1 := float64(8000)
	used2 := float64(12000)
	used3 := float64(22500)
	regen1 := float64(1500)
	regen2 := float64(3200)
	added1 := float64(20000)
	added2 := float64(15000)
	added3 := float64(60000)

	drives := []*drivemodel.Drive{
		{ID: 1, VehicleID: 1, DistanceM: 50000, DurationS: 1800, EnergyUsedWh: &used1, RegenEnergyWh: &regen1},
		{ID: 2, VehicleID: 1, DistanceM: 75000, DurationS: 2700, EnergyUsedWh: &used2},
		{ID: 3, VehicleID: 1, DistanceM: 17000, DurationS: 600 /* nil energy */},
		{ID: 4, VehicleID: 1, DistanceM: 120000, DurationS: 4500, EnergyUsedWh: &used3, RegenEnergyWh: &regen2},
		nil, // tolerated; Execute skips
	}
	charges := []*chargingmodel.ChargingSession{
		{ID: 10, VehicleID: 1, TotalEnergyAddedWh: &added1},
		{ID: 11, VehicleID: 1, TotalEnergyAddedWh: &added2},
		{ID: 12, VehicleID: 1 /* nil energy */},
		{ID: 13, VehicleID: 1, TotalEnergyAddedWh: &added3},
		nil, // tolerated
	}
	tool := &queryYearInReviewContext{
		drives:  &toolstest.FakeDrives{Rows: drives},
		charges: &toolstest.FakeCharges{Rows: charges},
	}

	in := queryYearInReviewContextInput{VehicleID: 1, Year: 2025}
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
		{"year", 2025},
		{"drives_count", 4}, // nil entry skipped
		{"drives_distance_m", float64(50000 + 75000 + 17000 + 120000)},
		{"drives_duration_s", int64(1800 + 2700 + 600 + 4500)},
		{"drives_energy_used_wh", used1 + used2 + used3},
		{"drives_regen_energy_wh", regen1 + regen2},
		{"charges_count", 4}, // nil entry skipped
		{"charges_energy_added_wh", added1 + added2 + added3},
	}
	for _, e := range expect {
		if got[e.key] != e.exp {
			t.Errorf("out[%q] = %v (%T), want %v (%T)", e.key, got[e.key], got[e.key], e.exp, e.exp)
		}
	}
	// Window stamps are RFC3339 strings — assert presence + parseability.
	for _, key := range []string{"year_start_utc", "year_end_utc"} {
		v, ok := got[key].(string)
		if !ok || v == "" {
			t.Errorf("out[%q] missing or non-string: %v", key, got[key])
		}
		if _, err := time.Parse(time.RFC3339, v); err != nil {
			t.Errorf("out[%q] = %q is not RFC3339: %v", key, v, err)
		}
	}
	// And the window matches the expected calendar year contract.
	wantStart := "2025-01-01T00:00:00Z"
	wantEnd := "2026-01-01T00:00:00Z"
	if got["year_start_utc"] != wantStart {
		t.Errorf("year_start_utc = %v, want %v", got["year_start_utc"], wantStart)
	}
	if got["year_end_utc"] != wantEnd {
		t.Errorf("year_end_utc = %v, want %v", got["year_end_utc"], wantEnd)
	}
}

// TestQueryYearInReviewContext_ExecuteEmptyYear proves the tool
// returns zeroed aggregates (NOT nil) when the year is empty. The
// canonical "quiet year" golden in goldens.yaml depends on this:
// the LLM must see "0 drives, 0 charges" so it can narrate "a
// quiet year" instead of inventing data.
func TestQueryYearInReviewContext_ExecuteEmptyYear(t *testing.T) {
	t.Parallel()
	tool := &queryYearInReviewContext{
		drives:  &toolstest.FakeDrives{Rows: nil},
		charges: &toolstest.FakeCharges{Rows: nil},
	}
	out, err := tool.Execute(context.Background(), queryYearInReviewContextInput{VehicleID: 1, Year: 2024})
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
	if got["year"] != 2024 {
		t.Errorf("year = %v, want 2024", got["year"])
	}
}

// TestQueryYearInReviewContext_ExecuteRequiresSources proves the
// tool fails fast when wired with nil sources — a misconfigured
// boot must surface as a clear tool-execution error instead of
// nil-dereferencing.
func TestQueryYearInReviewContext_ExecuteRequiresSources(t *testing.T) {
	t.Parallel()
	t.Run("nil drives", func(t *testing.T) {
		tool := &queryYearInReviewContext{drives: nil, charges: &toolstest.FakeCharges{}}
		_, err := tool.Execute(context.Background(), queryYearInReviewContextInput{VehicleID: 1, Year: 2025})
		if err == nil {
			t.Fatal("Execute err = nil, want DriveSource error")
		}
	})
	t.Run("nil charges", func(t *testing.T) {
		tool := &queryYearInReviewContext{drives: &toolstest.FakeDrives{}, charges: nil}
		_, err := tool.Execute(context.Background(), queryYearInReviewContextInput{VehicleID: 1, Year: 2025})
		if err == nil {
			t.Fatal("Execute err = nil, want ChargeSource error")
		}
	})
}

// TestCalendarYearWindowUTC pins the calendar-year semantics. The
// window MUST be [Jan 1 00:00 UTC, next-year Jan 1 00:00 UTC). A
// regression to "January..December" inclusive ranges or to local
// time zones would silently shift every year-in-review.
func TestCalendarYearWindowUTC(t *testing.T) {
	t.Parallel()
	cases := []struct {
		year      int
		wantStart time.Time
		wantEnd   time.Time
	}{
		{
			year:      2024, // leap year
			wantStart: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			year:      2025,
			wantStart: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			year:      2099,
			wantStart: time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC),
		},
	}
	for _, tc := range cases {
		t.Run(time.Date(tc.year, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006"), func(t *testing.T) {
			start, end := calendarYearWindowUTC(tc.year)
			if !start.Equal(tc.wantStart) {
				t.Errorf("start = %v, want %v", start, tc.wantStart)
			}
			if !end.Equal(tc.wantEnd) {
				t.Errorf("end = %v, want %v", end, tc.wantEnd)
			}
		})
	}
}
