// Phase-50 / 0048 — S7 State-machine debugger narrator.
//
// Unit tests for the retrieve_fsm_chunks + query_fsm_trace tools.
// Both tools wrap narrow ports (rag.Retriever / FSMTraceSource);
// tests substitute deterministic fakes so the unit tests stay
// hermetic.
//
// The query_fsm_trace tool also enforces the per-request scope
// binding the slice prompt's security model relies on (defence
// against prompt-injection exfiltration). The scope-binding tests
// pin the contract: missing scope ⇒ refuse; mismatched scope ⇒
// refuse; matched scope ⇒ delegate. A future edit that bypasses
// any of these gates would surface here.

package summary

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// retrieve_fsm_chunks
// ---------------------------------------------------------------------------

// fakeFSMTraceRetriever is a hermetic stand-in for rag.Retriever.
// Records the request and returns either a canned chunk slice or
// a forced error.
type fakeFSMTraceRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeFSMTraceRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
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

func (f *fakeFSMTraceRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

func (f *fakeFSMTraceRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveFSMChunks_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	if got := tool.Name(); got != "retrieve_fsm_chunks" {
		t.Errorf("Name() = %q, want retrieve_fsm_chunks", got)
	}
}

func TestRetrieveFSMChunks_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
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
	for _, must := range []string{"READ-only", "fsm_transition", "signal_history_summary"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveFSMChunks_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
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

func TestRetrieveFSMChunks_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	raw := json.RawMessage(`{"query": "online to asleep flap", "source_types": ["fsm_transition"], "k": 5}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(retrieveFSMChunksInput)
	if in.Query != "online to asleep flap" {
		t.Errorf("Query = %q, want online to asleep flap", in.Query)
	}
	if len(in.SourceTypes) != 1 || in.SourceTypes[0] != fsmSourceTransition {
		t.Errorf("SourceTypes = %v, want [%s]", in.SourceTypes, fsmSourceTransition)
	}
}

func TestRetrieveFSMChunks_Validate_AcceptsAllAllowedSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	raw := json.RawMessage(`{"query": "x", "source_types": ["fsm_transition", "signal_history_summary"]}`)
	if _, err := tool.Validate(raw); err != nil {
		t.Errorf("Validate() err = %v, want nil for full allowlist", err)
	}
}

func TestRetrieveFSMChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["user_note"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for disallowed source_type, want error")
	}
}

func TestRetrieveFSMChunks_Validate_RejectsMqttStatus(t *testing.T) {
	t.Parallel()
	// The mqtt-sse-inspector-explanations allowlist has
	// mqtt_status; the state-machine-debugger-narrator
	// allowlist explicitly does NOT. This test guards against a
	// copy-paste mistake from the sister slice that would
	// silently widen the surface.
	tool := &retrieveFSMChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["mqtt_status"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for mqtt_status, want error")
	}
}

func TestRetrieveFSMChunks_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["fsm_transition", "fsm_transition"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for duplicate source_type, want error")
	}
}

func TestRetrieveFSMChunks_Validate_RejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": []}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for empty source_types, want error")
	}
}

func TestRetrieveFSMChunks_Validate_RejectsLongQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	long := strings.Repeat("x", fsmTraceMaxQueryChars+1)
	raw := json.RawMessage(`{"query": "` + long + `", "source_types": ["fsm_transition"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap query, want error")
	}
}

func TestRetrieveFSMChunks_Execute_DelegatesAndDefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeFSMTraceRetriever{
		out: []rag.Chunk{
			{SourceType: fsmSourceTransition, SourceID: "fsm-1", ChunkIdx: 0, Text: "online → asleep flap", Score: 0.9},
		},
	}
	tool := &retrieveFSMChunks{r: fake}
	in := retrieveFSMChunksInput{
		Query:       "online to asleep",
		SourceTypes: []string{fsmSourceTransition},
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	m := out.(map[string]any)
	if m["k"].(int) != fsmTraceDefaultK {
		t.Errorf("k = %v, want %d", m["k"], fsmTraceDefaultK)
	}
	chunks := m["chunks"].([]retrievedFSMChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "fsm-1" {
		t.Errorf("chunks = %+v, want one fsm-1 chunk", chunks)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected 1 retrieve call, got %d", len(fake.calls))
	}
	if fake.calls[0].k != fsmTraceDefaultK {
		t.Errorf("retriever.k = %d, want %d", fake.calls[0].k, fsmTraceDefaultK)
	}
}

func TestRetrieveFSMChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveFSMChunks{r: &fakeFSMTraceRetriever{err: want}}
	in := retrieveFSMChunksInput{
		Query:       "x",
		SourceTypes: []string{fsmSourceTransition},
	}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "rag boom") {
		t.Errorf("Execute() err = %v, want rag boom", err)
	}
}

func TestRetrieveFSMChunks_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveFSMChunks{}
	in := retrieveFSMChunksInput{Query: "x", SourceTypes: []string{fsmSourceTransition}}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil retriever returned nil, want error")
	}
}

// ---------------------------------------------------------------------------
// query_fsm_trace
// ---------------------------------------------------------------------------

// fakeFSMTraceSource is a hermetic stand-in for FSMTraceSource.
// Records the request and returns either a canned envelope or a
// forced error.
type fakeFSMTraceSource struct {
	calls []struct {
		vehicleID int64
		fromUnix  int64
		toUnix    int64
	}
	envelope *FSMTraceEnvelope
	err      error
}

func (f *fakeFSMTraceSource) FSMTrace(_ context.Context, vehicleID, fromUnix, toUnix int64) (*FSMTraceEnvelope, error) {
	f.calls = append(f.calls, struct {
		vehicleID int64
		fromUnix  int64
		toUnix    int64
	}{vehicleID, fromUnix, toUnix})
	if f.err != nil {
		return nil, f.err
	}
	return f.envelope, nil
}

func TestQueryFSMTrace_Name(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
	if got := tool.Name(); got != "query_fsm_trace" {
		t.Errorf("Name() = %q, want query_fsm_trace", got)
	}
}

func TestQueryFSMTrace_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
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

func TestQueryFSMTrace_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	for _, must := range []string{"vehicle_id", "from_unix", "to_unix"} {
		if !strings.Contains(string(schema), must) {
			t.Errorf("InputSchema() missing %q: %s", must, schema)
		}
	}
}

func TestQueryFSMTrace_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
	raw := json.RawMessage(`{"vehicle_id": 42, "from_unix": 1700000000, "to_unix": 1700001800}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(queryFSMTraceInput)
	if in.VehicleID != 42 || in.FromUnix != 1700000000 || in.ToUnix != 1700001800 {
		t.Errorf("got = %+v, want vehicle=42 from=1700000000 to=1700001800", in)
	}
}

func TestQueryFSMTrace_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
	raw := json.RawMessage(`{"from_unix": 1700000000, "to_unix": 1700001800}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing vehicle_id, want error")
	}
}

func TestQueryFSMTrace_Validate_RejectsMissingFromUnix(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
	raw := json.RawMessage(`{"vehicle_id": 42, "to_unix": 1700001800}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing from_unix, want error")
	}
}

func TestQueryFSMTrace_Validate_RejectsToBeforeFrom(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
	raw := json.RawMessage(`{"vehicle_id": 42, "from_unix": 1700001800, "to_unix": 1700000000}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for to_unix < from_unix, want error")
	}
}

func TestQueryFSMTrace_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	src := &fakeFSMTraceSource{
		envelope: &FSMTraceEnvelope{
			VehicleID:        42,
			FromUnix:         1700000000,
			ToUnix:           1700001800,
			TotalTransitions: 5,
			FlapCount:        0,
		},
	}
	tool := &queryFSMTrace{src: src}
	in := queryFSMTraceInput{VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedFSMTraceWindow(context.Background(), ScopedFSMTraceWindow{
		VehicleID: 42,
		FromUnix:  1700000000,
		ToUnix:    1700001800,
	})
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	got, ok := out.(*FSMTraceEnvelope)
	if !ok {
		t.Fatalf("Execute() = %T, want *FSMTraceEnvelope", out)
	}
	if got.VehicleID != 42 || got.TotalTransitions != 5 {
		t.Errorf("envelope = %+v, want vehicle=42 total=5", got)
	}
	if len(src.calls) != 1 {
		t.Fatalf("src.calls = %d, want 1", len(src.calls))
	}
	c := src.calls[0]
	if c.vehicleID != 42 || c.fromUnix != 1700000000 || c.toUnix != 1700001800 {
		t.Errorf("src.calls[0] = %+v, want vehicle=42 from=1700000000 to=1700001800", c)
	}
}

func TestQueryFSMTrace_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{}
	in := queryFSMTraceInput{VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedFSMTraceWindow(context.Background(), ScopedFSMTraceWindow{
		VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil source returned nil, want error")
	}
}

func TestQueryFSMTrace_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	want := errors.New("source boom")
	tool := &queryFSMTrace{src: &fakeFSMTraceSource{err: want}}
	in := queryFSMTraceInput{VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedFSMTraceWindow(context.Background(), ScopedFSMTraceWindow{
		VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil || !strings.Contains(err.Error(), "source boom") {
		t.Errorf("Execute() err = %v, want source boom", err)
	}
}

func TestQueryFSMTrace_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	tool := &queryFSMTrace{src: &fakeFSMTraceSource{}}
	in := queryFSMTraceInput{VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedFSMTraceWindow(context.Background(), ScopedFSMTraceWindow{
		VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil envelope returned nil, want error")
	}
}

// TestQueryFSMTrace_Execute_RefusesMismatchedScopeVehicle pins
// the security contract: an LLM that proposes a different
// vehicle than the in-scope one (e.g. a prompt-injection attack
// via an operator-readable field) is REJECTED at the tool
// boundary before any source is touched. The fake source's calls
// slice MUST stay empty on a rejected call.
func TestQueryFSMTrace_Execute_RefusesMismatchedScopeVehicle(t *testing.T) {
	t.Parallel()
	src := &fakeFSMTraceSource{envelope: &FSMTraceEnvelope{VehicleID: 99}}
	tool := &queryFSMTrace{src: src}
	in := queryFSMTraceInput{VehicleID: 99, FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedFSMTraceWindow(context.Background(), ScopedFSMTraceWindow{
		VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800,
	})
	_, err := tool.Execute(ctx, in)
	if err == nil {
		t.Fatal("Execute() with mismatched vehicle scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "does not match in-scope tuple") {
		t.Errorf("Execute() err = %v, want a 'does not match' message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite scope mismatch; want 0", len(src.calls))
	}
}

func TestQueryFSMTrace_Execute_RefusesMismatchedScopeWindow(t *testing.T) {
	t.Parallel()
	src := &fakeFSMTraceSource{envelope: &FSMTraceEnvelope{VehicleID: 42}}
	tool := &queryFSMTrace{src: src}
	in := queryFSMTraceInput{VehicleID: 42, FromUnix: 1500000000, ToUnix: 1500001800}
	ctx := WithScopedFSMTraceWindow(context.Background(), ScopedFSMTraceWindow{
		VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800,
	})
	_, err := tool.Execute(ctx, in)
	if err == nil {
		t.Fatal("Execute() with mismatched window scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "does not match in-scope tuple") {
		t.Errorf("Execute() err = %v, want a 'does not match' message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite scope mismatch; want 0", len(src.calls))
	}
}

// TestQueryFSMTrace_Execute_RefusesMissingScope pins the
// missing-scope contract: if the dispatcher is invoked from an
// unintended path (no scope installed), the tool refuses.
func TestQueryFSMTrace_Execute_RefusesMissingScope(t *testing.T) {
	t.Parallel()
	src := &fakeFSMTraceSource{envelope: &FSMTraceEnvelope{}}
	tool := &queryFSMTrace{src: src}
	in := queryFSMTraceInput{VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800}
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute() with missing scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "no in-scope fsm-trace tuple") {
		t.Errorf("Execute() err = %v, want a missing-scope message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite missing scope; want 0", len(src.calls))
	}
}

// ---------------------------------------------------------------------------
// Registration + helpers
// ---------------------------------------------------------------------------

func TestRegisterStateMachineDebuggerNarratorTools_AddsBothTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	src := &fakeFSMTraceSource{}
	ret := &fakeFSMTraceRetriever{}
	RegisterStateMachineDebuggerNarratorTools(r, StateMachineDebuggerNarratorSources{
		Retriever: ret,
		FSMTrace:  src,
	})
	for _, name := range []string{"query_fsm_trace", "retrieve_fsm_chunks"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("registry missing tool %q", name)
		}
	}
}

func TestAllowedFSMTraceSourceTypes_DefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedFSMTraceSourceTypes()
	first[0] = "MUTATED"
	second := AllowedFSMTraceSourceTypes()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedFSMTraceSourceTypes leaked mutation: %q", second[0])
	}
}

func TestScopedFSMTraceWindow_RoundTrip(t *testing.T) {
	t.Parallel()
	want := ScopedFSMTraceWindow{VehicleID: 42, FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedFSMTraceWindow(context.Background(), want)
	got, ok := ScopedFSMTraceWindowFromContext(ctx)
	if !ok {
		t.Fatal("ScopedFSMTraceWindowFromContext = (_, false), want (_, true)")
	}
	if got != want {
		t.Errorf("got = %+v, want %+v", got, want)
	}
}

func TestScopedFSMTraceWindow_AbsentReturnsFalse(t *testing.T) {
	t.Parallel()
	if _, ok := ScopedFSMTraceWindowFromContext(context.Background()); ok {
		t.Fatal("ScopedFSMTraceWindowFromContext = (_, true) for empty ctx, want false")
	}
}
