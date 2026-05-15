// Phase-50 / 0040 — X1 Period compare narration.
//
// Unit tests for the query_period_compare tool. The tool wraps a
// narrow [PeriodComparator] port; tests substitute a deterministic
// fake so the unit tests stay hermetic.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
)

// fakePeriodComparator is a hermetic stand-in for
// *api.AIPeriodCompareSource. It records the request vehicle_id +
// daysA + daysB and returns either a canned envelope or a forced
// error.
type fakePeriodComparator struct {
	calls []struct {
		vehicleID int64
		daysA     int
		daysB     int
	}
	out *PeriodCompare
	err error
}

func (f *fakePeriodComparator) ComparePeriods(_ context.Context, vehicleID int64, daysA, daysB int) (*PeriodCompare, error) {
	f.calls = append(f.calls, struct {
		vehicleID int64
		daysA     int
		daysB     int
	}{vehicleID, daysA, daysB})
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestQueryPeriodCompare_Name pins the canonical tool name. The
// strategy + goldens both reference it; a rename here without a
// matching rename in the strategy's allowedTools whitelist would
// silently break the dispatcher's tool-call routing.
func TestQueryPeriodCompare_Name(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	if got := tool.Name(); got != "query_period_compare" {
		t.Errorf("Name() = %q, want query_period_compare", got)
	}
}

// TestQueryPeriodCompare_PropOnlyContract pins the read-only
// metadata. ADR-015 §I3 + the slice prompt mandate read-only for
// this slice.
func TestQueryPeriodCompare_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.Description() == "" {
		t.Errorf("Description() = empty, want a non-empty description")
	}
	if tool.OutputSchema() != nil {
		t.Errorf("OutputSchema() = %v, want nil (free-form output)", tool.OutputSchema())
	}
	// Honest-zero-baseline pin: the description MUST disclose
	// percent_change is nullable and the LLM must NOT invent
	// a percent change for a zero baseline.
	desc := tool.Description()
	if !strings.Contains(desc, "percent_change is nullable") {
		t.Errorf("Description() missing 'percent_change is nullable' qualifier: %q", desc)
	}
	if !strings.Contains(desc, "do NOT invent a percent change for a zero baseline") {
		t.Errorf("Description() missing zero-baseline qualifier: %q", desc)
	}
}

// TestQueryPeriodCompare_InputSchemaNonEmpty proves the schema
// cache hands back a non-nil JSON document so the LLM has
// guidance for the call arguments.
func TestQueryPeriodCompare_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	for _, want := range []string{"vehicle_id", "days_a", "days_b"} {
		if !strings.Contains(string(schema), want) {
			t.Errorf("InputSchema() = %s, want substring %q", string(schema), want)
		}
	}
}

// TestQueryPeriodCompare_Validate_OK proves a well-formed payload
// validates and the typed input round-trips.
func TestQueryPeriodCompare_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "days_a": 30, "days_b": 90}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed, ok := in.(queryPeriodCompareInput)
	if !ok {
		t.Fatalf("Validate returned %T, want queryPeriodCompareInput", in)
	}
	if typed.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", typed.VehicleID)
	}
	if typed.DaysA != 30 {
		t.Errorf("DaysA = %d, want 30", typed.DaysA)
	}
	if typed.DaysB != 90 {
		t.Errorf("DaysB = %d, want 90", typed.DaysB)
	}
}

// TestQueryPeriodCompare_Validate_OK_OmittedDays proves daysA /
// daysB are optional (the production adapter defaults to 30 / 90
// when zero).
func TestQueryPeriodCompare_Validate_OK_OmittedDays(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed := in.(queryPeriodCompareInput)
	if typed.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", typed.VehicleID)
	}
	if typed.DaysA != 0 {
		t.Errorf("DaysA = %d, want 0 (defaulted by Execute)", typed.DaysA)
	}
	if typed.DaysB != 0 {
		t.Errorf("DaysB = %d, want 0 (defaulted by Execute)", typed.DaysB)
	}
}

// TestQueryPeriodCompare_Validate_RejectsMissingVehicleID proves
// the required-validation rejects missing IDs. The dispatcher
// MUST always send vehicle_id; a missing one is a wiring bug.
func TestQueryPeriodCompare_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	rawIn := json.RawMessage(`{}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for missing vehicle_id")
	}
}

// TestQueryPeriodCompare_Validate_RejectsDaysOverCap proves the
// 0..3650 days cap on the input matches the canonical SPA
// selector bounds. An LLM-supplied 100000 must fail validation
// before any SQL runs.
func TestQueryPeriodCompare_Validate_RejectsDaysOverCap(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "days_a": 100000}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for days_a > 3650")
	}
}

// TestQueryPeriodCompare_Validate_AcceptsZeroDays proves days=0
// is a valid value (means "all time" — mirrors the canonical
// /period-stats?days=0 contract the SPA already uses).
func TestQueryPeriodCompare_Validate_AcceptsZeroDays(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "days_a": 0, "days_b": 0}`)
	_, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v, want nil for days=0 (all-time)", err)
	}
}

// TestQueryPeriodCompare_Execute_DelegatesAndPropagates proves the
// tool calls the port with the validated input and returns the
// canned envelope as-is.
func TestQueryPeriodCompare_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	canned := &PeriodCompare{
		VehicleID: 42,
		PeriodA: PeriodComparePeriod{
			Days:                 30,
			TotalDistanceKm:      450.5,
			TotalDrives:          24,
			EnergyUsedKWh:        85.2,
			AvgEfficiencyWhPerKm: 189.0,
			TotalCost:            32.40,
			CO2SavedKg:           54.06,
		},
		PeriodB: PeriodComparePeriod{
			Days:                 90,
			TotalDistanceKm:      1320.0,
			TotalDrives:          70,
			EnergyUsedKWh:        251.0,
			AvgEfficiencyWhPerKm: 190.2,
			TotalCost:            96.80,
			CO2SavedKg:           158.40,
		},
		Deltas: []PeriodCompareDelta{
			{Metric: "total_distance_km", Delta: -869.5, Direction: "down"},
		},
	}
	fake := &fakePeriodComparator{out: canned}
	tool := &queryPeriodCompare{comparator: fake}

	rawIn := json.RawMessage(`{"vehicle_id": 42, "days_a": 30, "days_b": 90}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*PeriodCompare)
	if !ok {
		t.Fatalf("Execute returned %T, want *PeriodCompare", out)
	}
	if env != canned {
		t.Errorf("Execute returned a different envelope; want canned address pin")
	}
	if len(fake.calls) != 1 || fake.calls[0].vehicleID != 42 || fake.calls[0].daysA != 30 || fake.calls[0].daysB != 90 {
		t.Errorf("comparator calls = %v, want [{42 30 90}]", fake.calls)
	}
}

// TestQueryPeriodCompare_Execute_DefaultsDays proves the
// production adapter receives daysA=30 / daysB=90 when the LLM
// omits the optional inputs. The defaults mirror the SPA's
// PeriodComparePage selector defaults.
func TestQueryPeriodCompare_Execute_DefaultsDays(t *testing.T) {
	t.Parallel()
	canned := &PeriodCompare{VehicleID: 42}
	fake := &fakePeriodComparator{out: canned}
	tool := &queryPeriodCompare{comparator: fake}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].daysA != 30 || fake.calls[0].daysB != 90 {
		t.Errorf("comparator calls = %v, want daysA=30, daysB=90 default", fake.calls)
	}
}

// TestQueryPeriodCompare_Execute_NoComparatorWired proves a
// missing PeriodComparator is reported as an Execute error so a
// wiring bug surfaces clearly at first call rather than at boot.
func TestQueryPeriodCompare_Execute_NoComparatorWired(t *testing.T) {
	t.Parallel()
	tool := &queryPeriodCompare{comparator: nil}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil comparator")
	}
	if !strings.Contains(err.Error(), "no PeriodComparator") {
		t.Errorf("Execute err = %v, want 'no PeriodComparator' message", err)
	}
}

// TestQueryPeriodCompare_Execute_NilEnvelopeIsError proves a
// comparator that returns (nil, nil) is treated as a wiring bug
// rather than silently returning a nil envelope to the LLM.
func TestQueryPeriodCompare_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	fake := &fakePeriodComparator{out: nil, err: nil}
	tool := &queryPeriodCompare{comparator: fake}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil envelope")
	}
	if !strings.Contains(err.Error(), "nil envelope") {
		t.Errorf("Execute err = %v, want 'nil envelope' message", err)
	}
}

// TestQueryPeriodCompare_Execute_PropagatesComparatorError proves
// an IO error reaches the dispatcher unmodified so the LLM-facing
// reply carries the original cause.
func TestQueryPeriodCompare_Execute_PropagatesComparatorError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("drives table unreachable")
	fake := &fakePeriodComparator{err: sentinel}
	tool := &queryPeriodCompare{comparator: fake}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want forwarded error")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("Execute err = %v, want chain containing sentinel", err)
	}
}

// TestComputePeriodCompareDeltas_ZeroBaselinePercentNil proves
// the deterministic delta builder returns percent_change = nil
// when the Period B baseline is zero — defends the system
// prompt's "do not invent percent change for a zero baseline"
// rule from a future regression in the production adapter.
func TestComputePeriodCompareDeltas_ZeroBaselinePercentNil(t *testing.T) {
	t.Parallel()
	a := PeriodComparePeriod{
		TotalDistanceKm: 100,
		TotalDrives:     5,
		EnergyUsedKWh:   25,
	}
	// Period B is fully zero — every percent_change must be nil.
	b := PeriodComparePeriod{}
	deltas := ComputePeriodCompareDeltas(a, b)
	if len(deltas) == 0 {
		t.Fatal("ComputePeriodCompareDeltas returned empty slice")
	}
	for _, d := range deltas {
		if d.PercentChange != nil {
			t.Errorf("delta %q: PercentChange = %v, want nil for zero baseline", d.Metric, *d.PercentChange)
		}
	}
}

// TestComputePeriodCompareDeltas_PercentChangeMath pins the
// percent-change math for a known input pair. delta = a - b,
// percent_change = (a - b) / b * 100, both rounded to 2 decimals
// for parity with api.ComputePeriodStats.
func TestComputePeriodCompareDeltas_PercentChangeMath(t *testing.T) {
	t.Parallel()
	a := PeriodComparePeriod{
		TotalDistanceKm:      150.0,
		TotalDrives:          10,
		EnergyUsedKWh:        30.0,
		AvgEfficiencyWhPerKm: 200.0,
		TotalCost:            12.0,
		CO2SavedKg:           18.0,
	}
	b := PeriodComparePeriod{
		TotalDistanceKm:      100.0,
		TotalDrives:          5,
		EnergyUsedKWh:        20.0,
		AvgEfficiencyWhPerKm: 200.0,
		TotalCost:            8.0,
		CO2SavedKg:           12.0,
	}
	deltas := ComputePeriodCompareDeltas(a, b)
	byName := map[string]PeriodCompareDelta{}
	for _, d := range deltas {
		byName[d.Metric] = d
	}
	// distance: 150 - 100 = 50, pct = 50/100*100 = 50%
	if d := byName["total_distance_km"]; d.Delta != 50 || d.PercentChange == nil || math.Abs(*d.PercentChange-50) > 1e-6 {
		t.Errorf("distance delta = %+v, want delta=50, pct=50", d)
	}
	// drives: 10 - 5 = 5, pct = 5/5*100 = 100%
	if d := byName["total_drives"]; d.Delta != 5 || d.PercentChange == nil || math.Abs(*d.PercentChange-100) > 1e-6 {
		t.Errorf("drives delta = %+v, want delta=5, pct=100", d)
	}
	// efficiency flat: 200 - 200 = 0, pct = 0/200*100 = 0%, direction=flat
	if d := byName["avg_efficiency_wh_per_km"]; d.Delta != 0 || d.PercentChange == nil || *d.PercentChange != 0 || d.Direction != "flat" {
		t.Errorf("efficiency delta = %+v, want delta=0, pct=0, direction=flat", d)
	}
	// CO2 up: 18 - 12 = 6, pct = 6/12*100 = 50%
	if d := byName["co2_saved_kg"]; d.Delta != 6 || d.PercentChange == nil || math.Abs(*d.PercentChange-50) > 1e-6 {
		t.Errorf("CO2 delta = %+v, want delta=6, pct=50", d)
	}
}

// TestComputePeriodCompareDeltas_DirectionFlat proves a sub-1-cent
// jitter rounds to "flat" direction so a numerically-zero delta
// after the 2-decimal round in api.ComputePeriodStats does not
// oscillate as "up" / "down".
func TestComputePeriodCompareDeltas_DirectionFlat(t *testing.T) {
	t.Parallel()
	deltas := ComputePeriodCompareDeltas(
		PeriodComparePeriod{TotalCost: 100.001},
		PeriodComparePeriod{TotalCost: 100.000},
	)
	for _, d := range deltas {
		if d.Metric == "total_cost" && d.Direction != "flat" {
			t.Errorf("sub-cent jitter: direction = %q, want flat", d.Direction)
		}
	}
}

// TestRegisterPeriodCompareNarrationTools_RegistersOne proves the
// registration helper adds the tool to the registry.
func TestRegisterPeriodCompareNarrationTools_RegistersOne(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterPeriodCompareNarrationTools(r, PeriodCompareNarrationSources{
		Comparator: &fakePeriodComparator{},
	})
	for _, want := range []string{
		"query_period_compare",
	} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing %q after RegisterPeriodCompareNarrationTools", want)
		}
	}
}
