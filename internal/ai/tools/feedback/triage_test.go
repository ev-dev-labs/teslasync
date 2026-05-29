// Tool tests for draft_feedback_triage, validate_feedback_triage,
// and retrieve_feedback_chunks. The tests use deterministic fakes
// for the read-only ports so they stay hermetic.

package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// stubFeedbackTriageSource records every LoadFeedback call + can
// be wired to return a canned envelope or a fail.
type stubFeedbackTriageSource struct {
	loaded   []int64
	envelope *FeedbackTriageEntry
	failWith error
}

func (s *stubFeedbackTriageSource) LoadFeedback(ctx context.Context, id int64) (*FeedbackTriageEntry, error) {
	s.loaded = append(s.loaded, id)
	if s.failWith != nil {
		return nil, s.failWith
	}
	return s.envelope, nil
}

// scopedFeedbackCtx is a one-line builder so tests don't repeat the
// context install boilerplate.
func scopedFeedbackCtx(feedbackID int64) context.Context {
	return WithScopedFeedback(context.Background(), ScopedFeedback{FeedbackID: feedbackID})
}

// canonicalEntry is the fixture envelope draft tests load — mirrors
// the shape the production source adapter forwards.
func canonicalEntry(id int64) *FeedbackTriageEntry {
	return &FeedbackTriageEntry{
		ID:         id,
		CreatedAt:  "2025-01-15T03:14:15Z",
		Category:   "bug",
		Title:      "Charging session never closes",
		Body:       "Plugged in at home overnight; the session shows In Progress for 14h after the car finished charging.",
		PageRoute:  "/charging/sessions/123",
		AppVersion: "v1.42.0-abcdef",
		Status:     "new",
	}
}

// --- WithScopedFeedback / ScopedFeedbackFromContext ----------------

// TestWithScopedFeedback_RoundTrip proves the helper installs the
// scope and the symmetric reader returns it intact.
func TestWithScopedFeedback_RoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithScopedFeedback(context.Background(), ScopedFeedback{FeedbackID: 42})
	got, ok := ScopedFeedbackFromContext(ctx)
	if !ok {
		t.Fatal("ScopedFeedbackFromContext ok=false, want true")
	}
	if got.FeedbackID != 42 {
		t.Errorf("FeedbackID = %d, want 42", got.FeedbackID)
	}
}

// TestScopedFeedbackFromContext_Missing proves the no-scope case
// returns ok=false.
func TestScopedFeedbackFromContext_Missing(t *testing.T) {
	t.Parallel()
	if _, ok := ScopedFeedbackFromContext(context.Background()); ok {
		t.Fatal("ScopedFeedbackFromContext ok=true on bare ctx; want false")
	}
}

// --- closed enum exports ------------------------------------------

// TestAllowedFeedbackTriageStatuses pins the enum order + content.
func TestAllowedFeedbackTriageStatuses(t *testing.T) {
	t.Parallel()
	got := AllowedFeedbackTriageStatuses()
	want := []string{"new", "triaged", "closed"}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	// Defensive copy proof.
	got[0] = "MUTATED"
	if AllowedFeedbackTriageStatuses()[0] != "new" {
		t.Error("mutating returned slice corrupted the canonical list")
	}
}

// TestAllowedFeedbackTriageCategories pins the enum order + content.
func TestAllowedFeedbackTriageCategories(t *testing.T) {
	t.Parallel()
	got := AllowedFeedbackTriageCategories()
	want := []string{"bug", "feature", "other"}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestAllowedFeedbackTriagePriorities pins the enum order + content.
func TestAllowedFeedbackTriagePriorities(t *testing.T) {
	t.Parallel()
	got := AllowedFeedbackTriagePriorities()
	want := []string{"low", "normal", "high", "critical"}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// --- draft_feedback_triage happy paths ----------------------------

// TestDraftFeedbackTriage_HappyPath_OK proves a valid LLM payload
// loads the row and returns status="ok" with the proposal mirrored
// back AND the current_status / current_category seeded from the
// loaded envelope.
func TestDraftFeedbackTriage_HappyPath_OK(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{envelope: canonicalEntry(42)}
	tool := &draftFeedbackTriage{source: src}

	in, err := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "triaged",
		"proposed_category": "bug",
		"proposed_priority": "high",
		"rationale": "Charging-session lifecycle bug; reproducer in body. Investigation must check session-closer reaper schedule."
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(scopedFeedbackCtx(42), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*feedbackTriageOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *feedbackTriageOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (validation_error=%q)", env.Status, env.ValidationError)
	}
	if env.Draft == nil {
		t.Fatal("Draft is nil")
	}
	if env.Draft.FeedbackID != 42 {
		t.Errorf("Draft.FeedbackID = %d, want 42", env.Draft.FeedbackID)
	}
	if env.Draft.CurrentStatus != "new" {
		t.Errorf("Draft.CurrentStatus = %q, want new", env.Draft.CurrentStatus)
	}
	if env.Draft.CurrentCategory != "bug" {
		t.Errorf("Draft.CurrentCategory = %q, want bug", env.Draft.CurrentCategory)
	}
	if env.Draft.ProposedStatus != "triaged" {
		t.Errorf("Draft.ProposedStatus = %q, want triaged", env.Draft.ProposedStatus)
	}
	if env.Draft.ProposedCategory != "bug" {
		t.Errorf("Draft.ProposedCategory = %q, want bug", env.Draft.ProposedCategory)
	}
	if env.Draft.ProposedPriority != "high" {
		t.Errorf("Draft.ProposedPriority = %q, want high", env.Draft.ProposedPriority)
	}
	if env.Draft.Rationale == "" {
		t.Error("Draft.Rationale is empty")
	}
	if env.Source == "" {
		t.Error("Source must be non-empty")
	}
	if len(src.loaded) != 1 || src.loaded[0] != 42 {
		t.Errorf("LoadFeedback calls = %v, want [42]", src.loaded)
	}
}

// TestDraftFeedbackTriage_NotFound proves a nil envelope from the
// source surfaces as status="feedback_not_found" — never panic.
func TestDraftFeedbackTriage_NotFound(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{envelope: nil}
	tool := &draftFeedbackTriage{source: src}

	in, err := tool.Validate(json.RawMessage(`{
		"feedback_id": 99,
		"proposed_status": "closed",
		"proposed_category": "other",
		"proposed_priority": "low",
		"rationale": "Row presumed missing."
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}

	out, err := tool.Execute(scopedFeedbackCtx(99), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*feedbackTriageOutput)
	if env.Status != "feedback_not_found" {
		t.Errorf("Status = %q, want feedback_not_found", env.Status)
	}
	if env.ValidationError == "" {
		t.Error("ValidationError must explain the missing row")
	}
}

// TestDraftFeedbackTriage_ScopeMismatch proves a mismatched
// feedback_id is refused as a returned error (NOT envelope status)
// so the dispatcher can relay the refusal back to the LLM.
func TestDraftFeedbackTriage_ScopeMismatch(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{envelope: canonicalEntry(42)}
	tool := &draftFeedbackTriage{source: src}

	in, _ := tool.Validate(json.RawMessage(`{
		"feedback_id": 99,
		"proposed_status": "triaged",
		"proposed_category": "bug",
		"proposed_priority": "high",
		"rationale": "Cross-row injection attempt."
	}`))

	_, err := tool.Execute(scopedFeedbackCtx(42), in)
	if err == nil {
		t.Fatal("Execute err = nil, want scope-mismatch refusal")
	}
	if !strings.Contains(err.Error(), "in-scope") {
		t.Errorf("err = %v, want substring 'in-scope'", err)
	}
	if len(src.loaded) != 0 {
		t.Errorf("LoadFeedback called %d times after scope refusal; want 0 (scope check must precede load)", len(src.loaded))
	}
}

// TestDraftFeedbackTriage_NoScope proves a missing scope is a hard
// refusal — bare context.Background() is never acceptable.
func TestDraftFeedbackTriage_NoScope(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{envelope: canonicalEntry(42)}
	tool := &draftFeedbackTriage{source: src}

	in, _ := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "triaged",
		"proposed_category": "bug",
		"proposed_priority": "high",
		"rationale": "ok."
	}`))

	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want missing-scope refusal")
	}
	if !strings.Contains(err.Error(), "no in-scope") {
		t.Errorf("err = %v, want substring 'no in-scope'", err)
	}
}

// TestDraftFeedbackTriage_NilSource proves a wiring bug surfaces
// as a clear error (NOT a panic).
func TestDraftFeedbackTriage_NilSource(t *testing.T) {
	t.Parallel()
	tool := &draftFeedbackTriage{source: nil}
	in, _ := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "triaged",
		"proposed_category": "bug",
		"proposed_priority": "high",
		"rationale": "ok."
	}`))
	_, err := tool.Execute(scopedFeedbackCtx(42), in)
	if err == nil {
		t.Fatal("Execute err = nil, want nil-source refusal")
	}
}

// TestDraftFeedbackTriage_LoadFails proves a load-error from the
// source propagates back to the dispatcher.
func TestDraftFeedbackTriage_LoadFails(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{failWith: errors.New("db gone")}
	tool := &draftFeedbackTriage{source: src}
	in, _ := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "triaged",
		"proposed_category": "bug",
		"proposed_priority": "high",
		"rationale": "ok."
	}`))
	_, err := tool.Execute(scopedFeedbackCtx(42), in)
	if err == nil {
		t.Fatal("Execute err = nil, want load-error propagation")
	}
}

// --- draft_feedback_triage rejection paths ------------------------

// TestDraftFeedbackTriage_BadStatus_Rejected proves an off-enum
// proposed_status is rejected at the validator-tag layer.
func TestDraftFeedbackTriage_BadStatus_Rejected(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{envelope: canonicalEntry(42)}
	tool := &draftFeedbackTriage{source: src}
	_, err := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "deferred",
		"proposed_category": "bug",
		"proposed_priority": "high",
		"rationale": "off-enum status."
	}`))
	if err == nil {
		t.Fatal("Validate err = nil, want oneof rejection for proposed_status=deferred")
	}
}

// TestDraftFeedbackTriage_BadCategory_Rejected proves an off-enum
// proposed_category is rejected at the validator-tag layer.
func TestDraftFeedbackTriage_BadCategory_Rejected(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{envelope: canonicalEntry(42)}
	tool := &draftFeedbackTriage{source: src}
	_, err := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "triaged",
		"proposed_category": "regression",
		"proposed_priority": "high",
		"rationale": "off-enum category."
	}`))
	if err == nil {
		t.Fatal("Validate err = nil, want oneof rejection for proposed_category=regression")
	}
}

// TestDraftFeedbackTriage_BadPriority_Rejected proves an off-enum
// proposed_priority is rejected at the validator-tag layer.
func TestDraftFeedbackTriage_BadPriority_Rejected(t *testing.T) {
	t.Parallel()
	src := &stubFeedbackTriageSource{envelope: canonicalEntry(42)}
	tool := &draftFeedbackTriage{source: src}
	_, err := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "triaged",
		"proposed_category": "bug",
		"proposed_priority": "p1",
		"rationale": "off-enum priority."
	}`))
	if err == nil {
		t.Fatal("Validate err = nil, want oneof rejection for proposed_priority=p1")
	}
}

// TestDraftFeedbackTriage_MissingFields_Rejected proves required
// fields are enforced.
func TestDraftFeedbackTriage_MissingFields_Rejected(t *testing.T) {
	t.Parallel()
	tool := &draftFeedbackTriage{source: &stubFeedbackTriageSource{envelope: canonicalEntry(42)}}
	cases := []string{
		`{"proposed_status":"triaged","proposed_category":"bug","proposed_priority":"high","rationale":"r"}`,
		`{"feedback_id":42,"proposed_category":"bug","proposed_priority":"high","rationale":"r"}`,
		`{"feedback_id":42,"proposed_status":"triaged","proposed_priority":"high","rationale":"r"}`,
		`{"feedback_id":42,"proposed_status":"triaged","proposed_category":"bug","rationale":"r"}`,
		`{"feedback_id":42,"proposed_status":"triaged","proposed_category":"bug","proposed_priority":"high"}`,
	}
	for i, raw := range cases {
		if _, err := tool.Validate(json.RawMessage(raw)); err == nil {
			t.Errorf("[%d] Validate err = nil, want required-field rejection (input: %s)", i, raw)
		}
	}
}

// --- draft_feedback_triage Tool interface pins --------------------

// TestDraftFeedbackTriage_ToolInterface_Pins pins the Tool
// interface methods so a future regression that, e.g., flips
// Mutates() to true is caught immediately.
func TestDraftFeedbackTriage_ToolInterface_Pins(t *testing.T) {
	t.Parallel()
	tool := &draftFeedbackTriage{source: &stubFeedbackTriageSource{}}
	if tool.Name() != "draft_feedback_triage" {
		t.Errorf("Name() = %q, want draft_feedback_triage", tool.Name())
	}
	if tool.Mutates() {
		t.Error("Mutates() = true, want false (PROPOSE-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.OutputSchema() != nil {
		t.Error("OutputSchema() != nil, want nil (free-form output)")
	}
	if len(tool.InputSchema()) == 0 {
		t.Error("InputSchema() is empty")
	}
	desc := tool.Description()
	for _, must := range []string{"PROPOSE-ONLY", "feedback_id", "proposed_status", "proposed_category", "proposed_priority", "rationale"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q", must)
		}
	}
}

// --- validate_feedback_triage --------------------------------------

// TestValidateFeedbackTriage_OK proves a valid input yields
// status="ok" without touching any source — pure DTO transform.
func TestValidateFeedbackTriage_OK(t *testing.T) {
	t.Parallel()
	tool := &validateFeedbackTriageTool{}
	in, err := tool.Validate(json.RawMessage(`{
		"feedback_id": 42,
		"proposed_status": "closed",
		"proposed_category": "feature",
		"proposed_priority": "normal",
		"rationale": "Already shipped in v1.43; close as duplicate of #1023."
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(scopedFeedbackCtx(42), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*feedbackTriageOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.Draft == nil || env.Draft.FeedbackID != 42 {
		t.Errorf("Draft = %+v, want id=42", env.Draft)
	}
	// validate_feedback_triage does NOT load — current_* must be empty.
	if env.Draft.CurrentStatus != "" {
		t.Errorf("Draft.CurrentStatus = %q, want empty (validate does not load)", env.Draft.CurrentStatus)
	}
	if env.Draft.CurrentCategory != "" {
		t.Errorf("Draft.CurrentCategory = %q, want empty (validate does not load)", env.Draft.CurrentCategory)
	}
}

// TestValidateFeedbackTriage_ScopeMismatch proves the scope check
// runs identically to draft_feedback_triage.
func TestValidateFeedbackTriage_ScopeMismatch(t *testing.T) {
	t.Parallel()
	tool := &validateFeedbackTriageTool{}
	in, _ := tool.Validate(json.RawMessage(`{
		"feedback_id": 99,
		"proposed_status": "triaged",
		"proposed_category": "bug",
		"proposed_priority": "high",
		"rationale": "ok."
	}`))
	_, err := tool.Execute(scopedFeedbackCtx(42), in)
	if err == nil {
		t.Fatal("Execute err = nil, want scope-mismatch refusal")
	}
}

// TestValidateFeedbackTriage_ToolInterface_Pins pins the Tool
// interface methods.
func TestValidateFeedbackTriage_ToolInterface_Pins(t *testing.T) {
	t.Parallel()
	tool := &validateFeedbackTriageTool{}
	if tool.Name() != "validate_feedback_triage" {
		t.Errorf("Name() = %q, want validate_feedback_triage", tool.Name())
	}
	if tool.Mutates() {
		t.Error("Mutates() = true, want false")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	desc := tool.Description()
	for _, must := range []string{"PROPOSE-ONLY", "validator", "draft_feedback_triage"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q", must)
		}
	}
}

// --- retrieve_feedback_chunks --------------------------------------

// stubFeedbackRetriever records every Retrieve call; Index/Forget
// panic so a misuse is caught immediately.
type stubFeedbackRetriever struct {
	calls   []stubFeedbackRetrieveCall
	chunks  []rag.Chunk
	failErr error
}

type stubFeedbackRetrieveCall struct {
	subject     string
	query       string
	sourceTypes []string
	k           int
}

func (s *stubFeedbackRetriever) Retrieve(ctx context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
	s.calls = append(s.calls, stubFeedbackRetrieveCall{subject: subject, query: query, sourceTypes: append([]string(nil), sourceTypes...), k: k})
	if s.failErr != nil {
		return nil, s.failErr
	}
	return s.chunks, nil
}

func (s *stubFeedbackRetriever) Index(ctx context.Context, subject, sourceType, sourceID string, chunks []string) error {
	panic("retrieve_feedback_chunks must not call Index")
}

func (s *stubFeedbackRetriever) Forget(ctx context.Context, subject, sourceType, sourceID string) error {
	panic("retrieve_feedback_chunks must not call Forget")
}

// TestRetrieveFeedbackChunks_HappyPath proves a valid call routes
// through the retriever with the requested source types + k.
func TestRetrieveFeedbackChunks_HappyPath(t *testing.T) {
	t.Parallel()
	r := &stubFeedbackRetriever{
		chunks: []rag.Chunk{
			{SourceType: "feedback_item", SourceID: "12", ChunkIdx: 0, Text: "earlier feedback", Score: 0.91},
		},
	}
	tool := &retrieveFeedbackChunks{r: r}
	in, err := tool.Validate(json.RawMessage(`{
		"query": "session never closes",
		"source_types": ["feedback_item", "audit_log"],
		"k": 4
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", out)
	}
	chunks, ok := env["chunks"].([]retrievedFeedbackChunk)
	if !ok {
		t.Fatalf("chunks = %T, want []retrievedFeedbackChunk", env["chunks"])
	}
	if len(chunks) != 1 || chunks[0].SourceID != "12" {
		t.Errorf("chunks = %+v, want one with SourceID=12", chunks)
	}
	if len(r.calls) != 1 {
		t.Fatalf("Retrieve calls = %d, want 1", len(r.calls))
	}
	if r.calls[0].k != 4 {
		t.Errorf("Retrieve k = %d, want 4", r.calls[0].k)
	}
	if r.calls[0].query != "session never closes" {
		t.Errorf("Retrieve query = %q", r.calls[0].query)
	}
}

// TestRetrieveFeedbackChunks_DefaultK proves an omitted k defaults
// to feedbackRetrievalDefaultK (5).
func TestRetrieveFeedbackChunks_DefaultK(t *testing.T) {
	t.Parallel()
	r := &stubFeedbackRetriever{}
	tool := &retrieveFeedbackChunks{r: r}
	in, err := tool.Validate(json.RawMessage(`{
		"query": "x",
		"source_types": ["feedback_item"]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(r.calls) != 1 || r.calls[0].k != feedbackRetrievalDefaultK {
		t.Errorf("Retrieve k = %d, want %d (default)", r.calls[0].k, feedbackRetrievalDefaultK)
	}
}

// TestRetrieveFeedbackChunks_DisallowedSourceType_Refused proves
// a source type outside the per-feature allowlist is refused at
// Validate time — never reaches the retriever.
func TestRetrieveFeedbackChunks_DisallowedSourceType_Refused(t *testing.T) {
	t.Parallel()
	r := &stubFeedbackRetriever{}
	tool := &retrieveFeedbackChunks{r: r}
	_, err := tool.Validate(json.RawMessage(`{
		"query": "x",
		"source_types": ["docs"]
	}`))
	if err == nil {
		t.Fatal("Validate err = nil, want allowlist refusal for docs")
	}
	if !strings.Contains(err.Error(), "allowed set") {
		t.Errorf("err = %v, want substring 'allowed set'", err)
	}
	if len(r.calls) != 0 {
		t.Errorf("Retrieve called %d times after Validate refusal", len(r.calls))
	}
}

// TestRetrieveFeedbackChunks_DuplicateSourceType_Refused proves a
// duplicated source-type entry is refused.
func TestRetrieveFeedbackChunks_DuplicateSourceType_Refused(t *testing.T) {
	t.Parallel()
	tool := &retrieveFeedbackChunks{r: &stubFeedbackRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{
		"query": "x",
		"source_types": ["feedback_item", "feedback_item"]
	}`))
	if err == nil {
		t.Fatal("Validate err = nil, want duplicate refusal")
	}
}

// TestRetrieveFeedbackChunks_EmptyQuery_Refused proves an empty
// query is refused at the validator-tag layer.
func TestRetrieveFeedbackChunks_EmptyQuery_Refused(t *testing.T) {
	t.Parallel()
	tool := &retrieveFeedbackChunks{r: &stubFeedbackRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{
		"query": "",
		"source_types": ["feedback_item"]
	}`))
	if err == nil {
		t.Fatal("Validate err = nil, want required-field rejection for empty query")
	}
}

// TestRetrieveFeedbackChunks_KOverCap_Refused proves k>cap is
// refused at the validator-tag layer.
func TestRetrieveFeedbackChunks_KOverCap_Refused(t *testing.T) {
	t.Parallel()
	tool := &retrieveFeedbackChunks{r: &stubFeedbackRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{
		"query": "x",
		"source_types": ["feedback_item"],
		"k": 99
	}`))
	if err == nil {
		t.Fatal("Validate err = nil, want lte=12 rejection")
	}
}

// TestRetrieveFeedbackChunks_NilRetriever proves the wiring bug
// surfaces as an error (NOT a panic).
func TestRetrieveFeedbackChunks_NilRetriever(t *testing.T) {
	t.Parallel()
	tool := &retrieveFeedbackChunks{r: nil}
	in, _ := tool.Validate(json.RawMessage(`{"query":"x","source_types":["feedback_item"]}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want nil-retriever refusal")
	}
}

// TestAllowedFeedbackChunkSourceTypes pins the allowlist content +
// proves the export is a defensive copy.
func TestAllowedFeedbackChunkSourceTypes(t *testing.T) {
	t.Parallel()
	got := AllowedFeedbackChunkSourceTypes()
	want := map[string]bool{"audit_log": true, "feedback_item": true}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (%v)", len(got), len(want), got)
	}
	for _, st := range got {
		if !want[st] {
			t.Errorf("unexpected source_type %q in allowlist", st)
		}
	}
	got[0] = "MUTATED"
	if AllowedFeedbackChunkSourceTypes()[0] == "MUTATED" {
		t.Error("mutating returned slice corrupted the canonical allowlist")
	}
}

// --- Registration --------------------------------------------------

// TestRegisterFeedbackQueueTriageTools_RegistersAllThree proves
// all three tools land on the registry under their canonical names.
func TestRegisterFeedbackQueueTriageTools_RegistersAllThree(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterFeedbackQueueTriageTools(r, FeedbackQueueTriageSources{
		Source:    &stubFeedbackTriageSource{},
		Retriever: &stubFeedbackRetriever{},
	})
	for _, name := range []string{"draft_feedback_triage", "validate_feedback_triage", "retrieve_feedback_chunks"} {
		tool, ok := r.Get(name)
		if !ok {
			t.Errorf("registry missing %q", name)
			continue
		}
		if tool.Name() != name {
			t.Errorf("registry[%q].Name() = %q", name, tool.Name())
		}
	}
}

// TestRegisterFeedbackQueueTriageTools_DuplicateRegistration proves
// a second call panics — wiring bugs detected at boot, not at
// first request.
func TestRegisterFeedbackQueueTriageTools_DuplicateRegistration(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	srcs := FeedbackQueueTriageSources{
		Source:    &stubFeedbackTriageSource{},
		Retriever: &stubFeedbackRetriever{},
	}
	RegisterFeedbackQueueTriageTools(r, srcs)
	defer func() {
		if recover() == nil {
			t.Fatal("second RegisterFeedbackQueueTriageTools did not panic")
		}
	}()
	RegisterFeedbackQueueTriageTools(r, srcs)
}

// --- nowRFC3339 ----------------------------------------------------

// TestNowRFC3339 proves the helper formats UTC with no error path.
func TestNowRFC3339(t *testing.T) {
	t.Parallel()
	got := nowRFC3339()
	if !strings.HasSuffix(got, "Z") {
		t.Errorf("nowRFC3339 = %q, want UTC suffix Z", got)
	}
}
