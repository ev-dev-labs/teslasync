// Unit tests for the retrieve_log_chunks + query_trace_window
// tools. Both tools wrap narrow ports (rag.Retriever /
// TraceWindowSource); tests substitute deterministic fakes so the
// unit tests stay hermetic.
//
// The query_trace_window tool also enforces the per-request scope
// binding that prevents prompt-injection exfiltration. The scope-binding tests
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

// retrieve_log_chunks

// fakeLogTraceRetriever is a hermetic stand-in for rag.Retriever.
// Records the request and returns either a canned chunk slice or
// a forced error.
type fakeLogTraceRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeLogTraceRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
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

func (f *fakeLogTraceRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

func (f *fakeLogTraceRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveLogChunks_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
	if got := tool.Name(); got != "retrieve_log_chunks" {
		t.Errorf("Name() = %q, want retrieve_log_chunks", got)
	}
}

func TestRetrieveLogChunks_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
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
	for _, must := range []string{"READ-only", "log_event", "trace_span"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveLogChunks_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
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

func TestRetrieveLogChunks_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
	raw := json.RawMessage(`{"query": "ingest backlog", "source_types": ["log_event"], "k": 5}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(retrieveLogChunksInput)
	if in.Query != "ingest backlog" {
		t.Errorf("Query = %q, want ingest backlog", in.Query)
	}
	if len(in.SourceTypes) != 1 || in.SourceTypes[0] != logTraceSourceLogEvent {
		t.Errorf("SourceTypes = %v, want [%s]", in.SourceTypes, logTraceSourceLogEvent)
	}
}

func TestRetrieveLogChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["user_note"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for disallowed source_type, want error")
	}
}

func TestRetrieveLogChunks_Validate_RejectsSystemEvent(t *testing.T) {
	t.Parallel()
	// The incident-timeline-summarizer allowlist has system_event;
	// the log-trace-summarization allowlist explicitly does NOT.
	// This test guards against a copy-paste mistake from the
	// related feature that would silently widen the surface.
	tool := &retrieveLogChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["system_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for system_event, want error")
	}
}

func TestRetrieveLogChunks_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["log_event", "log_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for duplicate source_type, want error")
	}
}

func TestRetrieveLogChunks_Validate_RejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": []}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for empty source_types, want error")
	}
}

func TestRetrieveLogChunks_Validate_RejectsLongQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
	long := strings.Repeat("x", logTraceMaxQueryChars+1)
	raw := json.RawMessage(`{"query": "` + long + `", "source_types": ["log_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap query, want error")
	}
}

func TestRetrieveLogChunks_Execute_DelegatesAndDefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeLogTraceRetriever{
		out: []rag.Chunk{
			{SourceType: logTraceSourceLogEvent, SourceID: "evt-1", ChunkIdx: 0, Text: "telemetry batch flushed", Score: 0.9},
		},
	}
	tool := &retrieveLogChunks{r: fake}
	in := retrieveLogChunksInput{
		Query:       "telemetry batch",
		SourceTypes: []string{logTraceSourceLogEvent},
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	m := out.(map[string]any)
	if m["k"].(int) != logTraceDefaultK {
		t.Errorf("k = %v, want %d", m["k"], logTraceDefaultK)
	}
	chunks := m["chunks"].([]retrievedLogChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "evt-1" {
		t.Errorf("chunks = %+v, want one evt-1 chunk", chunks)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected 1 retrieve call, got %d", len(fake.calls))
	}
	if fake.calls[0].k != logTraceDefaultK {
		t.Errorf("retriever.k = %d, want %d", fake.calls[0].k, logTraceDefaultK)
	}
}

func TestRetrieveLogChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveLogChunks{r: &fakeLogTraceRetriever{err: want}}
	in := retrieveLogChunksInput{
		Query:       "x",
		SourceTypes: []string{logTraceSourceLogEvent},
	}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "rag boom") {
		t.Errorf("Execute() err = %v, want rag boom", err)
	}
}

func TestRetrieveLogChunks_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveLogChunks{}
	in := retrieveLogChunksInput{Query: "x", SourceTypes: []string{logTraceSourceLogEvent}}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil retriever returned nil, want error")
	}
}

// query_trace_window

// fakeTraceWindowSource is a hermetic stand-in for
// TraceWindowSource. Records the request and returns either a
// canned envelope or a forced error.
type fakeTraceWindowSource struct {
	calls []struct {
		fromUnix  int64
		toUnix    int64
		vehicleID int64
	}
	envelope *TraceWindowEnvelope
	err      error
}

func (f *fakeTraceWindowSource) TraceWindow(_ context.Context, fromUnix, toUnix, vehicleID int64) (*TraceWindowEnvelope, error) {
	f.calls = append(f.calls, struct {
		fromUnix  int64
		toUnix    int64
		vehicleID int64
	}{fromUnix, toUnix, vehicleID})
	if f.err != nil {
		return nil, f.err
	}
	return f.envelope, nil
}

func TestQueryTraceWindow_Name(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{}
	if got := tool.Name(); got != "query_trace_window" {
		t.Errorf("Name() = %q, want query_trace_window", got)
	}
}

func TestQueryTraceWindow_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{}
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

func TestQueryTraceWindow_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	for _, must := range []string{"from_unix", "to_unix", "vehicle_id"} {
		if !strings.Contains(string(schema), must) {
			t.Errorf("InputSchema() missing %q: %s", must, schema)
		}
	}
}

func TestQueryTraceWindow_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{}
	raw := json.RawMessage(`{"from_unix": 1700000000, "to_unix": 1700001800}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(queryTraceWindowInput)
	if in.FromUnix != 1700000000 || in.ToUnix != 1700001800 {
		t.Errorf("got = %+v, want from=1700000000 to=1700001800", in)
	}
}

func TestQueryTraceWindow_Validate_RejectsMissingFromUnix(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{}
	raw := json.RawMessage(`{"to_unix": 1700001800}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing from_unix, want error")
	}
}

func TestQueryTraceWindow_Validate_RejectsToBeforeFrom(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{}
	raw := json.RawMessage(`{"from_unix": 1700001800, "to_unix": 1700000000}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for to_unix < from_unix, want error")
	}
}

func TestQueryTraceWindow_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	src := &fakeTraceWindowSource{
		envelope: &TraceWindowEnvelope{
			FromUnix:       1700000000,
			ToUnix:         1700001800,
			LogEventCount:  17,
			TraceSpanCount: 4,
		},
	}
	tool := &queryTraceWindow{src: src}
	in := queryTraceWindowInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedLogTraceWindow(context.Background(), ScopedLogTraceWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	got, ok := out.(*TraceWindowEnvelope)
	if !ok {
		t.Fatalf("Execute() = %T, want *TraceWindowEnvelope", out)
	}
	if got.LogEventCount != 17 || got.TraceSpanCount != 4 {
		t.Errorf("envelope = %+v, want log=17 trace=4", got)
	}
	if len(src.calls) != 1 {
		t.Fatalf("src.calls = %d, want 1", len(src.calls))
	}
	c := src.calls[0]
	if c.fromUnix != 1700000000 || c.toUnix != 1700001800 || c.vehicleID != 0 {
		t.Errorf("src.calls[0] = %+v, want from=... to=... vehicle=0", c)
	}
}

func TestQueryTraceWindow_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{}
	in := queryTraceWindowInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedLogTraceWindow(context.Background(), ScopedLogTraceWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil source returned nil, want error")
	}
}

func TestQueryTraceWindow_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	want := errors.New("source boom")
	tool := &queryTraceWindow{src: &fakeTraceWindowSource{err: want}}
	in := queryTraceWindowInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedLogTraceWindow(context.Background(), ScopedLogTraceWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil || !strings.Contains(err.Error(), "source boom") {
		t.Errorf("Execute() err = %v, want source boom", err)
	}
}

func TestQueryTraceWindow_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	tool := &queryTraceWindow{src: &fakeTraceWindowSource{}}
	in := queryTraceWindowInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedLogTraceWindow(context.Background(), ScopedLogTraceWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil envelope returned nil, want error")
	}
}

// TestQueryTraceWindow_Execute_RefusesMismatchedScope pins the
// security contract: an LLM that proposes a different window than
// the in-scope one (e.g. a prompt-injection attack via operator
// log message text) is REJECTED at the tool boundary before any
// source is touched. The fake source's calls slice MUST stay
// empty on a rejected call.
func TestQueryTraceWindow_Execute_RefusesMismatchedScope(t *testing.T) {
	t.Parallel()
	src := &fakeTraceWindowSource{
		envelope: &TraceWindowEnvelope{LogEventCount: 999},
	}
	tool := &queryTraceWindow{src: src}
	in := queryTraceWindowInput{FromUnix: 1500000000, ToUnix: 1500001800}
	ctx := WithScopedLogTraceWindow(context.Background(), ScopedLogTraceWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	_, err := tool.Execute(ctx, in)
	if err == nil {
		t.Fatal("Execute() with mismatched scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "does not match in-scope window") {
		t.Errorf("Execute() err = %v, want a 'does not match' message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite scope mismatch; want 0", len(src.calls))
	}
}

// TestQueryTraceWindow_Execute_RefusesMismatchedVehicle pins the
// vehicle-scope contract: when the in-scope tuple narrows to one
// vehicle, the tool refuses any LLM-supplied vehicle_id that does
// not match — including 0 (which would silently widen the
// envelope to all vehicles).
func TestQueryTraceWindow_Execute_RefusesMismatchedVehicle(t *testing.T) {
	t.Parallel()
	src := &fakeTraceWindowSource{
		envelope: &TraceWindowEnvelope{},
	}
	tool := &queryTraceWindow{src: src}
	in := queryTraceWindowInput{FromUnix: 1700000000, ToUnix: 1700001800, VehicleID: 0}
	ctx := WithScopedLogTraceWindow(context.Background(), ScopedLogTraceWindow{
		FromUnix:  1700000000,
		ToUnix:    1700001800,
		VehicleID: 7,
	})
	_, err := tool.Execute(ctx, in)
	if err == nil {
		t.Fatal("Execute() with mismatched vehicle scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "does not match in-scope vehicle_id") {
		t.Errorf("Execute() err = %v, want a 'does not match in-scope vehicle_id' message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite vehicle mismatch; want 0", len(src.calls))
	}
}

// TestQueryTraceWindow_Execute_RefusesMissingScope pins the
// missing-scope contract: if the dispatcher is invoked from an
// unintended path (no scope installed), the tool refuses.
func TestQueryTraceWindow_Execute_RefusesMissingScope(t *testing.T) {
	t.Parallel()
	src := &fakeTraceWindowSource{envelope: &TraceWindowEnvelope{}}
	tool := &queryTraceWindow{src: src}
	in := queryTraceWindowInput{FromUnix: 1700000000, ToUnix: 1700001800}
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute() with missing scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "no in-scope log/trace window") {
		t.Errorf("Execute() err = %v, want a missing-scope message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite missing scope; want 0", len(src.calls))
	}
}

// TestScopedLogTraceWindowRoundTrip pins the public helpers'
// contract: installing then reading returns the same value, and
// reading from a context with no scope returns the zero value /
// false.
func TestScopedLogTraceWindowRoundTrip(t *testing.T) {
	t.Parallel()
	want := ScopedLogTraceWindow{FromUnix: 100, ToUnix: 200, VehicleID: 7}
	ctx := WithScopedLogTraceWindow(context.Background(), want)
	got, ok := ScopedLogTraceWindowFromContext(ctx)
	if !ok || got != want {
		t.Errorf("ScopedLogTraceWindowFromContext = (%+v,%v), want (%+v,true)", got, ok, want)
	}
	got, ok = ScopedLogTraceWindowFromContext(context.Background())
	if ok || got != (ScopedLogTraceWindow{}) {
		t.Errorf("ScopedLogTraceWindowFromContext on unscoped ctx = (%+v,%v), want (zero,false)", got, ok)
	}
}

// Registration + helpers

func TestRegisterLogTraceSummarizerTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	src := &fakeTraceWindowSource{}
	ret := &fakeLogTraceRetriever{}
	RegisterLogTraceSummarizerTools(r, LogTraceSummarizerSources{
		Retriever:   ret,
		TraceWindow: src,
	})
	for _, name := range []string{"query_trace_window", "retrieve_log_chunks"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("registry missing %q after RegisterLogTraceSummarizerTools", name)
		}
	}
}

func TestAllowedLogTraceSourceTypes_DefensiveCopyAndOrder(t *testing.T) {
	t.Parallel()
	first := AllowedLogTraceSourceTypes()
	if len(first) != 2 {
		t.Fatalf("AllowedLogTraceSourceTypes len = %d, want 2", len(first))
	}
	first[0] = "MUTATED"
	second := AllowedLogTraceSourceTypes()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedLogTraceSourceTypes leaked mutation: second[0] = %q", second[0])
	}
	// Lexicographic order is stable for diagnostic output:
	// log_event < trace_span.
	want := []string{"log_event", "trace_span"}
	for i, w := range want {
		if second[i] != w {
			t.Errorf("AllowedLogTraceSourceTypes[%d] = %q, want %q", i, second[i], w)
		}
	}
}
