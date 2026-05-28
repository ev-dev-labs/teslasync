// Phase-50 / 0029 — C4 Cost forecast narration.
//
// Unit tests for the query_cost_forecast tool. The tool wraps a
// narrow [CostForecaster] port; tests substitute a deterministic
// fake so the unit tests stay hermetic.

package forecast

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// fakeCostForecaster is a hermetic stand-in for
// *api.AICostForecaster. It records the request vehicle_id +
// months and returns either a canned envelope or a forced error.
type fakeCostForecaster struct {
	calls []struct {
		vehicleID int64
		months    int
	}
	out *CostForecast
	err error
}

func (f *fakeCostForecaster) ForecastCosts(_ context.Context, vehicleID int64, months int) (*CostForecast, error) {
	f.calls = append(f.calls, struct {
		vehicleID int64
		months    int
	}{vehicleID, months})
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestQueryCostForecast_Name pins the canonical tool name. The
// strategy + goldens both reference it; a rename here without a
// matching rename in the strategy's allowedTools whitelist would
// silently break the dispatcher's tool-call routing.
func TestQueryCostForecast_Name(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{}
	if got := tool.Name(); got != "query_cost_forecast" {
		t.Errorf("Name() = %q, want query_cost_forecast", got)
	}
}

// TestQueryCostForecast_PropOnlyContract pins the read-only
// metadata. ADR-015 §I3 + the slice prompt mandate read-only for
// this slice.
func TestQueryCostForecast_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{}
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
	// Honest-uncertainty pin: the description MUST disclose
	// the band is APPROXIMATE, not strict 95% CI. The
	// rubber-duck critique flagged "95% CI" as too strong;
	// the description guards against a future edit
	// reintroducing the overclaim.
	desc := tool.Description()
	if !strings.Contains(desc, "APPROXIMATE prediction interval") {
		t.Errorf("Description() missing APPROXIMATE-prediction-interval qualifier: %q", desc)
	}
	if !strings.Contains(desc, "NOT a strict 95% confidence interval") {
		t.Errorf("Description() missing NOT-strict-95-CI qualifier: %q", desc)
	}
}

// TestQueryCostForecast_InputSchemaNonEmpty proves the schema
// cache hands back a non-nil JSON document so the LLM has
// guidance for the call arguments.
func TestQueryCostForecast_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	// Spot-check: the vehicle_id + months fields must be
	// present.
	if !strings.Contains(string(schema), "vehicle_id") {
		t.Errorf("InputSchema() = %s, want substring 'vehicle_id'", string(schema))
	}
	if !strings.Contains(string(schema), "months") {
		t.Errorf("InputSchema() = %s, want substring 'months'", string(schema))
	}
}

// TestQueryCostForecast_Validate_OK proves a well-formed payload
// validates and the typed input round-trips.
func TestQueryCostForecast_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "months": 6}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed, ok := in.(queryCostForecastInput)
	if !ok {
		t.Fatalf("Validate returned %T, want queryCostForecastInput", in)
	}
	if typed.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", typed.VehicleID)
	}
	if typed.Months != 6 {
		t.Errorf("Months = %d, want 6", typed.Months)
	}
}

// TestQueryCostForecast_Validate_OK_OmittedMonths proves the
// months parameter is optional (the production adapter defaults
// to 6 when zero).
func TestQueryCostForecast_Validate_OK_OmittedMonths(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed := in.(queryCostForecastInput)
	if typed.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", typed.VehicleID)
	}
	if typed.Months != 0 {
		t.Errorf("Months = %d, want 0 (defaulted by Execute)", typed.Months)
	}
}

// TestQueryCostForecast_Validate_RejectsMissingVehicleID proves
// the required-validation rejects missing IDs. The dispatcher
// MUST always send vehicle_id; a missing one is a wiring bug.
func TestQueryCostForecast_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{}
	rawIn := json.RawMessage(`{}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for missing vehicle_id")
	}
}

// TestQueryCostForecast_Validate_RejectsMonthsOverCap proves the
// 1..24 months cap on the input matches the canonical
// /analytics/cost-forecast?months= bounds. An LLM-supplied 1000
// must fail validation before any SQL runs.
func TestQueryCostForecast_Validate_RejectsMonthsOverCap(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "months": 1000}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for months > 24")
	}
}

// TestQueryCostForecast_Execute_DelegatesAndPropagates proves the
// tool calls the port with the validated input and returns the
// canned envelope as-is.
func TestQueryCostForecast_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	canned := &CostForecast{
		VehicleID:            42,
		Currency:             "USD",
		HistoricalMonthCount: 9,
		MinRequiredMonths:    3,
		HasEnoughData:        true,
		DataThroughMonth:     "2024-09",
		ForecastMonths:       6,
		ForecastMethod:       "linear regression + calendar-month seasonal adjustment",
		UncertaintyMethod:    "residual standard error projected through prediction-interval formula",
		UncertaintyLevel:     "approximate 95% prediction interval (t≈2)",
		Assumptions: []string{
			"Forecast is a least-squares linear regression over monthly cost totals.",
		},
		Historical: []CostForecastHistoricalMonth{
			{Month: "2024-01", Cost: 80, KWh: 400, Sessions: 12, CostPerKWh: 0.20},
		},
		Forecast: []CostForecastFutureMonth{
			{Month: "2024-10", Cost: 95, CostLow: 80, CostHigh: 110, KWh: 480},
		},
		Breakdown: CostForecastBreakdown{
			Home:         CostForecastChargerCategory{Pct: 70, AvgCostPerKWh: 0.15, MonthlyAvg: 60},
			Supercharger: CostForecastChargerCategory{Pct: 30, AvgCostPerKWh: 0.40, MonthlyAvg: 30},
		},
		GasComparison: CostForecastGasComparison{
			AvgKmPerMonth:   1500,
			GasCostPerMonth: 250,
			EvCostPerMonth:  90,
			MonthlySavings:  160,
			AnnualSavings:   1920,
			LifetimeSavings: 9600,
		},
		Insights: []string{"Your cost per kWh has decreased 5% over the last 6 months"},
	}
	fake := &fakeCostForecaster{out: canned}
	tool := &queryCostForecast{forecaster: fake}

	rawIn := json.RawMessage(`{"vehicle_id": 42, "months": 6}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*CostForecast)
	if !ok {
		t.Fatalf("Execute returned %T, want *CostForecast", out)
	}
	if env != canned {
		t.Errorf("Execute returned a different envelope; want canned address pin")
	}
	if len(fake.calls) != 1 || fake.calls[0].vehicleID != 42 || fake.calls[0].months != 6 {
		t.Errorf("forecaster calls = %v, want [{42 6}]", fake.calls)
	}
}

// TestQueryCostForecast_Execute_DefaultsMonthsToSix proves the
// production adapter receives months=6 when the LLM omits the
// optional months input. The default mirrors the canonical
// /analytics/cost-forecast?months= default.
func TestQueryCostForecast_Execute_DefaultsMonthsToSix(t *testing.T) {
	t.Parallel()
	canned := &CostForecast{VehicleID: 42, ForecastMethod: "stub"}
	fake := &fakeCostForecaster{out: canned}
	tool := &queryCostForecast{forecaster: fake}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].months != 6 {
		t.Errorf("forecaster calls = %v, want months=6 default", fake.calls)
	}
}

// TestQueryCostForecast_Execute_NoForecasterWired proves a
// missing CostForecaster is reported as an Execute error so a
// wiring bug surfaces clearly at first call rather than at boot.
func TestQueryCostForecast_Execute_NoForecasterWired(t *testing.T) {
	t.Parallel()
	tool := &queryCostForecast{forecaster: nil}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil forecaster")
	}
	if !strings.Contains(err.Error(), "no CostForecaster") {
		t.Errorf("Execute err = %v, want 'no CostForecaster' message", err)
	}
}

// TestQueryCostForecast_Execute_NilEnvelopeIsError proves a
// forecaster that returns (nil, nil) is treated as a wiring bug
// rather than silently returning a nil envelope to the LLM.
func TestQueryCostForecast_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	fake := &fakeCostForecaster{out: nil, err: nil}
	tool := &queryCostForecast{forecaster: fake}
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

// TestQueryCostForecast_Execute_PropagatesForecasterError proves
// a forecast IO error reaches the dispatcher unmodified so the
// LLM-facing reply carries the original cause.
func TestQueryCostForecast_Execute_PropagatesForecasterError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("charging_sessions unreachable")
	fake := &fakeCostForecaster{err: sentinel}
	tool := &queryCostForecast{forecaster: fake}
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

// TestRegisterCostForecastNarrationTools_RegistersOne proves the
// registration helper adds the tool to the registry.
func TestRegisterCostForecastNarrationTools_RegistersOne(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterCostForecastNarrationTools(r, CostForecastNarrationSources{
		Forecaster: &fakeCostForecaster{},
	})
	for _, want := range []string{
		"query_cost_forecast",
	} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing %q after RegisterCostForecastNarrationTools", want)
		}
	}
}
