// MQTT and SSE inspector explanation tests.
//
// Unit tests for the retrieve_stream_chunks + query_stream_inspector
// tools. Both tools wrap narrow ports (rag.Retriever /
// StreamInspectorSource); tests substitute deterministic fakes so
// the unit tests stay hermetic.
//
// The query_stream_inspector tool also enforces the per-request
// scope binding the feature requirements' security model relies on
// (defence against prompt-injection exfiltration). The scope-
// binding tests pin the contract: missing scope ⇒ refuse;
// mismatched scope ⇒ refuse; matched scope ⇒ delegate. A future
// edit that bypasses any of these gates would surface here.

package diagnostic

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
// retrieve_stream_chunks
// ---------------------------------------------------------------------------

// fakeStreamInspectorRetriever is a hermetic stand-in for
// rag.Retriever. Records the request and returns either a canned
// chunk slice or a forced error.
type fakeStreamInspectorRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeStreamInspectorRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
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

func (f *fakeStreamInspectorRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

func (f *fakeStreamInspectorRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveStreamChunks_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	if got := tool.Name(); got != "retrieve_stream_chunks" {
		t.Errorf("Name() = %q, want retrieve_stream_chunks", got)
	}
}

func TestRetrieveStreamChunks_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
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
	for _, must := range []string{"READ-only", "mqtt_status", "sse_status", "job_status"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveStreamChunks_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
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

func TestRetrieveStreamChunks_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	raw := json.RawMessage(`{"query": "broker disconnect", "source_types": ["mqtt_status"], "k": 5}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(retrieveStreamChunksInput)
	if in.Query != "broker disconnect" {
		t.Errorf("Query = %q, want broker disconnect", in.Query)
	}
	if len(in.SourceTypes) != 1 || in.SourceTypes[0] != streamSourceMQTTStatus {
		t.Errorf("SourceTypes = %v, want [%s]", in.SourceTypes, streamSourceMQTTStatus)
	}
}

func TestRetrieveStreamChunks_Validate_AcceptsAllAllowedSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	raw := json.RawMessage(`{"query": "x", "source_types": ["mqtt_status", "sse_status", "job_status"]}`)
	if _, err := tool.Validate(raw); err != nil {
		t.Errorf("Validate() err = %v, want nil for full allowlist", err)
	}
}

func TestRetrieveStreamChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["user_note"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for disallowed source_type, want error")
	}
}

func TestRetrieveStreamChunks_Validate_RejectsLogEvent(t *testing.T) {
	t.Parallel()
	// The log-trace-summarization allowlist has log_event; the
	// mqtt-sse-inspector-explanations allowlist explicitly does
	// NOT. This test guards against a copy-paste mistake from
	// a neighboring feature that would silently widen the surface.
	tool := &retrieveStreamChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["log_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for log_event, want error")
	}
}

func TestRetrieveStreamChunks_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["mqtt_status", "mqtt_status"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for duplicate source_type, want error")
	}
}

func TestRetrieveStreamChunks_Validate_RejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": []}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for empty source_types, want error")
	}
}

func TestRetrieveStreamChunks_Validate_RejectsLongQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	long := strings.Repeat("x", streamInspectorMaxQueryChars+1)
	raw := json.RawMessage(`{"query": "` + long + `", "source_types": ["mqtt_status"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap query, want error")
	}
}

func TestRetrieveStreamChunks_Execute_DelegatesAndDefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeStreamInspectorRetriever{
		out: []rag.Chunk{
			{SourceType: streamSourceMQTTStatus, SourceID: "evt-1", ChunkIdx: 0, Text: "broker reconnect", Score: 0.9},
		},
	}
	tool := &retrieveStreamChunks{r: fake}
	in := retrieveStreamChunksInput{
		Query:       "broker reconnect",
		SourceTypes: []string{streamSourceMQTTStatus},
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	m := out.(map[string]any)
	if m["k"].(int) != streamInspectorDefaultK {
		t.Errorf("k = %v, want %d", m["k"], streamInspectorDefaultK)
	}
	chunks := m["chunks"].([]retrievedStreamChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "evt-1" {
		t.Errorf("chunks = %+v, want one evt-1 chunk", chunks)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected 1 retrieve call, got %d", len(fake.calls))
	}
	if fake.calls[0].k != streamInspectorDefaultK {
		t.Errorf("retriever.k = %d, want %d", fake.calls[0].k, streamInspectorDefaultK)
	}
}

func TestRetrieveStreamChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveStreamChunks{r: &fakeStreamInspectorRetriever{err: want}}
	in := retrieveStreamChunksInput{
		Query:       "x",
		SourceTypes: []string{streamSourceMQTTStatus},
	}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "rag boom") {
		t.Errorf("Execute() err = %v, want rag boom", err)
	}
}

func TestRetrieveStreamChunks_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveStreamChunks{}
	in := retrieveStreamChunksInput{Query: "x", SourceTypes: []string{streamSourceMQTTStatus}}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil retriever returned nil, want error")
	}
}

// ---------------------------------------------------------------------------
// query_stream_inspector
// ---------------------------------------------------------------------------

// fakeStreamInspectorSource is a hermetic stand-in for
// StreamInspectorSource. Records the request and returns either a
// canned envelope or a forced error.
type fakeStreamInspectorSource struct {
	calls []struct {
		fromUnix int64
		toUnix   int64
	}
	envelope *StreamInspectorEnvelope
	err      error
}

func (f *fakeStreamInspectorSource) StreamInspector(_ context.Context, fromUnix, toUnix int64) (*StreamInspectorEnvelope, error) {
	f.calls = append(f.calls, struct {
		fromUnix int64
		toUnix   int64
	}{fromUnix, toUnix})
	if f.err != nil {
		return nil, f.err
	}
	return f.envelope, nil
}

func TestQueryStreamInspector_Name(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{}
	if got := tool.Name(); got != "query_stream_inspector" {
		t.Errorf("Name() = %q, want query_stream_inspector", got)
	}
}

func TestQueryStreamInspector_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{}
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

func TestQueryStreamInspector_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	for _, must := range []string{"from_unix", "to_unix"} {
		if !strings.Contains(string(schema), must) {
			t.Errorf("InputSchema() missing %q: %s", must, schema)
		}
	}
}

func TestQueryStreamInspector_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{}
	raw := json.RawMessage(`{"from_unix": 1700000000, "to_unix": 1700001800}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(queryStreamInspectorInput)
	if in.FromUnix != 1700000000 || in.ToUnix != 1700001800 {
		t.Errorf("got = %+v, want from=1700000000 to=1700001800", in)
	}
}

func TestQueryStreamInspector_Validate_RejectsMissingFromUnix(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{}
	raw := json.RawMessage(`{"to_unix": 1700001800}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing from_unix, want error")
	}
}

func TestQueryStreamInspector_Validate_RejectsToBeforeFrom(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{}
	raw := json.RawMessage(`{"from_unix": 1700001800, "to_unix": 1700000000}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for to_unix < from_unix, want error")
	}
}

func TestQueryStreamInspector_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	src := &fakeStreamInspectorSource{
		envelope: &StreamInspectorEnvelope{
			FromUnix:          1700000000,
			ToUnix:            1700001800,
			MQTTConnected:     true,
			VehicleCount:      3,
			StaleVehicleCount: 1,
		},
	}
	tool := &queryStreamInspector{src: src}
	in := queryStreamInspectorInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedStreamInspectorWindow(context.Background(), ScopedStreamInspectorWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	got, ok := out.(*StreamInspectorEnvelope)
	if !ok {
		t.Fatalf("Execute() = %T, want *StreamInspectorEnvelope", out)
	}
	if got.VehicleCount != 3 || got.StaleVehicleCount != 1 || !got.MQTTConnected {
		t.Errorf("envelope = %+v, want vehicle=3 stale=1 connected=true", got)
	}
	if len(src.calls) != 1 {
		t.Fatalf("src.calls = %d, want 1", len(src.calls))
	}
	c := src.calls[0]
	if c.fromUnix != 1700000000 || c.toUnix != 1700001800 {
		t.Errorf("src.calls[0] = %+v, want from=1700000000 to=1700001800", c)
	}
}

func TestQueryStreamInspector_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{}
	in := queryStreamInspectorInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedStreamInspectorWindow(context.Background(), ScopedStreamInspectorWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil source returned nil, want error")
	}
}

func TestQueryStreamInspector_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	want := errors.New("source boom")
	tool := &queryStreamInspector{src: &fakeStreamInspectorSource{err: want}}
	in := queryStreamInspectorInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedStreamInspectorWindow(context.Background(), ScopedStreamInspectorWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil || !strings.Contains(err.Error(), "source boom") {
		t.Errorf("Execute() err = %v, want source boom", err)
	}
}

func TestQueryStreamInspector_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	tool := &queryStreamInspector{src: &fakeStreamInspectorSource{}}
	in := queryStreamInspectorInput{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedStreamInspectorWindow(context.Background(), ScopedStreamInspectorWindow{
		FromUnix: 1700000000,
		ToUnix:   1700001800,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil envelope returned nil, want error")
	}
}

// TestQueryStreamInspector_Execute_RefusesMismatchedScope pins
// the security contract: an LLM that proposes a different window
// than the in-scope one (e.g. a prompt-injection attack via an
// operator-readable field) is REJECTED at the tool boundary
// before any source is touched. The fake source's calls slice
// MUST stay empty on a rejected call.
func TestQueryStreamInspector_Execute_RefusesMismatchedScope(t *testing.T) {
	t.Parallel()
	src := &fakeStreamInspectorSource{
		envelope: &StreamInspectorEnvelope{VehicleCount: 999},
	}
	tool := &queryStreamInspector{src: src}
	in := queryStreamInspectorInput{FromUnix: 1500000000, ToUnix: 1500001800}
	ctx := WithScopedStreamInspectorWindow(context.Background(), ScopedStreamInspectorWindow{
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

// TestQueryStreamInspector_Execute_RefusesMissingScope pins the
// missing-scope contract: if the dispatcher is invoked from an
// unintended path (no scope installed), the tool refuses.
func TestQueryStreamInspector_Execute_RefusesMissingScope(t *testing.T) {
	t.Parallel()
	src := &fakeStreamInspectorSource{envelope: &StreamInspectorEnvelope{}}
	tool := &queryStreamInspector{src: src}
	in := queryStreamInspectorInput{FromUnix: 1700000000, ToUnix: 1700001800}
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute() with missing scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "no in-scope stream-inspector window") {
		t.Errorf("Execute() err = %v, want a missing-scope message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite missing scope; want 0", len(src.calls))
	}
}

// ---------------------------------------------------------------------------
// Registration + helpers
// ---------------------------------------------------------------------------

func TestRegisterMqttSseInspectorExplanationsTools_AddsBothTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	src := &fakeStreamInspectorSource{}
	ret := &fakeStreamInspectorRetriever{}
	RegisterMqttSseInspectorExplanationsTools(r, MqttSseInspectorExplanationsSources{
		Retriever:       ret,
		StreamInspector: src,
	})
	for _, name := range []string{"query_stream_inspector", "retrieve_stream_chunks"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("registry missing tool %q", name)
		}
	}
}

func TestAllowedStreamInspectorSourceTypes_DefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedStreamInspectorSourceTypes()
	first[0] = "MUTATED"
	second := AllowedStreamInspectorSourceTypes()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedStreamInspectorSourceTypes leaked mutation: %q", second[0])
	}
}

func TestScopedStreamInspectorWindow_RoundTrip(t *testing.T) {
	t.Parallel()
	want := ScopedStreamInspectorWindow{FromUnix: 1700000000, ToUnix: 1700001800}
	ctx := WithScopedStreamInspectorWindow(context.Background(), want)
	got, ok := ScopedStreamInspectorWindowFromContext(ctx)
	if !ok {
		t.Fatal("ScopedStreamInspectorWindowFromContext = (_, false), want (_, true)")
	}
	if got != want {
		t.Errorf("got = %+v, want %+v", got, want)
	}
}

func TestScopedStreamInspectorWindow_AbsentReturnsFalse(t *testing.T) {
	t.Parallel()
	if _, ok := ScopedStreamInspectorWindowFromContext(context.Background()); ok {
		t.Fatal("ScopedStreamInspectorWindowFromContext = (_, true) for empty ctx, want false")
	}
}
