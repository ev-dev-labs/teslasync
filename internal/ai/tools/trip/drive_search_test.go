// Tool tests for retrieve_drive_chunks + hydrate_drive_replay. Both
// tools are pure functions over their typed input + a narrow port
// (rag.Retriever or DriveReplayHydrator); the tests stub each port
// with a deterministic fake so the tests stay hermetic (no DB, no
// embedding API).

package trip

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// fakeDriveReplayHydrator records every HydrateOne call + returns a
// canned HydratedDriveReplay or a sentinel.
type fakeDriveReplayHydrator struct {
	subjects    []string
	sourceTypes []string
	sourceIDs   []string
	out         *HydratedDriveReplay
	err         error
}

func (f *fakeDriveReplayHydrator) HydrateOne(_ context.Context, subject, sourceType, sourceID string) (*HydratedDriveReplay, error) {
	f.subjects = append(f.subjects, subject)
	f.sourceTypes = append(f.sourceTypes, sourceType)
	f.sourceIDs = append(f.sourceIDs, sourceID)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestRetrieveDriveChunks_HappyPath_ScopesBySubjectAndDelegates
// proves a valid input round-trips through the RAG retriever scoped
// to the subject from ctx, and the chunks come back in a
// deterministic envelope.
func TestRetrieveDriveChunks_HappyPath_ScopesBySubjectAndDelegates(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{
		out: []rag.Chunk{
			{SourceType: rag.SourceDriveSummary, SourceID: "drive-101", ChunkIdx: 0, Text: "Drive A", Score: 0.9},
			{SourceType: rag.SourceDriveSummary, SourceID: "drive-102", ChunkIdx: 0, Text: "Drive B", Score: 0.7},
		},
	}
	tool := &retrieveDriveChunks{r: ret}

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
	chunks, ok := env["chunks"].([]retrievedDriveChunk)
	if !ok {
		t.Fatalf("envelope chunks = %T, want []retrievedDriveChunk", env["chunks"])
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

// TestRetrieveDriveChunks_DefaultK_SubstitutesFiveWhenZero proves
// the per-tool default replaces a 0 / omitted k.
func TestRetrieveDriveChunks_DefaultK_SubstitutesFiveWhenZero(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{out: nil}
	tool := &retrieveDriveChunks{r: ret}
	in, err := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(ret.ks) != 1 || ret.ks[0] != nlDriveSearchDefaultK {
		t.Errorf("retriever k = %v, want [%d]", ret.ks, nlDriveSearchDefaultK)
	}
}

// TestRetrieveDriveChunks_AcceptsForwardCompatSourceTypes proves
// route_segment and location_summary are accepted by the allowlist
// even though the indexer has not wired them yet; the allowlist
// reserves these strings for forward compatibility.
func TestRetrieveDriveChunks_AcceptsForwardCompatSourceTypes(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{out: nil}
	tool := &retrieveDriveChunks{r: ret}
	for _, st := range []string{"route_segment", "location_summary"} {
		body := `{"query":"q","source_types":["` + st + `"]}`
		if _, err := tool.Validate(json.RawMessage(body)); err != nil {
			t.Errorf("Validate(%s) err = %v, want nil (forward-compat allowlist)", st, err)
		}
	}
}

// TestRetrieveDriveChunks_RejectsUnknownSourceType proves the
// per-feature allowlist refuses any source-type outside
// {drive_summary, route_segment, location_summary}.
func TestRetrieveDriveChunks_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveDriveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"x","source_types":["charge_session"]}`))
	if err == nil || !strings.Contains(err.Error(), "not in allowed set") {
		t.Errorf("Validate err = %v, want refusal mentioning allowed set", err)
	}
}

// TestRetrieveDriveChunks_RejectsDuplicateSourceType proves the
// allowlist enforcer surfaces duplicate entries so the LLM gets a
// deterministic error instead of double-searching the same corpus.
func TestRetrieveDriveChunks_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveDriveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"x","source_types":["drive_summary","drive_summary"]}`))
	if err == nil || !strings.Contains(err.Error(), "more than once") {
		t.Errorf("Validate err = %v, want refusal mentioning duplicate", err)
	}
}

// TestRetrieveDriveChunks_RejectsEmptyQuery proves the validator's
// `required` tag rejects an empty query before we hit the
// retriever.
func TestRetrieveDriveChunks_RejectsEmptyQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveDriveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"","source_types":["drive_summary"]}`))
	if err == nil {
		t.Errorf("Validate err = nil, want refusal for empty query")
	}
}

// TestRetrieveDriveChunks_RejectsKAboveMax proves the upper bound
// clamps the LLM's request below the per-tool ceiling.
func TestRetrieveDriveChunks_RejectsKAboveMax(t *testing.T) {
	t.Parallel()
	tool := &retrieveDriveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"],"k":17}`))
	if err == nil {
		t.Errorf("Validate err = nil, want refusal for k=17 (max %d)", nlDriveSearchMaxK)
	}
}

// TestRetrieveDriveChunks_PropagatesRetrieverError proves a
// retriever failure returns a wrapped error rather than swallowing
// it.
func TestRetrieveDriveChunks_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	boom := errors.New("rag-down")
	tool := &retrieveDriveChunks{r: &fakeRetriever{err: boom}}
	in, err := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, boom) {
		t.Errorf("Execute err = %v, want wrapping rag-down", err)
	}
}

// TestRetrieveDriveChunks_NilRetriever_ReturnsError proves the
// wiring guard surfaces a nil port as a defensive error rather
// than a panic.
func TestRetrieveDriveChunks_NilRetriever_ReturnsError(t *testing.T) {
	t.Parallel()
	tool := &retrieveDriveChunks{r: nil}
	in, _ := tool.Validate(json.RawMessage(`{"query":"q","source_types":["drive_summary"]}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Errorf("Execute err = nil, want error for nil retriever")
	}
}

// TestRetrieveDriveChunks_Mutates_False proves the read-only
// contract.
func TestRetrieveDriveChunks_Mutates_False(t *testing.T) {
	t.Parallel()
	if (&retrieveDriveChunks{}).Mutates() {
		t.Errorf("retrieve_drive_chunks.Mutates() = true, want false")
	}
}

// TestHydrateDriveReplay_HappyPath_DelegatesAndScopes proves the
// hydrator is called with the subject from ctx + the validated
// inputs and the {url, replay_url} pair is round-tripped.
func TestHydrateDriveReplay_HappyPath_DelegatesAndScopes(t *testing.T) {
	t.Parallel()
	want := &HydratedDriveReplay{
		SourceType: rag.SourceDriveSummary,
		SourceID:   "drive-101",
		Title:      "Drive #101",
		URL:        "/drives/101",
		ReplayURL:  "/drives/101/replay",
		When:       "2025-01-04T14:32:00Z",
	}
	hyd := &fakeDriveReplayHydrator{out: want}
	tool := &hydrateDriveReplay{h: hyd}

	in, err := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-101"}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	ctx := provider.WithSubject(context.Background(), "alice@example.com")
	got, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env, ok := got.(*hydratedDriveReplayOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *hydratedDriveReplayOutput", got)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.Result == nil || env.Result.Title != "Drive #101" {
		t.Errorf("Result = %+v, want title=Drive #101", env.Result)
	}
	if env.Result.ReplayURL != "/drives/101/replay" {
		t.Errorf("ReplayURL = %q, want /drives/101/replay", env.Result.ReplayURL)
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

// TestHydrateDriveReplay_NotFound_ReturnsStatusEnvelope proves the
// sentinel error is folded into a status="not_found" envelope.
func TestHydrateDriveReplay_NotFound_ReturnsStatusEnvelope(t *testing.T) {
	t.Parallel()
	tool := &hydrateDriveReplay{h: &fakeDriveReplayHydrator{err: ErrDriveReplayHydratorNotFound}}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-999"}`))
	got, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil for not_found path", err)
	}
	env, ok := got.(*hydratedDriveReplayOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *hydratedDriveReplayOutput", got)
	}
	if env.Status != "not_found" {
		t.Errorf("Status = %q, want not_found", env.Status)
	}
	if env.Result != nil {
		t.Errorf("Result = %+v, want nil on not_found", env.Result)
	}
}

// TestHydrateDriveReplay_NilResultIsNotFound proves a hydrator that
// returns (nil, nil) is treated as not_found rather than crashing.
func TestHydrateDriveReplay_NilResultIsNotFound(t *testing.T) {
	t.Parallel()
	tool := &hydrateDriveReplay{h: &fakeDriveReplayHydrator{out: nil, err: nil}}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-1"}`))
	got, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := got.(*hydratedDriveReplayOutput)
	if env.Status != "not_found" {
		t.Errorf("Status = %q, want not_found", env.Status)
	}
}

// TestHydrateDriveReplay_PropagatesGenericError proves a non-
// sentinel hydrator error is returned to the dispatcher (not folded
// into a status envelope).
func TestHydrateDriveReplay_PropagatesGenericError(t *testing.T) {
	t.Parallel()
	boom := errors.New("db-down")
	tool := &hydrateDriveReplay{h: &fakeDriveReplayHydrator{err: boom}}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"drive-1"}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, boom) {
		t.Errorf("Execute err = %v, want wrapping db-down", err)
	}
}

// TestHydrateDriveReplay_RejectsUnknownSourceType proves the
// allowlist enforcer fires on hydrate calls too (not just retrieve
// calls).
func TestHydrateDriveReplay_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &hydrateDriveReplay{h: &fakeDriveReplayHydrator{}}
	_, err := tool.Validate(json.RawMessage(`{"source_type":"alert_history","source_id":"x"}`))
	if err == nil || !strings.Contains(err.Error(), "not in allowed set") {
		t.Errorf("Validate err = %v, want refusal mentioning allowed set", err)
	}
}

// TestHydrateDriveReplay_RejectsBlankSourceID proves the trim guard
// rejects whitespace-only IDs.
func TestHydrateDriveReplay_RejectsBlankSourceID(t *testing.T) {
	t.Parallel()
	tool := &hydrateDriveReplay{h: &fakeDriveReplayHydrator{}}
	_, err := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"   "}`))
	if err == nil || !strings.Contains(err.Error(), "non-empty") {
		t.Errorf("Validate err = %v, want refusal for blank source_id", err)
	}
}

// TestHydrateDriveReplay_NilHydrator_ReturnsError proves the wiring
// guard surfaces a nil port as a defensive error rather than a
// panic.
func TestHydrateDriveReplay_NilHydrator_ReturnsError(t *testing.T) {
	t.Parallel()
	tool := &hydrateDriveReplay{h: nil}
	in, _ := tool.Validate(json.RawMessage(`{"source_type":"drive_summary","source_id":"x"}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Errorf("Execute err = nil, want error for nil hydrator")
	}
}

// TestHydrateDriveReplay_Mutates_False proves the read-only contract.
func TestHydrateDriveReplay_Mutates_False(t *testing.T) {
	t.Parallel()
	if (&hydrateDriveReplay{}).Mutates() {
		t.Errorf("hydrate_drive_replay.Mutates() = true, want false")
	}
}

// TestRegisterDriveSearchTools_WiresBoth proves the bundle installs
// both tools under their canonical names.
func TestRegisterDriveSearchTools_WiresBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterDriveSearchTools(r, DriveSearchSources{
		Retriever: &fakeRetriever{},
		Hydrator:  &fakeDriveReplayHydrator{},
	})
	if _, ok := r.Get("retrieve_drive_chunks"); !ok {
		t.Errorf("Registry missing retrieve_drive_chunks after RegisterDriveSearchTools")
	}
	if _, ok := r.Get("hydrate_drive_replay"); !ok {
		t.Errorf("Registry missing hydrate_drive_replay after RegisterDriveSearchTools")
	}
}

// TestRegisterDriveSearchTools_DuplicateRegistrationPanics proves a
// second call panics, matching the registry's
// wiring-bug-detected-at-boot contract.
func TestRegisterDriveSearchTools_DuplicateRegistrationPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("second RegisterDriveSearchTools did not panic")
		}
	}()
	r := tools.NewRegistry()
	RegisterDriveSearchTools(r, DriveSearchSources{Retriever: &fakeRetriever{}, Hydrator: &fakeDriveReplayHydrator{}})
	RegisterDriveSearchTools(r, DriveSearchSources{Retriever: &fakeRetriever{}, Hydrator: &fakeDriveReplayHydrator{}})
}

// TestAllowedDriveSearchSourceTypes_DefensiveCopy proves the
// exported allowlist getter returns a defensive copy so an outside
// caller can't mutate the package-private slice.
func TestAllowedDriveSearchSourceTypes_DefensiveCopy(t *testing.T) {
	t.Parallel()
	a := AllowedDriveSearchSourceTypes()
	b := AllowedDriveSearchSourceTypes()
	if &a[0] == &b[0] {
		t.Errorf("AllowedDriveSearchSourceTypes returns aliased slice; want defensive copy")
	}
	a[0] = "tampered"
	if AllowedDriveSearchSourceTypes()[0] == "tampered" {
		t.Errorf("AllowedDriveSearchSourceTypes leaked a writable view of the package allowlist")
	}
}
