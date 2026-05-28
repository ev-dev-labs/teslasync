// Phase-50 / 0027 — C2 Battery health forecast narrative.
//
// Unit tests for the query_battery_health_forecast tool. The tool
// wraps a narrow [BatteryHealthForecaster] port; tests substitute a
// deterministic fake so the unit tests stay hermetic.

package predict

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// fakeBatteryHealthForecaster is a hermetic stand-in for
// *api.AIBatteryHealthForecaster. It records the request vehicle_id
// and returns either a canned envelope or a forced error.
type fakeBatteryHealthForecaster struct {
	calls []int64
	out   *BatteryHealthForecast
	err   error
}

func (f *fakeBatteryHealthForecaster) ForecastBatteryHealth(_ context.Context, vehicleID int64) (*BatteryHealthForecast, error) {
	f.calls = append(f.calls, vehicleID)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestQueryBatteryHealthForecast_Name pins the canonical tool name.
// The strategy + goldens both reference it; a rename here without a
// matching rename in the strategy's allowedTools whitelist would
// silently break the dispatcher's tool-call routing.
func TestQueryBatteryHealthForecast_Name(t *testing.T) {
	t.Parallel()
	tool := &queryBatteryHealthForecast{}
	if got := tool.Name(); got != "query_battery_health_forecast" {
		t.Errorf("Name() = %q, want query_battery_health_forecast", got)
	}
}

// TestQueryBatteryHealthForecast_PropOnlyContract pins the
// read-only metadata. ADR-015 §I3 + the slice prompt mandate
// read-only for this slice.
func TestQueryBatteryHealthForecast_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryBatteryHealthForecast{}
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

// TestQueryBatteryHealthForecast_InputSchemaNonEmpty proves the
// schema cache hands back a non-nil JSON document so the LLM has
// guidance for the call arguments.
func TestQueryBatteryHealthForecast_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryBatteryHealthForecast{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	// Spot-check: the vehicle_id field must be present.
	if !strings.Contains(string(schema), "vehicle_id") {
		t.Errorf("InputSchema() = %s, want substring 'vehicle_id'", string(schema))
	}
}

// TestQueryBatteryHealthForecast_Validate_OK proves a well-formed
// payload validates and the typed input round-trips.
func TestQueryBatteryHealthForecast_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryBatteryHealthForecast{}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed, ok := in.(queryBatteryHealthForecastInput)
	if !ok {
		t.Fatalf("Validate returned %T, want queryBatteryHealthForecastInput", in)
	}
	if typed.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", typed.VehicleID)
	}
}

// TestQueryBatteryHealthForecast_Validate_RejectsMissingVehicleID
// proves the required-validation rejects missing IDs. The dispatcher
// MUST always send vehicle_id; a missing one is a wiring bug.
func TestQueryBatteryHealthForecast_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryBatteryHealthForecast{}
	rawIn := json.RawMessage(`{}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for missing vehicle_id")
	}
}

// TestQueryBatteryHealthForecast_Execute_DelegatesAndPropagates
// proves the tool calls the port with the validated input and
// returns the canned envelope as-is.
func TestQueryBatteryHealthForecast_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	canned := &BatteryHealthForecast{
		VehicleID:                  42,
		CurrentHealthPct:           96.0,
		CurrentCapacityWh:          72000.0,
		CurrentRangeKm:             420.0,
		BatteryCapacityWh:          75000.0,
		SnapshotCount:              52,
		FirstSnapshotDate:          "2022-01-01",
		DegradationRatePctPerYear:  1.5,
		DegradationRatePctPerMonth: 0.125,
		YearsTo80Pct:               10.6,
		Projected80PctDate:         "2035-04",
		HasEnoughData:              true,
		StressLevel:                "Low",
		ChargingHabits: BatteryHealthChargingHabits{
			FastChargeCount:    8,
			SlowChargeCount:    142,
			DeepDischargeCount: 0,
			ChargeToFullCount:  3,
			HighSocCount:       4,
			TotalCount:         150,
			FastChargeRatioPct: 5.3,
		},
		RiskFactors: []BatteryHealthRiskFactor{
			{Name: "fast_charge_ratio", Score: 8, Label: "Low", Detail: "5% of sessions are DC fast charge"},
		},
	}
	fake := &fakeBatteryHealthForecaster{out: canned}
	tool := &queryBatteryHealthForecast{forecaster: fake}

	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*BatteryHealthForecast)
	if !ok {
		t.Fatalf("Execute returned %T, want *BatteryHealthForecast", out)
	}
	if env != canned {
		t.Errorf("Execute returned a different envelope; want canned address pin")
	}
	if len(fake.calls) != 1 || fake.calls[0] != 42 {
		t.Errorf("forecaster calls = %v, want [42]", fake.calls)
	}
}

// TestQueryBatteryHealthForecast_Execute_NoForecasterWired proves a
// missing BatteryHealthForecaster is reported as an Execute error so
// a wiring bug surfaces clearly at first call rather than at boot.
func TestQueryBatteryHealthForecast_Execute_NoForecasterWired(t *testing.T) {
	t.Parallel()
	tool := &queryBatteryHealthForecast{forecaster: nil}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil forecaster")
	}
	if !strings.Contains(err.Error(), "no BatteryHealthForecaster") {
		t.Errorf("Execute err = %v, want 'no BatteryHealthForecaster' message", err)
	}
}

// TestQueryBatteryHealthForecast_Execute_NilEnvelopeIsError proves a
// forecaster that returns (nil, nil) is treated as a wiring bug
// rather than silently returning a nil envelope to the LLM.
func TestQueryBatteryHealthForecast_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	fake := &fakeBatteryHealthForecaster{out: nil, err: nil}
	tool := &queryBatteryHealthForecast{forecaster: fake}
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

// TestQueryBatteryHealthForecast_Execute_PropagatesForecasterError
// proves a forecast IO error reaches the dispatcher unmodified so
// the LLM-facing reply carries the original cause.
func TestQueryBatteryHealthForecast_Execute_PropagatesForecasterError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("signal_log unreachable")
	fake := &fakeBatteryHealthForecaster{err: sentinel}
	tool := &queryBatteryHealthForecast{forecaster: fake}
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

// TestRegisterBatteryHealthForecastNarrativeTools_RegistersOne
// proves the registration helper adds the tool to the registry.
func TestRegisterBatteryHealthForecastNarrativeTools_RegistersOne(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterBatteryHealthForecastNarrativeTools(r, BatteryHealthForecastNarrativeSources{
		Forecaster: &fakeBatteryHealthForecaster{},
	})
	for _, want := range []string{
		"query_battery_health_forecast",
	} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing %q after RegisterBatteryHealthForecastNarrativeTools", want)
		}
	}
}
