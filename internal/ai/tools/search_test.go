// Tool tests for retrieve_chunks and hydrate_search_result. Both tools
// are pure functions over typed input plus a narrow port, and the tests
// use deterministic fakes to stay hermetic.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
)

// fakeRetriever records every Retrieve call + returns canned chunks.
// Implements rag.Retriever; Index + Forget are no-ops because the
// tools never call them.
type fakeRetriever struct {
	subjects    []string
	queries     []string
	sourceTypes [][]string
	ks          []int
	out         []rag.Chunk
	err         error
}

func (f *fakeRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
	f.subjects = append(f.subjects, subject)
	f.queries = append(f.queries, query)
	dup := make([]string, len(sourceTypes))
	copy(dup, sourceTypes)
	f.sourceTypes = append(f.sourceTypes, dup)
	f.ks = append(f.ks, k)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

func (f *fakeRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func (f *fakeRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

// fakeHydrator records every HydrateOne call + returns a canned
// HydratedResult or a sentinel.
type fakeHydrator struct {
	subjects    []string
	sourceTypes []string
	sourceIDs   []string
	out         *HydratedResult
	err         error
}

func (f *fakeHydrator) HydrateOne(_ context.Context, subject, sourceType, sourceID string) (*HydratedResult, error) {
	f.subjects = append(f.subjects, subject)
	f.sourceTypes = append(f.sourceTypes, sourceType)
	f.sourceIDs = append(f.sourceIDs, sourceID)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestRetrieveChunks_HappyPath_ScopesBySubjectAndDelegates proves a
// valid input round-trips through the retriever scoped to the subject
// from ctx, and the chunks come back in a deterministic envelope.
func TestRetrieveChunks_HappyPath_ScopesBySubjectAndDelegates(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{
		out: []rag.Chunk{
			{SourceType: rag.SourceDriveSummary, SourceID: "drive-101", ChunkIdx: 0, Text: "Drive A", Score: 0.9},
			{SourceType: rag.SourceDriveSummary, SourceID: "drive-102", ChunkIdx: 0, Text: "Drive B", Score: 0.7},
		},
	}
	tool := &retrieveChunks{r: ret}

	in, err := tool.Validate(json.RawMessage(`{"query":"drives last weekend","source_types":["drive_summary"],"k":4}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	ctx := provider.WithSubject(context.Background(), "alice@example.com")
	got, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}

	env, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", got)
	}
	if env["k"] != 4 {
		t.Errorf("envelope k = %v, want 4", env["k"])
	}
	chunks, ok := env["chunks"].([]retrievedChunk)
	if !ok {
		t.Fatalf("envelope chunks = %T, want []retrievedChunk", env["chunks"])
	}
	if len(chunks) != 2 || chunks[0].SourceID != "drive-101" {
		t.Errorf("chunks = %+v, want [drive-101, drive-102]", chunks)
	}

	if len(ret.subjects) != 1 || ret.subjects[0] != "alice@example.com" {
		t.Errorf("retriever subject = %v, want [alice@example.com]", ret.subjects)
	}
	if len(ret.queries) != 1 || ret.queries[0] != "drives last weekend" {
		t.Errorf("retriever query = %v, want [drives last weekend]", ret.queries)
	}
	if len(ret.sourceTypes) != 1 || ret.sourceTypes[0][0] != rag.SourceDriveSummary {
		t.Errorf("retriever sourceTypes = %v, want [[drive_summary]]", ret.sourceTypes)
	}
	if len(ret.ks) != 1 || ret.ks[0] != 4 {
		t.Errorf("retriever k = %v, want [4]", ret.ks)
	}
}

// TestRetrieveChunks_DefaultK_SubstitutesFiveWhenZero proves the
// per-tool default replaces a 0 / omitted k so the LLM doesn't have
// to know the magic number.
func TestRetrieveChunks_DefaultK_SubstitutesFiveWhenZero(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{out: nil}
	tool := &retrieveChunks{r: ret}
	in, err := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(ret.ks) != 1 || ret.ks[0] != nlSearchDefaultK {
		t.Errorf("retriever k = %v, want [%d]", ret.ks, nlSearchDefaultK)
	}
}

// TestRetrieveChunks_RejectsUnknownSourceType proves the per-feature
// allowlist refuses any rag.Source* outside {drive_summary,
// charge_session, alert_history}, even one that exists at the
// retriever boundary.
func TestRetrieveChunks_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"x","source_types":["something_else"]}`))
	if err == nil || !strings.Contains(err.Error(), "not in allowed set") {
		t.Errorf("Validate err = %v, want refusal mentioning allowed set", err)
	}
}

// TestRetrieveChunks_RejectsDuplicateSourceType proves the
// allowlist enforcer surfaces duplicate entries so the LLM gets a
// deterministic error instead of double-searching the same corpus.
func TestRetrieveChunks_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"x","source_types":["drive_summary","drive_summary"]}`))
	if err == nil || !strings.Contains(err.Error(), "more than once") {
		t.Errorf("Validate err = %v, want refusal mentioning duplicate", err)
	}
}

// TestRetrieveChunks_RejectsEmptyQuery proves the validator's
// `required` tag rejects an empty query before we hit the retriever.
func TestRetrieveChunks_RejectsEmptyQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"","source_types":["drive_summary"]}`))
	if err == nil {
		t.Errorf("Validate err = nil, want refusal for empty query")
	}
}

// TestRetrieveChunks_RejectsKAboveMax proves the upper bound clamps
// the LLM's request below the per-tool ceiling.
func TestRetrieveChunks_RejectsKAboveMax(t *testing.T) {
	t.Parallel()
	tool := &retrieveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"],"k":17}`))
	if err == nil {
		t.Errorf("Validate err = nil, want refusal for k=17 (max %d)", nlSearchMaxK)
	}
}

// TestRetrieveChunks_PropagatesRetrieverError proves a retriever
// failure returns a wrapped error rather than swallowing it.
func TestRetrieveChunks_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	boom := errors.New("rag-down")
	tool := &retrieveChunks{r: &fakeRetriever{err: boom}}
	in, err := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, boom) {
		t.Errorf("Execute err = %v, want wrapping rag-down", err)
	}
}

// TestRetrieveChunks_NilRetriever_ReturnsError proves the wiring
// guard surfaces a nil port as a defensive error rather than a
// panic.
func TestRetrieveChunks_NilRetriever_ReturnsError(t *testing.T) {
	t.Parallel()
	tool := &retrieveChunks{r: nil}
	in, _ := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"]}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Errorf("Execute err = nil, want error for nil retriever")
	}
}

// TestRetrieveChunks_Mutates_False proves the read-only contract.
func TestRetrieveChunks_Mutates_False(t *testing.T) {
	t.Parallel()
	if (&retrieveChunks{}).Mutates() {
		t.Errorf("retrieve_chunks.Mutates() = true, want false")
	}
}

// TestHydrateSearchResult_HappyPath_DelegatesAndScopes proves the
// hydrator is called with the subject from ctx + the validated
// inputs.
func TestHydrateSearchResult_HappyPath_DelegatesAndScopes(t *testing.T) {
	t.Parallel()
	want := &HydratedResult{
		SourceType: rag.SourceDriveSummary,
		SourceID:   "drive-101",
		Title:      "Drive #101",
		URL:        "/drives/101",
		When:       "2025-01-04T14:32:00Z",
	}
	hyd := &fakeHydrator{out: want}
	tool := &hydrateSearchResult{h: hyd}

	in, err := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-101"}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	ctx := provider.WithSubject(context.Background(), "alice@example.com")
	got, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env, ok := got.(*hydratedSearchResultOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *hydratedSearchResultOutput", got)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.Result == nil || env.Result.Title != "Drive #101" {
		t.Errorf("Result = %+v, want title=Drive #101", env.Result)
	}
	if len(hyd.subjects) != 1 || hyd.subjects[0] != "alice@example.com" {
		t.Errorf("hydrator subject = %v, want [alice@example.com]", hyd.subjects)
	}
	if len(hyd.sourceTypes) != 1 || hyd.sourceTypes[0] != rag.SourceDriveSummary {
		t.Errorf("hydrator sourceType = %v, want [drive_summary]", hyd.sourceTypes)
	}
	if len(hyd.sourceIDs) != 1 || hyd.sourceIDs[0] != "drive-101" {
		t.Errorf("hydrator sourceID = %v, want [drive-101]", hyd.sourceIDs)
	}
}

// TestHydrateSearchResult_NotFound_ReturnsStatusEnvelope proves the
// sentinel error is folded into a status="not_found" envelope so
// the LLM can adapt without a tool-error retry loop.
func TestHydrateSearchResult_NotFound_ReturnsStatusEnvelope(t *testing.T) {
	t.Parallel()
	tool := &hydrateSearchResult{h: &fakeHydrator{err: ErrHydratorNotFound}}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-999"}`))
	got, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil for not_found path", err)
	}
	env, ok := got.(*hydratedSearchResultOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *hydratedSearchResultOutput", got)
	}
	if env.Status != "not_found" {
		t.Errorf("Status = %q, want not_found", env.Status)
	}
	if env.Result != nil {
		t.Errorf("Result = %+v, want nil on not_found", env.Result)
	}
}

// TestHydrateSearchResult_NilResultIsNotFound proves a hydrator that
// returns (nil, nil) is treated as not_found rather than crashing.
func TestHydrateSearchResult_NilResultIsNotFound(t *testing.T) {
	t.Parallel()
	tool := &hydrateSearchResult{h: &fakeHydrator{out: nil, err: nil}}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-1"}`))
	got, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := got.(*hydratedSearchResultOutput)
	if env.Status != "not_found" {
		t.Errorf("Status = %q, want not_found", env.Status)
	}
}

// TestHydrateSearchResult_PropagatesGenericError proves a non-
// sentinel hydrator error is returned to the dispatcher (not folded
// into a status envelope).
func TestHydrateSearchResult_PropagatesGenericError(t *testing.T) {
	t.Parallel()
	boom := errors.New("db-down")
	tool := &hydrateSearchResult{h: &fakeHydrator{err: boom}}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-1"}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, boom) {
		t.Errorf("Execute err = %v, want wrapping db-down", err)
	}
}

// TestHydrateSearchResult_RejectsUnknownSourceType proves the
// allowlist enforcer fires on hydrate calls too (not just retrieve
// calls).
func TestHydrateSearchResult_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &hydrateSearchResult{h: &fakeHydrator{}}
	_, err := tool.Validate(json.RawMessage(`{"source_type":"something_else","source_id":"x"}`))
	if err == nil || !strings.Contains(err.Error(), "not in allowed set") {
		t.Errorf("Validate err = %v, want refusal mentioning allowed set", err)
	}
}

// TestHydrateSearchResult_RejectsBlankSourceID proves the trim guard
// rejects whitespace-only IDs.
func TestHydrateSearchResult_RejectsBlankSourceID(t *testing.T) {
	t.Parallel()
	tool := &hydrateSearchResult{h: &fakeHydrator{}}
	_, err := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"   "}`))
	if err == nil || !strings.Contains(err.Error(), "non-empty") {
		t.Errorf("Validate err = %v, want refusal for blank source_id", err)
	}
}

// TestHydrateSearchResult_NilHydrator_ReturnsError proves the
// wiring guard surfaces a nil port as a defensive error rather than
// a panic.
func TestHydrateSearchResult_NilHydrator_ReturnsError(t *testing.T) {
	t.Parallel()
	tool := &hydrateSearchResult{h: nil}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"x"}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Errorf("Execute err = nil, want error for nil hydrator")
	}
}

// TestHydrateSearchResult_Mutates_False proves the read-only contract.
func TestHydrateSearchResult_Mutates_False(t *testing.T) {
	t.Parallel()
	if (&hydrateSearchResult{}).Mutates() {
		t.Errorf("hydrate_search_result.Mutates() = true, want false")
	}
}

// TestRegisterSearchTools_WiresBoth proves the bundle installs both
// tools under their canonical names.
func TestRegisterSearchTools_WiresBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterSearchTools(r, SearchSources{
		Retriever: &fakeRetriever{},
		Hydrator:  &fakeHydrator{},
	})
	if _, ok := r.Get("retrieve_chunks"); !ok {
		t.Errorf("Registry missing retrieve_chunks after RegisterSearchTools")
	}
	if _, ok := r.Get("hydrate_search_result"); !ok {
		t.Errorf("Registry missing hydrate_search_result after RegisterSearchTools")
	}
}

// TestRegisterSearchTools_DuplicateRegistrationPanics proves a
// second call panics, matching the registry's wiring-bug-detected-
// at-boot contract.
func TestRegisterSearchTools_DuplicateRegistrationPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("second RegisterSearchTools did not panic")
		}
	}()
	r := NewRegistry()
	RegisterSearchTools(r, SearchSources{Retriever: &fakeRetriever{}, Hydrator: &fakeHydrator{}})
	RegisterSearchTools(r, SearchSources{Retriever: &fakeRetriever{}, Hydrator: &fakeHydrator{}})
}

// TestAllowedSearchSourceTypes_DefensiveCopy proves the exported
// allowlist getter returns a defensive copy so an outside caller
// can't mutate the package-private slice.
func TestAllowedSearchSourceTypes_DefensiveCopy(t *testing.T) {
	t.Parallel()
	a := AllowedSearchSourceTypes()
	b := AllowedSearchSourceTypes()
	if &a[0] == &b[0] {
		t.Errorf("AllowedSearchSourceTypes returns aliased slice; want defensive copy")
	}
	a[0] = "tampered"
	if AllowedSearchSourceTypes()[0] == "tampered" {
		t.Errorf("AllowedSearchSourceTypes leaked a writable view of the package allowlist")
	}
}
