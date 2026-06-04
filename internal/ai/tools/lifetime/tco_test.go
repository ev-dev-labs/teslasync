// Unit tests for the query_tco_summary tool. The tool wraps a
// narrow [TCOSummarizer] port; tests substitute a deterministic
// fake so the unit tests stay hermetic.

package lifetime

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// fakeTCOSummarizer is a hermetic stand-in for
// *api.AITCOSummarizer. It records the request vehicle_id and
// returns either a canned envelope or a forced error.
type fakeTCOSummarizer struct {
	calls []int64
	out   *TCOSummary
	err   error
}

func (f *fakeTCOSummarizer) SummarizeTCO(_ context.Context, vehicleID int64) (*TCOSummary, error) {
	f.calls = append(f.calls, vehicleID)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestQueryTCOSummary_Name pins the canonical tool name. The
// strategy + goldens both reference it; a rename here without a
// matching rename in the strategy's allowedTools whitelist would
// silently break the dispatcher's tool-call routing.
func TestQueryTCOSummary_Name(t *testing.T) {
	t.Parallel()
	tool := &queryTCOSummary{}
	if got := tool.Name(); got != "query_tco_summary" {
		t.Errorf("Name() = %q, want query_tco_summary", got)
	}
}

// TestQueryTCOSummary_PropOnlyContract pins the read-only
// metadata. ADR-015 §I3 requires this tool to stay read-only.
// The description MUST disclose the four limiting
// assumptions so the LLM treats the envelope as operating-cost
// only.
func TestQueryTCOSummary_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryTCOSummary{}
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
	// Honest-scope pins — the rubber-duck critique flagged
	// "full TCO" overclaim as the blocking risk; the
	// description guards against a future edit reintroducing
	// the overclaim.
	desc := tool.Description()
	for _, must := range []string{
		"OPERATING COST only",
		"NOT included",
		"flat $50-per-month heuristic",
		"ESTIMATED from charging energy",
		"user-editable settings",
	} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q; got=%q", must, desc)
		}
	}
}

// TestQueryTCOSummary_InputSchemaNonEmpty proves the schema
// cache hands back a non-nil JSON document so the LLM has
// guidance for the call arguments.
func TestQueryTCOSummary_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryTCOSummary{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	if !strings.Contains(string(schema), "vehicle_id") {
		t.Errorf("InputSchema() = %s, want substring 'vehicle_id'", string(schema))
	}
}

// TestQueryTCOSummary_Validate_OK proves a well-formed payload
// validates and the typed input round-trips.
func TestQueryTCOSummary_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryTCOSummary{}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed, ok := in.(queryTCOSummaryInput)
	if !ok {
		t.Fatalf("Validate returned %T, want queryTCOSummaryInput", in)
	}
	if typed.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", typed.VehicleID)
	}
}

// TestQueryTCOSummary_Validate_RejectsMissingVehicleID proves
// the required-validation rejects missing IDs. The dispatcher
// MUST always send vehicle_id; a missing one is a wiring bug.
func TestQueryTCOSummary_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryTCOSummary{}
	rawIn := json.RawMessage(`{}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for missing vehicle_id")
	}
}

// TestQueryTCOSummary_Validate_RejectsZero proves the gte=1
// validator catches a zero ID before any SQL runs.
func TestQueryTCOSummary_Validate_RejectsZero(t *testing.T) {
	t.Parallel()
	tool := &queryTCOSummary{}
	rawIn := json.RawMessage(`{"vehicle_id": 0}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for vehicle_id=0")
	}
}

// TestQueryTCOSummary_Execute_DelegatesAndPropagates proves the
// tool calls the port with the validated input and returns the
// canned envelope as-is.
func TestQueryTCOSummary_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	canned := &TCOSummary{
		VehicleID:                  42,
		Currency:                   "USD",
		TotalChargingCost:          1234.56,
		TotalWh:                    5_000_000,
		TotalSessions:              30,
		TotalKm:                    8000,
		FirstDate:                  "2024-01-01",
		LastDate:                   "2024-09-30",
		MonthsOfOwnership:          9.0,
		CostPerKmEV:                0.155,
		CostPerKmICE:               0.230,
		EquivalentGasCost:          1840.00,
		TotalSavings:               605.44,
		MonthlySavings:             67.27,
		MaintenanceSavingsEstimate: 450.00,
		GasPrice:                   3.50,
		GasEfficiencyMPG:           25,
		BaseCostPerKWh:             0.12,
		MonthlyBreakdown: []TCOMonthlyEntry{
			{Month: "2024-01", EVCost: 110.00, EquivGasCost: 200.00, Savings: 90.00, CumSavings: 90.00, EnergyWh: 500_000},
		},
		Assumptions: []string{
			"Operating cost only — purchase price, depreciation, insurance, registration, taxes, financing, and resale value are NOT included.",
		},
	}
	fake := &fakeTCOSummarizer{out: canned}
	tool := &queryTCOSummary{summarizer: fake}

	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*TCOSummary)
	if !ok {
		t.Fatalf("Execute returned %T, want *TCOSummary", out)
	}
	if env != canned {
		t.Errorf("Execute returned a different envelope; want canned address pin")
	}
	if len(fake.calls) != 1 || fake.calls[0] != 42 {
		t.Errorf("summarizer calls = %v, want [42]", fake.calls)
	}
}

// TestQueryTCOSummary_Execute_NoSummarizerWired proves a missing
// TCOSummarizer is reported as an Execute error so a wiring bug
// surfaces clearly at first call rather than at boot.
func TestQueryTCOSummary_Execute_NoSummarizerWired(t *testing.T) {
	t.Parallel()
	tool := &queryTCOSummary{summarizer: nil}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil summarizer")
	}
	if !strings.Contains(err.Error(), "no TCOSummarizer") {
		t.Errorf("Execute err = %v, want 'no TCOSummarizer' message", err)
	}
}

// TestQueryTCOSummary_Execute_NilEnvelopeIsError proves a
// summarizer that returns (nil, nil) is treated as a wiring bug
// rather than silently returning a nil envelope to the LLM.
func TestQueryTCOSummary_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	fake := &fakeTCOSummarizer{out: nil, err: nil}
	tool := &queryTCOSummary{summarizer: fake}
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

// TestQueryTCOSummary_Execute_PropagatesSummarizerError proves a
// summarizer IO error reaches the dispatcher unmodified so the
// LLM-facing reply carries the original cause.
func TestQueryTCOSummary_Execute_PropagatesSummarizerError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("charging_sessions unreachable")
	fake := &fakeTCOSummarizer{err: sentinel}
	tool := &queryTCOSummary{summarizer: fake}
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

// TestRegisterTCONarrationTools_RegistersOne proves the
// registration helper adds the tool to the registry.
func TestRegisterTCONarrationTools_RegistersOne(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterTCONarrationTools(r, TCONarrationSources{
		Summarizer: &fakeTCOSummarizer{},
	})
	for _, want := range []string{
		"query_tco_summary",
	} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing %q after RegisterTCONarrationTools", want)
		}
	}
}
