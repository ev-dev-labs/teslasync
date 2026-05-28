// Phase-50 / 0041 — X2 Lifetime stats Q&A.
//
// Unit tests for the retrieve_analytics_chunks + query_lifetime_stats
// tools. Both tools wrap narrow ports (rag.Retriever /
// LifetimeStatsSource); tests substitute deterministic fakes so the
// unit tests stay hermetic.

package lifetime

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
// retrieve_analytics_chunks
// ---------------------------------------------------------------------------

// fakeAnalyticsRetriever is a hermetic stand-in for rag.Retriever.
// Records the request and returns either a canned chunk slice or a
// forced error.
type fakeAnalyticsRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeAnalyticsRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
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
func (f *fakeAnalyticsRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

// Index is a no-op for the test fake — the tools the slice
// registers never call it. Required to satisfy [rag.Retriever].
func (f *fakeAnalyticsRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveAnalyticsChunks_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
	if got := tool.Name(); got != "retrieve_analytics_chunks" {
		t.Errorf("Name() = %q, want retrieve_analytics_chunks", got)
	}
}

func TestRetrieveAnalyticsChunks_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
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
	for _, must := range []string{"READ-only", "analytics_lifetime", "drive_summary", "charge_session"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveAnalyticsChunks_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
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

func TestRetrieveAnalyticsChunks_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
	raw := json.RawMessage(`{"query": "longest drive", "source_types": ["drive_summary"], "k": 5}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(retrieveAnalyticsChunksInput)
	if in.Query != "longest drive" {
		t.Errorf("Query = %q, want longest drive", in.Query)
	}
	if len(in.SourceTypes) != 1 || in.SourceTypes[0] != rag.SourceDriveSummary {
		t.Errorf("SourceTypes = %v, want [%s]", in.SourceTypes, rag.SourceDriveSummary)
	}
}

func TestRetrieveAnalyticsChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["user_note"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for disallowed source_type, want error")
	}
}

func TestRetrieveAnalyticsChunks_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["drive_summary", "drive_summary"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for duplicate source_type, want error")
	}
}

func TestRetrieveAnalyticsChunks_Validate_RejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
	raw := json.RawMessage(`{"query": "hi", "source_types": []}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for empty source_types, want error")
	}
}

func TestRetrieveAnalyticsChunks_Validate_RejectsLongQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
	long := strings.Repeat("x", lifetimeStatsMaxQueryChars+1)
	raw := json.RawMessage(`{"query": "` + long + `", "source_types": ["drive_summary"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap query, want error")
	}
}

func TestRetrieveAnalyticsChunks_Execute_DelegatesAndDefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeAnalyticsRetriever{
		out: []rag.Chunk{
			{SourceType: rag.SourceDriveSummary, SourceID: "drive-1", ChunkIdx: 0, Text: "long drive", Score: 0.9},
		},
	}
	tool := &retrieveAnalyticsChunks{r: fake}
	in := retrieveAnalyticsChunksInput{
		Query:       "longest drive",
		SourceTypes: []string{rag.SourceDriveSummary},
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	m := out.(map[string]any)
	if m["k"].(int) != lifetimeStatsDefaultK {
		t.Errorf("k = %v, want %d", m["k"], lifetimeStatsDefaultK)
	}
	chunks := m["chunks"].([]retrievedAnalyticsChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "drive-1" {
		t.Errorf("chunks = %+v, want one drive-1 chunk", chunks)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected 1 retrieve call, got %d", len(fake.calls))
	}
	if fake.calls[0].k != lifetimeStatsDefaultK {
		t.Errorf("retriever.k = %d, want %d", fake.calls[0].k, lifetimeStatsDefaultK)
	}
}

func TestRetrieveAnalyticsChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveAnalyticsChunks{r: &fakeAnalyticsRetriever{err: want}}
	in := retrieveAnalyticsChunksInput{
		Query:       "x",
		SourceTypes: []string{rag.SourceDriveSummary},
	}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "rag boom") {
		t.Errorf("Execute() err = %v, want rag boom", err)
	}
}

func TestRetrieveAnalyticsChunks_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveAnalyticsChunks{}
	in := retrieveAnalyticsChunksInput{Query: "x", SourceTypes: []string{rag.SourceDriveSummary}}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil retriever returned nil, want error")
	}
}

// ---------------------------------------------------------------------------
// query_lifetime_stats
// ---------------------------------------------------------------------------

// fakeLifetimeStatsSource is a hermetic stand-in for
// LifetimeStatsSource. Records the request and returns either a
// canned envelope or a forced error.
type fakeLifetimeStatsSource struct {
	calls    []int64
	envelope *LifetimeStatsEnvelope
	err      error
}

func (f *fakeLifetimeStatsSource) LifetimeStats(_ context.Context, vehicleID int64) (*LifetimeStatsEnvelope, error) {
	f.calls = append(f.calls, vehicleID)
	if f.err != nil {
		return nil, f.err
	}
	return f.envelope, nil
}

func TestQueryLifetimeStats_Name(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{}
	if got := tool.Name(); got != "query_lifetime_stats" {
		t.Errorf("Name() = %q, want query_lifetime_stats", got)
	}
}

func TestQueryLifetimeStats_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{}
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
	for _, must := range []string{"READ-only", "deterministic", "lifetime"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestQueryLifetimeStats_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	if !strings.Contains(string(schema), "vehicle_id") {
		t.Errorf("InputSchema() missing vehicle_id: %s", schema)
	}
}

func TestQueryLifetimeStats_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{}
	raw := json.RawMessage(`{"vehicle_id": 42}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(queryLifetimeStatsInput)
	if in.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", in.VehicleID)
	}
}

func TestQueryLifetimeStats_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{}
	raw := json.RawMessage(`{}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing vehicle_id, want error")
	}
}

func TestQueryLifetimeStats_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{}
	raw := json.RawMessage(`{"vehicle_id": 0}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for vehicle_id=0, want error")
	}
}

func TestQueryLifetimeStats_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	src := &fakeLifetimeStatsSource{
		envelope: &LifetimeStatsEnvelope{
			TotalDrives:     487,
			TotalDistanceKm: 12345.0,
			OwnershipDays:   312,
		},
	}
	tool := &queryLifetimeStats{src: src}
	in := queryLifetimeStatsInput{VehicleID: 42}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	got, ok := out.(*LifetimeStatsEnvelope)
	if !ok {
		t.Fatalf("Execute() = %T, want *LifetimeStatsEnvelope", out)
	}
	if got.TotalDrives != 487 || got.TotalDistanceKm != 12345.0 || got.OwnershipDays != 312 {
		t.Errorf("envelope = %+v, want totals 487/12345/312", got)
	}
	if len(src.calls) != 1 || src.calls[0] != 42 {
		t.Errorf("src.calls = %v, want [42]", src.calls)
	}
}

func TestQueryLifetimeStats_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{}
	in := queryLifetimeStatsInput{VehicleID: 42}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil source returned nil, want error")
	}
}

func TestQueryLifetimeStats_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	want := errors.New("source boom")
	tool := &queryLifetimeStats{src: &fakeLifetimeStatsSource{err: want}}
	in := queryLifetimeStatsInput{VehicleID: 42}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "source boom") {
		t.Errorf("Execute() err = %v, want source boom", err)
	}
}

func TestQueryLifetimeStats_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	tool := &queryLifetimeStats{src: &fakeLifetimeStatsSource{}}
	in := queryLifetimeStatsInput{VehicleID: 42}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil envelope returned nil, want error")
	}
}

// ---------------------------------------------------------------------------
// Registration + helpers
// ---------------------------------------------------------------------------

func TestRegisterLifetimeStatsQATools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	src := &fakeLifetimeStatsSource{}
	ret := &fakeAnalyticsRetriever{}
	RegisterLifetimeStatsQATools(r, LifetimeStatsQASources{
		Retriever:     ret,
		LifetimeStats: src,
	})
	for _, name := range []string{"query_lifetime_stats", "retrieve_analytics_chunks"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("registry missing %q after RegisterLifetimeStatsQATools", name)
		}
	}
}

func TestAllowedAnalyticsSourceTypes_DefensiveCopyAndOrder(t *testing.T) {
	t.Parallel()
	first := AllowedAnalyticsSourceTypes()
	if len(first) != 3 {
		t.Fatalf("AllowedAnalyticsSourceTypes len = %d, want 3", len(first))
	}
	first[0] = "MUTATED"
	second := AllowedAnalyticsSourceTypes()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedAnalyticsSourceTypes leaked mutation: second[0] = %q", second[0])
	}
	// Lexicographic order is stable for diagnostic output:
	// analytics_lifetime < charge_session < drive_summary.
	want := []string{"analytics_lifetime", rag.SourceChargeSession, rag.SourceDriveSummary}
	for i, w := range want {
		if second[i] != w {
			t.Errorf("AllowedAnalyticsSourceTypes[%d] = %q, want %q", i, second[i], w)
		}
	}
}
