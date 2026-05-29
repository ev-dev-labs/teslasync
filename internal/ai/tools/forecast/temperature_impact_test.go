// Unit tests for the query_temperature_impact tool. The tool
// wraps a narrow [TemperatureImpactSource] port; tests substitute
// a deterministic fake so the unit tests stay hermetic.

package forecast

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// fakeTemperatureImpactSource is a hermetic stand-in for
// *api.AITemperatureImpactSource. It records the request
// vehicle_id and returns either a canned envelope or a forced
// error.
type fakeTemperatureImpactSource struct {
	calls []int64
	out   *TemperatureImpact
	err   error
}

func (f *fakeTemperatureImpactSource) QueryTemperatureImpact(_ context.Context, vehicleID int64) (*TemperatureImpact, error) {
	f.calls = append(f.calls, vehicleID)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestQueryTemperatureImpact_Name pins the canonical tool name.
// The strategy + goldens both reference it; a rename here without
// a matching rename in the strategy's allowedTools whitelist
// would silently break the dispatcher's tool-call routing.
func TestQueryTemperatureImpact_Name(t *testing.T) {
	t.Parallel()
	tool := &queryTemperatureImpact{}
	if got := tool.Name(); got != "query_temperature_impact" {
		t.Errorf("Name() = %q, want query_temperature_impact", got)
	}
}

// TestQueryTemperatureImpact_PropOnlyContract pins the read-only
// metadata. ADR-015 §I3 requires this tool to stay read-only.
func TestQueryTemperatureImpact_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryTemperatureImpact{}
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
}

// TestQueryTemperatureImpact_InputSchemaNonEmpty proves the
// schema cache hands back a non-nil JSON document so the LLM has
// guidance for the call arguments.
func TestQueryTemperatureImpact_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryTemperatureImpact{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	if !strings.Contains(string(schema), "vehicle_id") {
		t.Errorf("InputSchema() = %s, want substring 'vehicle_id'", string(schema))
	}
}

// TestQueryTemperatureImpact_Validate_OK proves a well-formed
// payload validates and the typed input round-trips.
func TestQueryTemperatureImpact_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryTemperatureImpact{}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed, ok := in.(queryTemperatureImpactInput)
	if !ok {
		t.Fatalf("Validate returned %T, want queryTemperatureImpactInput", in)
	}
	if typed.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", typed.VehicleID)
	}
}

// TestQueryTemperatureImpact_Validate_RejectsMissingVehicleID
// proves the required-validation rejects missing IDs. The
// dispatcher MUST always send vehicle_id; a missing one is a
// wiring bug.
func TestQueryTemperatureImpact_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryTemperatureImpact{}
	rawIn := json.RawMessage(`{}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for missing vehicle_id")
	}
}

// TestQueryTemperatureImpact_Execute_DelegatesAndPropagates
// proves the tool calls the port with the validated input and
// returns the canned envelope as-is.
func TestQueryTemperatureImpact_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	canned := &TemperatureImpact{
		VehicleID:         42,
		SampleSize:        45,
		MinRequiredDrives: 10,
		HasEnoughData:     true,
		Method:            "Bucket aggregate of recent drives by ambient cabin temperature",
		Assumptions: []string{
			"Buckets are descriptive aggregates of recent drives, not a forecast.",
		},
		Buckets: []TemperatureImpactBucket{
			{Label: "Below 0°C", DriveCount: 10, AvgDistanceKm: 25, AvgDurationS: 1800, AvgBatteryPer100Km: 22.5, AvgTempC: -3.4},
			{Label: "10-20°C", DriveCount: 20, AvgDistanceKm: 30, AvgDurationS: 1900, AvgBatteryPer100Km: 18.0, AvgTempC: 14.5},
		},
		BestBucket:  &TemperatureImpactBucket{Label: "10-20°C", DriveCount: 20, AvgBatteryPer100Km: 18.0, AvgTempC: 14.5},
		WorstBucket: &TemperatureImpactBucket{Label: "Below 0°C", DriveCount: 10, AvgBatteryPer100Km: 22.5, AvgTempC: -3.4},
		MonthlyTrend: []TemperatureImpactMonth{
			{Month: "2024-01", AvgTempC: -2.0, AvgEfficiency: 22.5, DriveCount: 8, TotalDistanceKm: 200},
		},
		Insights: []string{"Efficiency drops about 25% between 10-20°C and below 0°C."},
	}
	fake := &fakeTemperatureImpactSource{out: canned}
	tool := &queryTemperatureImpact{source: fake}

	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*TemperatureImpact)
	if !ok {
		t.Fatalf("Execute returned %T, want *TemperatureImpact", out)
	}
	if env != canned {
		t.Errorf("Execute returned a different envelope; want canned address pin")
	}
	if len(fake.calls) != 1 || fake.calls[0] != 42 {
		t.Errorf("source calls = %v, want [42]", fake.calls)
	}
}

// TestQueryTemperatureImpact_Execute_NoSourceWired proves a
// missing TemperatureImpactSource is reported as an Execute error
// so a wiring bug surfaces clearly at first call rather than at
// boot.
func TestQueryTemperatureImpact_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryTemperatureImpact{source: nil}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil source")
	}
	if !strings.Contains(err.Error(), "no TemperatureImpactSource") {
		t.Errorf("Execute err = %v, want 'no TemperatureImpactSource' message", err)
	}
}

// TestQueryTemperatureImpact_Execute_NilEnvelopeIsError proves a
// source that returns (nil, nil) is treated as a wiring bug
// rather than silently returning a nil envelope to the LLM.
func TestQueryTemperatureImpact_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	fake := &fakeTemperatureImpactSource{out: nil, err: nil}
	tool := &queryTemperatureImpact{source: fake}
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

// TestQueryTemperatureImpact_Execute_PropagatesSourceError proves
// a source IO error reaches the dispatcher unmodified so the
// LLM-facing reply carries the original cause.
func TestQueryTemperatureImpact_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("drives unreachable")
	fake := &fakeTemperatureImpactSource{err: sentinel}
	tool := &queryTemperatureImpact{source: fake}
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

// TestRegisterCabinTemperatureImpactNarrativeTools_RegistersOne
// proves the registration helper adds the tool to the registry.
func TestRegisterCabinTemperatureImpactNarrativeTools_RegistersOne(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterCabinTemperatureImpactNarrativeTools(r, CabinTemperatureImpactNarrativeSources{
		Source: &fakeTemperatureImpactSource{},
	})
	for _, want := range []string{
		"query_temperature_impact",
	} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing %q after RegisterCabinTemperatureImpactNarrativeTools", want)
		}
	}
}
