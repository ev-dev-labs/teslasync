// RAG-backed app help tools.
//
// help.go ships TWO new read-only tools:
//
//   - `retrieve_docs`     — accept a typed natural-language query
//                            + a small list of source types and
//                            return the top-k nearest chunks via
//                            rag.Retriever scoped to the
//                            global help corpus (docs|runbooks|i18n).
//   - `cite_help_chunk`   — accept a typed (source_type, source_id,
//                            chunk_idx) reference and return a
//                            stable citation envelope (label, key)
//                            without any external lookup. Pure
//                            deterministic formatter; no DB / file
//                            handle.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool. The actual rendering of the
// LLM's answer to the user happens via the SSE stream the rag-help
// AI handler opens; this tool just feeds the LLM grounding chunks
// + a stable citation format.
//
// Design constraints:
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → retrieve_docs delegates to
//     rag.Retriever (the single canonical retrieval entry point);
//     cite_help_chunk is a pure formatter that touches nothing
//     beyond its typed input.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     interfaces are intentionally narrow — Retriever exposes only
//     Retrieve / Index / Forget; cite_help_chunk has no port at all.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists here; citation is a pure read.
//
// The source-type allowlist is enforced at the tool boundary (any
// other rag.Source* constant is refused), so a confused LLM that
// asks the assistant to retrieve e.g. "user_note" cannot accidentally
// expose a corpus outside the help contract. The allowlist covers docs, runbooks, and i18n.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
)

// Help-corpus source-type literals. rag.Retriever takes
// arbitrary string source types — the constants below are the ones
// the rag-help tools recognise. `SourceHelpDocs` aliases
// `rag.SourceDocs` so the existing IndexDocs path under the docs indexer remains the single source of truth for the docs
// corpus; `SourceHelpRunbooks` and `SourceHelpI18n` are new corpora
// keyed off these literal strings (no matching constant in
// internal/ai/rag/rag.go because that package is outside this
// help corpora literals are defined here).
const (
	// SourceHelpDocs aliases rag.SourceDocs so retrieve_docs reads
	// from the same logical corpus the docs indexer writes to.
	SourceHelpDocs = rag.SourceDocs

	// SourceHelpRunbooks is the corpus for operator runbooks. The
	// indexer (the future scheduler-driven `ai_docs_indexer` job)
	// populates it; today the constant exists so retrieve_docs can
	// validate its source-types argument deterministically.
	SourceHelpRunbooks = "runbooks"

	// SourceHelpI18n is the corpus for the application's i18n
	// strings (web/src/i18n/en.json plus tooltips). The indexer
	// populates it; today the constant exists so retrieve_docs can
	// validate its source-types argument deterministically.
	SourceHelpI18n = "i18n"
)

// ragHelpAllowedSourceTypes is the per-feature allowlist of source
// types the rag-help strategy may retrieve over. Any other source
// type passed via the LLM's typed input is refused at validation
// time. The help contract enumerates these three corpora; new sources must update this allowlist, the strategy prompt, and goldens together.
//
// Kept in lex order so error messages list a stable allowed-set.
var ragHelpAllowedSourceTypes = []string{
	SourceHelpDocs,
	SourceHelpI18n,
	SourceHelpRunbooks,
}

// ragHelpAllowedSourceTypeSet is the O(1) membership lookup for the
// allowlist above. Computed at package init so the tool's Validate
// hot path doesn't re-hash on every call.
var ragHelpAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(ragHelpAllowedSourceTypes))
	for _, s := range ragHelpAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// ragHelpMaxK is the per-call upper bound on the retriever's k
// parameter. The retriever's hard ceiling is rag.MaxK (100); we
// clamp tighter here because a help answer rarely benefits from
// >12 chunks (the LLM's narration won't cite them all and the
// chunk text inflates the context window cost).
const ragHelpMaxK = 12

// ragHelpDefaultK is the value substituted when the LLM omits k or
// passes 0. Conservative default that yields enough recall for
// typical "how do I X" queries without overwhelming the answer.
const ragHelpDefaultK = 5

// ragHelpMaxQueryChars caps the user-supplied natural-language query
// at the tool boundary. Generous for a multi-sentence help question;
// defensive against an enormous payload that would inflate the
// embedding API cost and dominate the model's input window.
const ragHelpMaxQueryChars = 1024

// ragHelpAllowedSourceTypesHint is the comma-separated allowlist
// rendered in retrieve_docs's Description so the LLM picks from the
// enumerated set. Computed once at package init.
var ragHelpAllowedSourceTypesHint = strings.Join(ragHelpAllowedSourceTypes, ", ")

// retrieveDocsInput is the typed input shape for retrieve_docs.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails before
// any rag.Retriever method runs.
type retrieveDocsInput struct {
	// Query is the natural-language help question. Required +
	// non-empty + bounded — an empty query embeds to a meaningless
	// zero-vector and a 100KB query inflates cost.
	Query string `json:"query" validate:"required" desc:"Natural-language help question (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to search.
	// Each entry MUST appear in ragHelpAllowedSourceTypes; an
	// unknown source type is refused at validation time. Empty /
	// omitted is rejected — the LLM MUST be explicit about which
	// corpora the question covers.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: docs, i18n, runbooks."`

	// K is the requested top-k count. Optional; defaults to
	// ragHelpDefaultK when zero. Bounded to [0, ragHelpMaxK] —
	// the package-level validator does not special-case
	// `omitempty`, so we use `gte=0` (the zero sentinel passes;
	// Execute substitutes the default).
	K int `json:"k,omitempty" validate:"gte=0,lte=12" desc:"Top-k count to return; default 5 when omitted, max 12."`
}

// helpChunk is the shared envelope for one chunk in the
// retrieve_docs output. Mirrors rag.Chunk but uses explicit JSON
// tags so the tool's output marshals stably regardless of any
// future change to the underlying rag.Chunk shape.
type helpChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveDocs is the read-only tool that calls the retriever
// over the help corpus. It is the FIRST tool the LLM is expected to
// call (per the strategy's system prompt).
//
// Execution: typed input → user_subject from ctx → rag.Retriever.Retrieve
// → JSON envelope. No DB write; no SQL written by this method.
type retrieveDocs struct {
	r    rag.Retriever
	name string
}

// Name implements [Tool].
func (t *retrieveDocs) Name() string {
	if t.name != "" {
		return t.name
	}
	return "retrieve_docs"
}

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the source-type
// allowlist appended so the model picks from the curated set.
func (t *retrieveDocs) Description() string {
	if t.Name() == "retrieve_app_knowledge" {
		return "Search TeslaSync's own documentation, runbooks, and interface text for application usage, configuration, or troubleshooting questions. " +
			"Use fleet query tools instead for vehicle telemetry, drives, charging, alerts, or efficiency. " +
			"READ-only: no record is created, mutated, or deleted. " +
			"Allowed source_types: " + ragHelpAllowedSourceTypesHint + ". " +
			"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; cite only returned source_id values and DO NOT fabricate a result when chunks is empty."
	}
	return "Find the top-k nearest chunks to a natural-language help question across the application's own documentation, runbooks, and i18n strings via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + ragHelpAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate a result to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveDocs) InputSchema() json.RawMessage {
	return CachedSchema(retrieveDocsInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *retrieveDocs) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *retrieveDocs) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream, and the help corpus is global +
// non-PII so cross-tenant leakage is structurally impossible).
func (t *retrieveDocs) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for slice fields.
func (t *retrieveDocs) Validate(raw json.RawMessage) (any, error) {
	v, err := ValidateStruct[retrieveDocsInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveDocsInput)
	if err := assertAllowedHelpSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > ragHelpMaxQueryChars {
		return nil, fmt.Errorf("%s: query is %d chars (max %d)", t.Name(),
			len(in.Query), ragHelpMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool]. Resolves user_subject from the ctx the
// AI handler installed via provider.WithSubject, then calls the retriever. Returns a deterministic envelope with explicit JSON
// tags so the dispatcher's serialisation path is uniform across
// runs.
//
// A nil retriever is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests that
// instantiate the tool directly.
//
// The help corpus is global, so we pass user_subject="" to retrieve from the global corpus
// (matches the docs indexer's userSubject="" convention). The
// per-tenant scoping enforced by other strategies (nl-search) does
// not apply here.
func (t *retrieveDocs) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveDocsInput)
	if t.r == nil {
		return nil, fmt.Errorf("%s: no rag.Retriever wired", t.Name())
	}

	k := input.K
	if k == 0 {
		k = ragHelpDefaultK
	}

	// Help corpus is global; pass empty subject so the retriever reads
	// from the user_subject="" rows the docs indexer writes. This is
	// intentionally distinct from nl-search's per-user scoping.
	const helpCorpusSubject = ""

	chunks, err := t.r.Retrieve(ctx, helpCorpusSubject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("%s: rag.Retrieve: %w", t.Name(), err)
	}

	// Convert to a deterministic envelope so the tool output
	// renders as a flat JSON object (matches the nl-search
	// retrieve_chunks shape, keeping the dispatcher's
	// serialisation path uniform across read tools).
	out := make([]helpChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, helpChunk{
			SourceType: c.SourceType,
			SourceID:   c.SourceID,
			ChunkIdx:   c.ChunkIdx,
			Text:       c.Text,
			Score:      c.Score,
		})
	}
	return map[string]any{
		"query":        input.Query,
		"source_types": input.SourceTypes,
		"k":            k,
		"chunks":       out,
	}, nil
}

// citeHelpChunkInput is the typed input shape for cite_help_chunk.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails before
// any formatter logic runs.
type citeHelpChunkInput struct {
	// SourceType identifies which corpus the source_id belongs to.
	// Required + must match the per-feature allowlist.
	SourceType string `json:"source_type" validate:"required" desc:"Source type to cite; allowed values: docs, i18n, runbooks."`

	// SourceID is the canonical identifier of the source within
	// its corpus (file path for docs/runbooks, dotted i18n key for
	// i18n). Required + non-empty.
	SourceID string `json:"source_id" validate:"required" desc:"Identifier of the source within its corpus (e.g. notifications/web-push.md, settings.notifications.browserPush)."`

	// ChunkIdx is the 0-based position of the chunk within the
	// source. Optional — when omitted, the citation refers to the
	// whole source rather than a specific chunk.
	ChunkIdx int `json:"chunk_idx,omitempty" validate:"gte=0" desc:"0-based chunk position; omit when citing the whole source."`
}

// citeHelpChunkOutput is the wire envelope for one cite_help_chunk
// call. The fields are stable so the LLM can paste them verbatim
// into a citations list at the bottom of its answer.
//
//	Label: human-readable citation string, e.g.
//	       "docs: notifications/web-push.md (part 2)"; safe to render
//	       inside a markdown bullet item without escaping.
//	Key:   stable opaque key for deduplication, e.g.
//	       "docs:notifications/web-push.md:2".
type citeHelpChunkOutput struct {
	SourceType string `json:"source_type"`
	SourceID   string `json:"source_id"`
	ChunkIdx   int    `json:"chunk_idx,omitempty"`
	Label      string `json:"label"`
	Key        string `json:"key"`
}

// citeHelpChunk is the read-only tool that converts a chunk
// reference into a stable citation envelope. It is the OPTIONAL
// follow-up tool the LLM calls after retrieve_docs per the
// strategy's system prompt.
//
// Pure deterministic formatter — no external dependencies, no DB,
// no file IO. Two callers with the same input produce byte-
// identical output, which keeps the dispatcher's hash-based reply
// caching effective and the eval goldens deterministic.
type citeHelpChunk struct{}

// Name implements [Tool].
func (t *citeHelpChunk) Name() string { return "cite_help_chunk" }

// Description implements [Tool].
func (t *citeHelpChunk) Description() string {
	return "Format a chunk reference (source_type + source_id + optional chunk_idx from retrieve_docs) into a stable citation envelope: {label, key}. " +
		"READ-only and dependency-free: no record is read, created, mutated, or deleted. " +
		"Allowed source_types: " + ragHelpAllowedSourceTypesHint + ". " +
		"Use this AFTER retrieve_docs to render a stable citations list at the bottom of your answer; do NOT paste raw chunk text. " +
		"Returns {source_type, source_id, chunk_idx, label, key}."
}

// InputSchema implements [Tool].
func (t *citeHelpChunk) InputSchema() json.RawMessage {
	return CachedSchema(citeHelpChunkInput{})
}

// OutputSchema implements [Tool].
func (t *citeHelpChunk) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *citeHelpChunk) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// retrieve_docs.
func (t *citeHelpChunk) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag could in principle express but which we
// keep centralised for symmetry with retrieve_docs (single source
// of truth for the allowlist).
func (t *citeHelpChunk) Validate(raw json.RawMessage) (any, error) {
	v, err := ValidateStruct[citeHelpChunkInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(citeHelpChunkInput)
	if _, ok := ragHelpAllowedSourceTypeSet[in.SourceType]; !ok {
		return nil, fmt.Errorf("cite_help_chunk: source_type %q not in allowed set %s",
			in.SourceType, ragHelpAllowedSourceTypesHint)
	}
	if strings.TrimSpace(in.SourceID) == "" {
		return nil, errors.New("cite_help_chunk: source_id must be non-empty after trim")
	}
	return in, nil
}

// Execute implements [Tool]. Pure formatter — assembles a stable
// human-readable label and a deduplication key from the inputs.
// Returns the typed envelope directly so the dispatcher's JSON
// marshaller renders fields in a stable order.
func (t *citeHelpChunk) Execute(_ context.Context, in any) (any, error) {
	input := in.(citeHelpChunkInput)
	label := fmt.Sprintf("%s: %s", input.SourceType, input.SourceID)
	key := fmt.Sprintf("%s:%s", input.SourceType, input.SourceID)
	if input.ChunkIdx > 0 {
		label = fmt.Sprintf("%s (part %d)", label, input.ChunkIdx)
		key = fmt.Sprintf("%s:%d", key, input.ChunkIdx)
	}
	return &citeHelpChunkOutput{
		SourceType: input.SourceType,
		SourceID:   input.SourceID,
		ChunkIdx:   input.ChunkIdx,
		Label:      label,
		Key:        key,
	}, nil
}

// HelpSources bundles the narrow read interfaces
// RegisterHelpTools needs. Mirrors [SearchSources] but exposes only
// the surface the rag-help tools actually consume — no Hydrator
// because cite_help_chunk is a pure formatter.
//
// Production wiring (router.go) instantiates a real rag.Retriever
// shared with the docs indexer; tests substitute a deterministic
// fake.
type HelpSources struct {
	Retriever rag.Retriever
}

// RegisterHelpTools installs the rag-help tools on r.
// Called from router.go AFTER RegisterChargingDiagnosisTools so the
// registry's alphabetical Names list grows deterministically without
// disturbing earlier registrations or the BuiltinNames pin test.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterHelpTools(r *Registry, s HelpSources) {
	r.Register(&retrieveDocs{r: s.Retriever})
	r.Register(&citeHelpChunk{})
}

// RegisterChatbotKnowledgeTool installs a chatbot-scoped view of the global
// help corpus. Production passes a retriever configured with chatbot-llm's
// feature ID, so chat knowledge retrieval never depends on rag-help being
// enabled or sharing its provider configuration.
func RegisterChatbotKnowledgeTool(r *Registry, s HelpSources) {
	r.Register(&retrieveDocs{
		r:    s.Retriever,
		name: "retrieve_app_knowledge",
	})
}

// assertAllowedHelpSourceTypes enforces the per-feature source-type
// allowlist. Returns a deterministic error listing the offending
// entry plus the allowed set so the LLM's tool-error reply contains
// enough context to retry with a corrected payload.
func assertAllowedHelpSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_docs: source_types is required and must contain at least one entry")
	}
	// Reject duplicates so the LLM's payload is unambiguous and
	// the retriever doesn't double-search the same corpus.
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := ragHelpAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_docs: source_type %q not in allowed set %s",
				st, ragHelpAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_docs: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedHelpSourceTypes returns a defensive copy of the per-
// feature source-type allowlist. Exported so the AI handler + tests
// can reference the same set the tools enforce.
func AllowedHelpSourceTypes() []string {
	out := make([]string, len(ragHelpAllowedSourceTypes))
	copy(out, ragHelpAllowedSourceTypes)
	sort.Strings(out)
	return out
}
