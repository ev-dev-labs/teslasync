// Phase-50 / 0049 — M1 Predictive maintenance.
//
// Unit tests for the retrieve_maintenance_chunks +
// query_maintenance_context tools. Both tools wrap narrow ports
// (rag.Retriever / MaintenancePredictionContextSource); tests
// substitute deterministic fakes so the unit tests stay
// hermetic.
//
// The query_maintenance_context tool also enforces the per-
// request scope binding the slice prompt's security model
// relies on (defence against prompt-injection exfiltration via
// operator-authored service-record description / provider
// strings). The scope-binding tests pin the contract: missing
// scope ⇒ refuse; mismatched scope ⇒ refuse; matched scope ⇒
// delegate. A future edit that bypasses any of these gates
// would surface here.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
)

// ---------------------------------------------------------------------------
// retrieve_maintenance_chunks
// ---------------------------------------------------------------------------

// fakeMaintenanceRetriever is a hermetic stand-in for
// rag.Retriever. Records the request and returns either a
// canned chunk slice or a forced error.
type fakeMaintenanceRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeMaintenanceRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
	f.calls = append(f.calls, struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}{subject, query, append([]string{}, sourceTypes...), k})
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

func (f *fakeMaintenanceRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

func (f *fakeMaintenanceRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveMaintenanceChunks_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	if got := tool.Name(); got != "retrieve_maintenance_chunks" {
		t.Errorf("Name() = %q, want retrieve_maintenance_chunks", got)
	}
}

func TestRetrieveMaintenanceChunks_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.Description() == "" {
		t.Errorf("Description() = empty, want a non-empty description")
	}
	desc := tool.Description()
	for _, must := range []string{"READ-only", "maintenance_event", "vehicle_state", "ml_anomaly"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveMaintenanceChunks_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	for _, must := range []string{"query", "source_types", "k"} {
		if !strings.Contains(string(schema), must) {
			t.Errorf("InputSchema() = %s, want substring %q", string(schema), must)
		}
	}
}

// TestRetrieveMaintenanceChunks_InputSchemaOmitsVehicleID pins
// the security contract: the LLM cannot ask the retriever for
// another vehicle's chunks because the tool's input shape does
// NOT accept vehicle_id. Per-vehicle separation is handled by
// the F7 retriever's per-subject filter (subjects scoped to the
// calling operator's session). A future edit that widens the
// input would silently expose a prompt-injection exfiltration
// surface; this test surfaces it.
func TestRetrieveMaintenanceChunks_InputSchemaOmitsVehicleID(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	schema := string(tool.InputSchema())
	if strings.Contains(schema, "vehicle_id") {
		t.Errorf("InputSchema() unexpectedly contains vehicle_id: %s", schema)
	}
}

func TestRetrieveMaintenanceChunks_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	raw := json.RawMessage(`{"query": "tire wear risk", "source_types": ["maintenance_event"], "k": 5}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(retrieveMaintenanceChunksInput)
	if in.Query != "tire wear risk" {
		t.Errorf("Query = %q, want tire wear risk", in.Query)
	}
	if len(in.SourceTypes) != 1 || in.SourceTypes[0] != maintenanceSourceMaintenanceEvent {
		t.Errorf("SourceTypes = %v, want [%s]", in.SourceTypes, maintenanceSourceMaintenanceEvent)
	}
}

func TestRetrieveMaintenanceChunks_Validate_AcceptsAllAllowedSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	raw := json.RawMessage(`{"query": "x", "source_types": ["maintenance_event", "vehicle_state", "ml_anomaly"]}`)
	if _, err := tool.Validate(raw); err != nil {
		t.Errorf("Validate() err = %v, want nil for full allowlist", err)
	}
}

func TestRetrieveMaintenanceChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["user_note"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for disallowed source_type, want error")
	}
}

// TestRetrieveMaintenanceChunks_Validate_RejectsFSMTransition guards
// against a copy-paste mistake from the sister slice 0048
// state-machine-debugger-narrator (whose allowlist includes
// fsm_transition) silently widening this slice's surface.
func TestRetrieveMaintenanceChunks_Validate_RejectsFSMTransition(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["fsm_transition"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for fsm_transition, want error")
	}
}

func TestRetrieveMaintenanceChunks_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["maintenance_event", "maintenance_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for duplicate source_type, want error")
	}
}

func TestRetrieveMaintenanceChunks_Validate_RejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": []}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for empty source_types, want error")
	}
}

func TestRetrieveMaintenanceChunks_Validate_RejectsLongQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	long := strings.Repeat("x", maintenancePredictionMaxQueryChars+1)
	raw := json.RawMessage(`{"query": "` + long + `", "source_types": ["maintenance_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap query, want error")
	}
}

func TestRetrieveMaintenanceChunks_Execute_DelegatesAndDefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeMaintenanceRetriever{
		out: []rag.Chunk{
			{SourceType: maintenanceSourceMaintenanceEvent, SourceID: "rec-1", ChunkIdx: 0, Text: "tire rotation last 12k miles ago", Score: 0.91},
		},
	}
	tool := &retrieveMaintenanceChunks{r: fake}
	in := retrieveMaintenanceChunksInput{
		Query:       "tire wear",
		SourceTypes: []string{maintenanceSourceMaintenanceEvent},
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	m := out.(map[string]any)
	if m["k"].(int) != maintenancePredictionDefaultK {
		t.Errorf("k = %v, want %d", m["k"], maintenancePredictionDefaultK)
	}
	chunks := m["chunks"].([]retrievedMaintenanceChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "rec-1" {
		t.Errorf("chunks = %+v, want one rec-1 chunk", chunks)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected 1 retrieve call, got %d", len(fake.calls))
	}
	if fake.calls[0].k != maintenancePredictionDefaultK {
		t.Errorf("retriever.k = %d, want %d", fake.calls[0].k, maintenancePredictionDefaultK)
	}
}

func TestRetrieveMaintenanceChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveMaintenanceChunks{r: &fakeMaintenanceRetriever{err: want}}
	in := retrieveMaintenanceChunksInput{
		Query:       "x",
		SourceTypes: []string{maintenanceSourceMaintenanceEvent},
	}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "rag boom") {
		t.Errorf("Execute() err = %v, want rag boom", err)
	}
}

func TestRetrieveMaintenanceChunks_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveMaintenanceChunks{}
	in := retrieveMaintenanceChunksInput{Query: "x", SourceTypes: []string{maintenanceSourceMaintenanceEvent}}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil retriever returned nil, want error")
	}
}

// ---------------------------------------------------------------------------
// query_maintenance_context
// ---------------------------------------------------------------------------

// fakeMaintenanceContextSource is a hermetic stand-in for
// MaintenancePredictionContextSource. Records the request and
// returns either a canned envelope or a forced error.
type fakeMaintenanceContextSource struct {
	calls []struct {
		vehicleID int64
	}
	envelope *MaintenancePredictionContextEnvelope
	err      error
}

func (f *fakeMaintenanceContextSource) MaintenanceContext(_ context.Context, vehicleID int64) (*MaintenancePredictionContextEnvelope, error) {
	f.calls = append(f.calls, struct{ vehicleID int64 }{vehicleID})
	if f.err != nil {
		return nil, f.err
	}
	return f.envelope, nil
}

func TestQueryMaintenanceContext_Name(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{}
	if got := tool.Name(); got != "query_maintenance_context" {
		t.Errorf("Name() = %q, want query_maintenance_context", got)
	}
}

func TestQueryMaintenanceContext_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.Description() == "" {
		t.Errorf("Description() = empty, want a non-empty description")
	}
	desc := tool.Description()
	for _, must := range []string{"READ-only", "deterministic", "in-scope"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestQueryMaintenanceContext_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	if !strings.Contains(string(schema), "vehicle_id") {
		t.Errorf("InputSchema() missing vehicle_id: %s", schema)
	}
}

func TestQueryMaintenanceContext_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{}
	raw := json.RawMessage(`{"vehicle_id": 42}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(queryMaintenanceContextInput)
	if in.VehicleID != 42 {
		t.Errorf("got = %+v, want vehicle=42", in)
	}
}

func TestQueryMaintenanceContext_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{}
	raw := json.RawMessage(`{}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing vehicle_id, want error")
	}
}

func TestQueryMaintenanceContext_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{}
	raw := json.RawMessage(`{"vehicle_id": 0}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for vehicle_id=0, want error")
	}
}

func TestQueryMaintenanceContext_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	mileage := 42000.0
	src := &fakeMaintenanceContextSource{
		envelope: &MaintenancePredictionContextEnvelope{
			VehicleID:      42,
			CurrentMileage: &mileage,
			Items: []MaintenancePredictionItem{
				{ID: 1, Category: "filters", Name: "Cabin Air Filter", Status: "soon"},
			},
			Summary: MaintenancePredictionSummary{Total: 1, DueSoon: 1},
		},
	}
	tool := &queryMaintenanceContext{src: src}
	in := queryMaintenanceContextInput{VehicleID: 42}
	ctx := WithScopedMaintenancePredictionWindow(context.Background(), ScopedMaintenancePredictionWindow{
		VehicleID: 42,
	})
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	got, ok := out.(*MaintenancePredictionContextEnvelope)
	if !ok {
		t.Fatalf("Execute() = %T, want *MaintenancePredictionContextEnvelope", out)
	}
	if got.VehicleID != 42 || got.Summary.Total != 1 {
		t.Errorf("envelope = %+v, want vehicle=42 total=1", got)
	}
	if len(src.calls) != 1 {
		t.Fatalf("src.calls = %d, want 1", len(src.calls))
	}
	c := src.calls[0]
	if c.vehicleID != 42 {
		t.Errorf("src.calls[0] = %+v, want vehicle=42", c)
	}
}

func TestQueryMaintenanceContext_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{}
	in := queryMaintenanceContextInput{VehicleID: 42}
	ctx := WithScopedMaintenancePredictionWindow(context.Background(), ScopedMaintenancePredictionWindow{
		VehicleID: 42,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil source returned nil, want error")
	}
}

func TestQueryMaintenanceContext_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	want := errors.New("source boom")
	tool := &queryMaintenanceContext{src: &fakeMaintenanceContextSource{err: want}}
	in := queryMaintenanceContextInput{VehicleID: 42}
	ctx := WithScopedMaintenancePredictionWindow(context.Background(), ScopedMaintenancePredictionWindow{
		VehicleID: 42,
	})
	if _, err := tool.Execute(ctx, in); err == nil || !strings.Contains(err.Error(), "source boom") {
		t.Errorf("Execute() err = %v, want source boom", err)
	}
}

func TestQueryMaintenanceContext_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	tool := &queryMaintenanceContext{src: &fakeMaintenanceContextSource{}}
	in := queryMaintenanceContextInput{VehicleID: 42}
	ctx := WithScopedMaintenancePredictionWindow(context.Background(), ScopedMaintenancePredictionWindow{
		VehicleID: 42,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil envelope returned nil, want error")
	}
}

// TestQueryMaintenanceContext_Execute_RefusesMismatchedScopeVehicle
// pins the security contract: an LLM that proposes a different
// vehicle than the in-scope one (e.g. a prompt-injection attack
// via an operator-authored service-record description /
// provider string) is REJECTED at the tool boundary before any
// source is touched. The fake source's calls slice MUST stay
// empty on a rejected call.
func TestQueryMaintenanceContext_Execute_RefusesMismatchedScopeVehicle(t *testing.T) {
	t.Parallel()
	src := &fakeMaintenanceContextSource{envelope: &MaintenancePredictionContextEnvelope{VehicleID: 99}}
	tool := &queryMaintenanceContext{src: src}
	in := queryMaintenanceContextInput{VehicleID: 99}
	ctx := WithScopedMaintenancePredictionWindow(context.Background(), ScopedMaintenancePredictionWindow{
		VehicleID: 42,
	})
	_, err := tool.Execute(ctx, in)
	if err == nil {
		t.Fatal("Execute() with mismatched vehicle scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "does not match in-scope vehicle_id") {
		t.Errorf("Execute() err = %v, want a 'does not match' message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite scope mismatch; want 0", len(src.calls))
	}
}

// TestQueryMaintenanceContext_Execute_RefusesMissingScope pins
// the missing-scope contract: if the dispatcher is invoked from
// an unintended path (no scope installed), the tool refuses.
func TestQueryMaintenanceContext_Execute_RefusesMissingScope(t *testing.T) {
	t.Parallel()
	src := &fakeMaintenanceContextSource{envelope: &MaintenancePredictionContextEnvelope{}}
	tool := &queryMaintenanceContext{src: src}
	in := queryMaintenanceContextInput{VehicleID: 42}
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute() with missing scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "no in-scope maintenance-prediction vehicle") {
		t.Errorf("Execute() err = %v, want a missing-scope message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite missing scope; want 0", len(src.calls))
	}
}

// ---------------------------------------------------------------------------
// Registration + helpers
// ---------------------------------------------------------------------------

func TestRegisterPredictiveMaintenanceTools_AddsBothTools(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	src := &fakeMaintenanceContextSource{}
	ret := &fakeMaintenanceRetriever{}
	RegisterPredictiveMaintenanceTools(r, PredictiveMaintenanceSources{
		Retriever:          ret,
		MaintenanceContext: src,
	})
	names := r.Names()
	wantSet := map[string]bool{
		"query_maintenance_context":    false,
		"retrieve_maintenance_chunks":  false,
	}
	for _, n := range names {
		if _, ok := wantSet[n]; ok {
			wantSet[n] = true
		}
	}
	for k, v := range wantSet {
		if !v {
			t.Errorf("RegisterPredictiveMaintenanceTools did not register %q (got %v)", k, names)
		}
	}
}

func TestAllowedMaintenancePredictionSourceTypes_IsDefensiveCopy(t *testing.T) {
	t.Parallel()
	a := AllowedMaintenancePredictionSourceTypes()
	b := AllowedMaintenancePredictionSourceTypes()
	if &a[0] == &b[0] {
		t.Error("AllowedMaintenancePredictionSourceTypes returns the same backing array; should be a copy")
	}
	a[0] = "tampered"
	if AllowedMaintenancePredictionSourceTypes()[0] == "tampered" {
		t.Error("mutating the returned slice mutates the package-internal allowlist; bug")
	}
}
