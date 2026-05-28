// Phase-50 / 0042 — S1 Incident timeline summarizer.
//
// Unit tests for the retrieve_system_chunks + query_incident_timeline
// tools. Both tools wrap narrow ports (rag.Retriever /
// IncidentTimelineSource); tests substitute deterministic fakes so
// the unit tests stay hermetic.
//
// The query_incident_timeline tool also enforces the per-request
// scope binding the slice prompt's security model relies on
// (defence against prompt-injection exfiltration). The scope-binding
// tests pin the contract: missing scope ⇒ refuse; mismatched scope
// ⇒ refuse; matched scope ⇒ delegate. A future edit that bypasses
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
// retrieve_system_chunks
// ---------------------------------------------------------------------------

// fakeSystemRetriever is a hermetic stand-in for rag.Retriever.
// Records the request and returns either a canned chunk slice or a
// forced error.
type fakeSystemRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeSystemRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
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

// Forget is a no-op for the test fake — the tools the slice
// registers never call it. Required to satisfy [rag.Retriever].
func (f *fakeSystemRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

// Index is a no-op for the test fake — the tools the slice
// registers never call it. Required to satisfy [rag.Retriever].
func (f *fakeSystemRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveSystemChunks_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
	if got := tool.Name(); got != "retrieve_system_chunks" {
		t.Errorf("Name() = %q, want retrieve_system_chunks", got)
	}
}

func TestRetrieveSystemChunks_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
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
	for _, must := range []string{"READ-only", "system_event", "audit_log"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveSystemChunks_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
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

func TestRetrieveSystemChunks_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
	raw := json.RawMessage(`{"query": "ingest backlog", "source_types": ["system_event"], "k": 5}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(retrieveSystemChunksInput)
	if in.Query != "ingest backlog" {
		t.Errorf("Query = %q, want ingest backlog", in.Query)
	}
	if len(in.SourceTypes) != 1 || in.SourceTypes[0] != incidentTimelineSourceSystemEvent {
		t.Errorf("SourceTypes = %v, want [%s]", in.SourceTypes, incidentTimelineSourceSystemEvent)
	}
}

func TestRetrieveSystemChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["user_note"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for disallowed source_type, want error")
	}
}

func TestRetrieveSystemChunks_Validate_RejectsDriveSummary(t *testing.T) {
	t.Parallel()
	// The lifetime-stats-qa allowlist has drive_summary; the
	// incident-timeline-summarizer allowlist explicitly does NOT.
	// This test guards against a copy-paste mistake from the
	// sister slice that would silently widen the surface.
	tool := &retrieveSystemChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["drive_summary"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for drive_summary, want error")
	}
}

func TestRetrieveSystemChunks_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["system_event", "system_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for duplicate source_type, want error")
	}
}

func TestRetrieveSystemChunks_Validate_RejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": []}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for empty source_types, want error")
	}
}

func TestRetrieveSystemChunks_Validate_RejectsLongQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
	long := strings.Repeat("x", incidentTimelineMaxQueryChars+1)
	raw := json.RawMessage(`{"query": "` + long + `", "source_types": ["system_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap query, want error")
	}
}

func TestRetrieveSystemChunks_Execute_DelegatesAndDefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeSystemRetriever{
		out: []rag.Chunk{
			{SourceType: incidentTimelineSourceSystemEvent, SourceID: "evt-1", ChunkIdx: 0, Text: "ingest backlog detected", Score: 0.9},
		},
	}
	tool := &retrieveSystemChunks{r: fake}
	in := retrieveSystemChunksInput{
		Query:       "ingest backlog",
		SourceTypes: []string{incidentTimelineSourceSystemEvent},
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	m := out.(map[string]any)
	if m["k"].(int) != incidentTimelineDefaultK {
		t.Errorf("k = %v, want %d", m["k"], incidentTimelineDefaultK)
	}
	chunks := m["chunks"].([]retrievedSystemChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "evt-1" {
		t.Errorf("chunks = %+v, want one evt-1 chunk", chunks)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected 1 retrieve call, got %d", len(fake.calls))
	}
	if fake.calls[0].k != incidentTimelineDefaultK {
		t.Errorf("retriever.k = %d, want %d", fake.calls[0].k, incidentTimelineDefaultK)
	}
}

func TestRetrieveSystemChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveSystemChunks{r: &fakeSystemRetriever{err: want}}
	in := retrieveSystemChunksInput{
		Query:       "x",
		SourceTypes: []string{incidentTimelineSourceSystemEvent},
	}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "rag boom") {
		t.Errorf("Execute() err = %v, want rag boom", err)
	}
}

func TestRetrieveSystemChunks_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveSystemChunks{}
	in := retrieveSystemChunksInput{Query: "x", SourceTypes: []string{incidentTimelineSourceSystemEvent}}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil retriever returned nil, want error")
	}
}

// ---------------------------------------------------------------------------
// query_incident_timeline
// ---------------------------------------------------------------------------

// fakeIncidentTimelineSource is a hermetic stand-in for
// IncidentTimelineSource. Records the request and returns either a
// canned envelope or a forced error.
type fakeIncidentTimelineSource struct {
	calls    []int64
	envelope *IncidentTimelineEnvelope
	err      error
}

func (f *fakeIncidentTimelineSource) IncidentTimeline(_ context.Context, incidentID int64) (*IncidentTimelineEnvelope, error) {
	f.calls = append(f.calls, incidentID)
	if f.err != nil {
		return nil, f.err
	}
	return f.envelope, nil
}

func TestQueryIncidentTimeline_Name(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{}
	if got := tool.Name(); got != "query_incident_timeline" {
		t.Errorf("Name() = %q, want query_incident_timeline", got)
	}
}

func TestQueryIncidentTimeline_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{}
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
	for _, must := range []string{"READ-only", "deterministic", "incident", "in-scope"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestQueryIncidentTimeline_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	if !strings.Contains(string(schema), "incident_id") {
		t.Errorf("InputSchema() missing incident_id: %s", schema)
	}
}

func TestQueryIncidentTimeline_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{}
	raw := json.RawMessage(`{"incident_id": 7}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(queryIncidentTimelineInput)
	if in.IncidentID != 7 {
		t.Errorf("IncidentID = %d, want 7", in.IncidentID)
	}
}

func TestQueryIncidentTimeline_Validate_RejectsMissingIncidentID(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{}
	raw := json.RawMessage(`{}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing incident_id, want error")
	}
}

func TestQueryIncidentTimeline_Validate_RejectsZeroIncidentID(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{}
	raw := json.RawMessage(`{"incident_id": 0}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for incident_id=0, want error")
	}
}

func TestQueryIncidentTimeline_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	src := &fakeIncidentTimelineSource{
		envelope: &IncidentTimelineEnvelope{
			ID:           7,
			Title:        "Telemetry ingest queue backlog",
			Severity:     "high",
			Status:       "resolved",
			TotalUpdates: 5,
		},
	}
	tool := &queryIncidentTimeline{src: src}
	in := queryIncidentTimelineInput{IncidentID: 7}
	ctx := WithScopedIncidentID(context.Background(), 7)
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	got, ok := out.(*IncidentTimelineEnvelope)
	if !ok {
		t.Fatalf("Execute() = %T, want *IncidentTimelineEnvelope", out)
	}
	if got.ID != 7 || got.TotalUpdates != 5 || got.Status != "resolved" {
		t.Errorf("envelope = %+v, want id=7 total=5 status=resolved", got)
	}
	if len(src.calls) != 1 || src.calls[0] != 7 {
		t.Errorf("src.calls = %v, want [7]", src.calls)
	}
}

func TestQueryIncidentTimeline_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{}
	in := queryIncidentTimelineInput{IncidentID: 7}
	ctx := WithScopedIncidentID(context.Background(), 7)
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil source returned nil, want error")
	}
}

func TestQueryIncidentTimeline_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	want := errors.New("source boom")
	tool := &queryIncidentTimeline{src: &fakeIncidentTimelineSource{err: want}}
	in := queryIncidentTimelineInput{IncidentID: 7}
	ctx := WithScopedIncidentID(context.Background(), 7)
	if _, err := tool.Execute(ctx, in); err == nil || !strings.Contains(err.Error(), "source boom") {
		t.Errorf("Execute() err = %v, want source boom", err)
	}
}

func TestQueryIncidentTimeline_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	tool := &queryIncidentTimeline{src: &fakeIncidentTimelineSource{}}
	in := queryIncidentTimelineInput{IncidentID: 7}
	ctx := WithScopedIncidentID(context.Background(), 7)
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil envelope returned nil, want error")
	}
}

// TestQueryIncidentTimeline_Execute_RefusesMismatchedScope pins the
// security contract: an LLM that proposes a different incident_id
// than the in-scope one (e.g. a prompt-injection attack via incident
// message text) is REJECTED at the tool boundary before any source
// is touched. The fake source's calls slice MUST stay empty on a
// rejected call.
func TestQueryIncidentTimeline_Execute_RefusesMismatchedScope(t *testing.T) {
	t.Parallel()
	src := &fakeIncidentTimelineSource{
		envelope: &IncidentTimelineEnvelope{ID: 99},
	}
	tool := &queryIncidentTimeline{src: src}
	in := queryIncidentTimelineInput{IncidentID: 99}
	ctx := WithScopedIncidentID(context.Background(), 7)
	_, err := tool.Execute(ctx, in)
	if err == nil {
		t.Fatal("Execute() with mismatched scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "does not match in-scope incident") {
		t.Errorf("Execute() err = %v, want a 'does not match' message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite scope mismatch; want 0", len(src.calls))
	}
}

// TestQueryIncidentTimeline_Execute_RefusesMissingScope pins the
// missing-scope contract: if the dispatcher is invoked from an
// unintended path (no scope installed), the tool refuses. The AI
// handler is the only path that should be loading this tool, and
// it ALWAYS installs the scope.
func TestQueryIncidentTimeline_Execute_RefusesMissingScope(t *testing.T) {
	t.Parallel()
	src := &fakeIncidentTimelineSource{
		envelope: &IncidentTimelineEnvelope{ID: 7},
	}
	tool := &queryIncidentTimeline{src: src}
	in := queryIncidentTimelineInput{IncidentID: 7}
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute() with missing scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "no in-scope incident ID") {
		t.Errorf("Execute() err = %v, want a missing-scope message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite missing scope; want 0", len(src.calls))
	}
}

// TestScopedIncidentIDRoundTrip pins the public helpers' contract:
// installing then reading returns the same value, and reading from
// a context with no scope returns (0, false).
func TestScopedIncidentIDRoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithScopedIncidentID(context.Background(), 42)
	id, ok := ScopedIncidentIDFromContext(ctx)
	if !ok || id != 42 {
		t.Errorf("ScopedIncidentIDFromContext = (%d,%v), want (42,true)", id, ok)
	}
	id, ok = ScopedIncidentIDFromContext(context.Background())
	if ok || id != 0 {
		t.Errorf("ScopedIncidentIDFromContext on unscoped ctx = (%d,%v), want (0,false)", id, ok)
	}
}

// ---------------------------------------------------------------------------
// Registration + helpers
// ---------------------------------------------------------------------------

func TestRegisterIncidentTimelineSummarizerTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	src := &fakeIncidentTimelineSource{}
	ret := &fakeSystemRetriever{}
	RegisterIncidentTimelineSummarizerTools(r, IncidentTimelineSummarizerSources{
		Retriever:        ret,
		IncidentTimeline: src,
	})
	for _, name := range []string{"query_incident_timeline", "retrieve_system_chunks"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("registry missing %q after RegisterIncidentTimelineSummarizerTools", name)
		}
	}
}

func TestAllowedIncidentTimelineSourceTypes_DefensiveCopyAndOrder(t *testing.T) {
	t.Parallel()
	first := AllowedIncidentTimelineSourceTypes()
	if len(first) != 2 {
		t.Fatalf("AllowedIncidentTimelineSourceTypes len = %d, want 2", len(first))
	}
	first[0] = "MUTATED"
	second := AllowedIncidentTimelineSourceTypes()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedIncidentTimelineSourceTypes leaked mutation: second[0] = %q", second[0])
	}
	// Lexicographic order is stable for diagnostic output:
	// audit_log < system_event.
	want := []string{"audit_log", "system_event"}
	for i, w := range want {
		if second[i] != w {
			t.Errorf("AllowedIncidentTimelineSourceTypes[%d] = %q, want %q", i, second[i], w)
		}
	}
}
