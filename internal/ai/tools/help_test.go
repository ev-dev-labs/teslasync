// Tool tests for retrieve_docs + cite_help_chunk. Both tools are
// pure functions over their typed input; retrieve_docs uses the
// shared fakeRetriever defined in search_test.go (same package),
// cite_help_chunk has no port at all.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
)

// --- retrieve_docs --------------------------------------------------

func TestRetrieveDocs_Metadata(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	if got := tool.Name(); got != "retrieve_docs" {
		t.Fatalf("Name() = %q, want retrieve_docs", got)
	}
	if tool.Mutates() {
		t.Fatal("Mutates() = true; retrieve_docs must be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Fatalf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	desc := tool.Description()
	for _, must := range []string{"docs", "i18n", "runbooks", "READ-only", "DO NOT fabricate"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q; got=%q", must, desc)
		}
	}
	if len(tool.InputSchema()) == 0 {
		t.Fatal("InputSchema() returned empty; expected JSON-Schema document")
	}
	if tool.OutputSchema() != nil {
		t.Fatalf("OutputSchema() = %s, want nil (free-form output)", tool.OutputSchema())
	}
}

func TestRetrieveDocs_ValidateAcceptsAllowedTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	raw := json.RawMessage(`{"query":"how to enable push","source_types":["docs","i18n"],"k":3}`)
	got, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate(allowed types) err = %v", err)
	}
	in := got.(retrieveDocsInput)
	if in.Query != "how to enable push" || in.K != 3 {
		t.Fatalf("Validate decoded wrong fields: %+v", in)
	}
	if len(in.SourceTypes) != 2 {
		t.Fatalf("Validate source_types len = %d, want 2", len(in.SourceTypes))
	}
}

func TestRetrieveDocs_ValidateRejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	raw := json.RawMessage(`{"query":"hello","source_types":["drive_summary"]}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(drive_summary) err = nil; want rejection")
	}
	if !strings.Contains(err.Error(), "drive_summary") {
		t.Errorf("Validate error %q must name offending type", err.Error())
	}
}

func TestRetrieveDocs_ValidateRejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	raw := json.RawMessage(`{"query":"hello","source_types":[]}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(empty source_types) err = nil; want rejection")
	}
}

func TestRetrieveDocs_ValidateRejectsDuplicateSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	raw := json.RawMessage(`{"query":"hello","source_types":["docs","docs"]}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(duplicate source_types) err = nil; want rejection")
	}
	if !strings.Contains(err.Error(), "more than once") {
		t.Errorf("Validate dup error %q must say 'more than once'", err.Error())
	}
}

func TestRetrieveDocs_ValidateRejectsMissingQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	raw := json.RawMessage(`{"source_types":["docs"]}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(missing query) err = nil; want rejection")
	}
}

func TestRetrieveDocs_ValidateRejectsOversizedQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	huge := strings.Repeat("a", ragHelpMaxQueryChars+1)
	raw := json.RawMessage(`{"query":"` + huge + `","source_types":["docs"]}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(huge query) err = nil; want rejection")
	}
}

func TestRetrieveDocs_ValidateRejectsKAboveMax(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: &fakeRetriever{}}
	raw := json.RawMessage(`{"query":"x","source_types":["docs"],"k":99}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(k=99) err = nil; want rejection")
	}
}

func TestRetrieveDocs_ExecuteCallsRetriever(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{
		out: []rag.Chunk{
			{SourceType: "docs", SourceID: "notif/web-push.md", ChunkIdx: 0, Text: "Hello", Score: 0.91},
			{SourceType: "i18n", SourceID: "settings.notifications.browserPush", ChunkIdx: 0, Text: "World", Score: 0.83},
		},
	}
	tool := &retrieveDocs{r: ret}
	in := retrieveDocsInput{
		Query:       "enable web push",
		SourceTypes: []string{"docs", "i18n"},
		K:           4,
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(ret.queries) != 1 || ret.queries[0] != "enable web push" {
		t.Errorf("retriever.queries = %v, want [enable web push]", ret.queries)
	}
	// Help corpus is GLOBAL; subject MUST be empty regardless of
	// any per-request subject installed in ctx.
	if len(ret.subjects) != 1 || ret.subjects[0] != "" {
		t.Errorf("retriever.subjects = %v, want [\"\"] (global corpus)", ret.subjects)
	}
	if len(ret.ks) != 1 || ret.ks[0] != 4 {
		t.Errorf("retriever.ks = %v, want [4]", ret.ks)
	}
	env := out.(map[string]any)
	chunks := env["chunks"].([]helpChunk)
	if len(chunks) != 2 {
		t.Fatalf("envelope.chunks len = %d, want 2", len(chunks))
	}
	if chunks[0].SourceType != "docs" {
		t.Errorf("chunks[0].SourceType = %q, want docs", chunks[0].SourceType)
	}
	if got := env["k"].(int); got != 4 {
		t.Errorf("envelope.k = %d, want 4", got)
	}
}

func TestRetrieveDocs_ExecuteSubstitutesDefaultK(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{}
	tool := &retrieveDocs{r: ret}
	in := retrieveDocsInput{
		Query:       "anything",
		SourceTypes: []string{"docs"},
		// K omitted — Execute must substitute ragHelpDefaultK.
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(ret.ks) != 1 || ret.ks[0] != ragHelpDefaultK {
		t.Fatalf("retriever.ks = %v, want [%d]", ret.ks, ragHelpDefaultK)
	}
}

func TestRetrieveDocs_ExecuteWrapsRetrieverError(t *testing.T) {
	t.Parallel()
	boom := errors.New("vector search down")
	tool := &retrieveDocs{r: &fakeRetriever{err: boom}}
	_, err := tool.Execute(context.Background(), retrieveDocsInput{
		Query:       "x",
		SourceTypes: []string{"docs"},
	})
	if err == nil || !errors.Is(err, boom) {
		t.Fatalf("Execute err = %v, want wrap of %v", err, boom)
	}
	if !strings.Contains(err.Error(), "rag.Retrieve") {
		t.Errorf("Execute err %q must mention rag.Retrieve", err.Error())
	}
}

func TestRetrieveDocs_ExecuteNilRetriever(t *testing.T) {
	t.Parallel()
	tool := &retrieveDocs{r: nil}
	_, err := tool.Execute(context.Background(), retrieveDocsInput{
		Query:       "x",
		SourceTypes: []string{"docs"},
	})
	if err == nil || !strings.Contains(err.Error(), "no rag.Retriever") {
		t.Fatalf("Execute(nil retriever) err = %v, want explicit wiring error", err)
	}
}

// --- cite_help_chunk -----------------------------------------------

func TestCiteHelpChunk_Metadata(t *testing.T) {
	t.Parallel()
	tool := &citeHelpChunk{}
	if got := tool.Name(); got != "cite_help_chunk" {
		t.Fatalf("Name() = %q, want cite_help_chunk", got)
	}
	if tool.Mutates() {
		t.Fatal("Mutates() = true; cite_help_chunk must be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Fatalf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	desc := tool.Description()
	for _, must := range []string{"docs", "i18n", "runbooks", "READ-only", "label", "key"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q; got=%q", must, desc)
		}
	}
	if len(tool.InputSchema()) == 0 {
		t.Fatal("InputSchema() returned empty")
	}
}

func TestCiteHelpChunk_ValidateAcceptsAllowedSourceType(t *testing.T) {
	t.Parallel()
	tool := &citeHelpChunk{}
	raw := json.RawMessage(`{"source_type":"docs","source_id":"notif/web-push.md","chunk_idx":2}`)
	got, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	in := got.(citeHelpChunkInput)
	if in.SourceType != "docs" || in.SourceID != "notif/web-push.md" || in.ChunkIdx != 2 {
		t.Fatalf("Validate decoded wrong fields: %+v", in)
	}
}

func TestCiteHelpChunk_ValidateRejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &citeHelpChunk{}
	raw := json.RawMessage(`{"source_type":"alert_history","source_id":"x"}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(alert_history) err = nil; want rejection")
	}
	if !strings.Contains(err.Error(), "alert_history") {
		t.Errorf("error %q must name the offending type", err.Error())
	}
}

func TestCiteHelpChunk_ValidateRejectsBlankSourceID(t *testing.T) {
	t.Parallel()
	tool := &citeHelpChunk{}
	raw := json.RawMessage(`{"source_type":"docs","source_id":"   "}`)
	_, err := tool.Validate(raw)
	if err == nil {
		t.Fatal("Validate(blank source_id) err = nil; want rejection")
	}
}

func TestCiteHelpChunk_ExecuteFormatsLabelAndKey(t *testing.T) {
	t.Parallel()
	tool := &citeHelpChunk{}

	// chunk_idx omitted ⇒ no "(part N)" suffix.
	got, err := tool.Execute(context.Background(), citeHelpChunkInput{
		SourceType: "docs",
		SourceID:   "notif/web-push.md",
	})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	out := got.(*citeHelpChunkOutput)
	if out.Label != "docs: notif/web-push.md" {
		t.Errorf("Label = %q, want %q", out.Label, "docs: notif/web-push.md")
	}
	if out.Key != "docs:notif/web-push.md" {
		t.Errorf("Key = %q, want %q", out.Key, "docs:notif/web-push.md")
	}

	// chunk_idx > 0 ⇒ "(part N)" suffix and ":N" key suffix.
	got2, err := tool.Execute(context.Background(), citeHelpChunkInput{
		SourceType: "i18n",
		SourceID:   "settings.notifications.browserPush",
		ChunkIdx:   3,
	})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	out2 := got2.(*citeHelpChunkOutput)
	if out2.Label != "i18n: settings.notifications.browserPush (part 3)" {
		t.Errorf("Label = %q, want %q", out2.Label, "i18n: settings.notifications.browserPush (part 3)")
	}
	if out2.Key != "i18n:settings.notifications.browserPush:3" {
		t.Errorf("Key = %q, want %q", out2.Key, "i18n:settings.notifications.browserPush:3")
	}
}

func TestCiteHelpChunk_ExecuteIsDeterministic(t *testing.T) {
	t.Parallel()
	tool := &citeHelpChunk{}
	in := citeHelpChunkInput{
		SourceType: "runbooks",
		SourceID:   "ops/restart.md",
		ChunkIdx:   1,
	}
	a, _ := tool.Execute(context.Background(), in)
	b, _ := tool.Execute(context.Background(), in)
	if *(a.(*citeHelpChunkOutput)) != *(b.(*citeHelpChunkOutput)) {
		t.Fatalf("Execute not deterministic: a=%+v b=%+v", a, b)
	}
}

// --- registration / allowlist contract ----------------------------

func TestRegisterHelpTools_AddsBothToolsAndIsAlphabetical(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterHelpTools(r, HelpSources{Retriever: &fakeRetriever{}})
	if _, ok := r.Get("retrieve_docs"); !ok {
		t.Fatal("retrieve_docs not registered")
	}
	if _, ok := r.Get("cite_help_chunk"); !ok {
		t.Fatal("cite_help_chunk not registered")
	}
	// Both tools MUST be Mutates() == false (read-only contract).
	for _, name := range []string{"retrieve_docs", "cite_help_chunk"} {
		tool, ok := r.Get(name)
		if !ok {
			t.Fatalf("%s missing from registry", name)
		}
		if tool.Mutates() {
			t.Errorf("%s.Mutates() = true; help tools must be read-only", name)
		}
	}
}

func TestRegisterHelpTools_DuplicateRegistrationPanics(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterHelpTools(r, HelpSources{Retriever: &fakeRetriever{}})
	defer func() {
		if recover() == nil {
			t.Fatal("RegisterHelpTools twice did not panic")
		}
	}()
	RegisterHelpTools(r, HelpSources{Retriever: &fakeRetriever{}})
}

func TestRegisterChatbotKnowledgeTool_UsesIndependentName(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	ret := &fakeRetriever{}
	RegisterHelpTools(r, HelpSources{Retriever: ret})
	RegisterChatbotKnowledgeTool(r, HelpSources{Retriever: ret})

	tool, ok := r.Get("retrieve_app_knowledge")
	if !ok {
		t.Fatal("retrieve_app_knowledge not registered")
	}
	if tool.Mutates() {
		t.Fatal("retrieve_app_knowledge must be read-only")
	}
	for _, must := range []string{"application usage", "fleet query tools", "DO NOT fabricate"} {
		if !strings.Contains(tool.Description(), must) {
			t.Errorf("Description() missing %q: %q", must, tool.Description())
		}
	}
}

func TestAllowedHelpSourceTypes_ReturnsDefensiveCopySorted(t *testing.T) {
	t.Parallel()
	a := AllowedHelpSourceTypes()
	b := AllowedHelpSourceTypes()
	if len(a) != 3 {
		t.Fatalf("AllowedHelpSourceTypes len = %d, want 3", len(a))
	}
	// Sorted lex.
	for i := 1; i < len(a); i++ {
		if a[i-1] > a[i] {
			t.Errorf("AllowedHelpSourceTypes not sorted: %v", a)
		}
	}
	a[0] = "MUTATED"
	if b[0] == "MUTATED" {
		t.Fatal("AllowedHelpSourceTypes leaked mutation; not a defensive copy")
	}
	// Must contain every expected source type.
	want := map[string]bool{"docs": false, "runbooks": false, "i18n": false}
	for _, st := range b {
		if _, ok := want[st]; !ok {
			t.Errorf("AllowedHelpSourceTypes contains unknown %q", st)
		} else {
			want[st] = true
		}
	}
	for st, seen := range want {
		if !seen {
			t.Errorf("AllowedHelpSourceTypes missing %q", st)
		}
	}
}
