// Natural-language search across drives, charges,
// and alerts.
//
// search.go ships TWO new read-only tools:
//
//   `retrieve_chunks`        — accept a typed natural-language query
//                                 + a small list of source types and
//                                 return the top-k nearest chunks via
//                                 the rag.Retriever scoped to the
//                                 calling user_subject.
//   `hydrate_search_result`  — accept a typed (source_type, source_id)
//                                 reference and return a human-friendly
//                                 envelope (title, subtitle, url, when)
//                                 by delegating to a narrow Hydrator
//                                 port. The Hydrator is satisfied at
//                                 boot by an adapter (see router.go)
//                                 that calls the canonical read path
//                                 for each source type.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate is
// never reached in practice — defence in depth in case a future edit
// accidentally adds a write tool. The actual rendering of search
// results to the user happens in the SPA via the existing
// /search baseline UI (`web/src/features/system/pages/SearchPage.tsx`)
// which the AI-side panel decorates with a narrative summary and
// citations to the hydrated entities — the LLM's only effect on the
// system is the narration it streams back over SSE.
//
// Design constraints (from the feature spec):
//
//   "Tools must call existing typed handlers or services; no
//     duplicate write paths." → retrieve_chunks delegates to the RAG
//     rag.Retriever (the single canonical retrieval entry point);
//     hydrate_search_result delegates to a narrow read interface
//     satisfied at boot by an adapter wrapping the existing read
//     handlers (no new SQL).
//
//   "the LLM never writes raw SQL" → tools have no DB handle. The
//     interfaces are intentionally narrow — Retriever exposes only
//     Retrieve / Index / Forget; Hydrator exposes only HydrateOne.
//
//   "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this feature; hydration is a pure read.
//
// The source-type allowlist is enforced at the tool boundary (any
// other rag.Source* constant is refused), so a confused LLM that
// asks the assistant to search e.g. "user_note" cannot accidentally
// expose a corpus the feature did not enumerate.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
)

// nlSearchAllowedSourceTypes is the per-feature allowlist of
// rag.Source* constants the nl-search strategy may retrieve over.
// Any other source type passed via the LLM's typed input is refused
// at validation time — the feature spec explicitly enumerates these
// three corpora and a future feature that adds a new source must add
// it here AND extend the strategy's system prompt + goldens, not
// silently widen.
//
// Kept in lex order so error messages list a stable allowed-set.
var nlSearchAllowedSourceTypes = []string{
	rag.SourceAlertHistory,
	rag.SourceChargeSession,
	rag.SourceDriveSummary,
}

// nlSearchAllowedSourceTypeSet is the O(1) membership lookup for the
// allowlist above. Computed at package init so the tool's Validate
// hot path doesn't re-hash on every call.
var nlSearchAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(nlSearchAllowedSourceTypes))
	for _, s := range nlSearchAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// nlSearchMaxK is the per-call upper bound on the retriever's k
// parameter. The RAG retriever's hard ceiling is rag.MaxK (100); we
// clamp tighter here because a conversational NL search returning
// >16 results adds no value (the LLM won't cite them all and the
// chunk text inflates the context window cost).
const nlSearchMaxK = 16

// nlSearchDefaultK is the value substituted when the LLM omits k or
// passes 0. Conservative default that yields enough recall for
// typical "find drives matching X" queries without overwhelming the
// narrative.
const nlSearchDefaultK = 5

// nlSearchMaxQueryChars caps the user-supplied natural-language query
// at the tool boundary. Generous for a multi-sentence search prompt;
// defensive against an enormous payload that would inflate the
// embedding API cost and dominate the model's input window.
const nlSearchMaxQueryChars = 1024

// nlSearchAllowedSourceTypesHint is the comma-separated allowlist
// rendered in retrieve_chunks's Description so the LLM picks from
// the enumerated set. Computed once at package init.
var nlSearchAllowedSourceTypesHint = strings.Join(nlSearchAllowedSourceTypes, ", ")

// retrieveChunksInput is the typed input shape for retrieve_chunks.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails before
// any rag.Retriever method runs.
type retrieveChunksInput struct {
	// Query is the natural-language search expression. Required +
	// non-empty + bounded — an empty query embeds to a meaningless
	// zero-vector and a 100KB query inflates cost.
	Query string `json:"query" validate:"required" desc:"Natural-language search query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to search.
	// Each entry MUST appear in nlSearchAllowedSourceTypes; an
	// unknown source type is refused at validation time. Empty /
	// omitted is rejected — the LLM MUST be explicit about which
	// corpora the user asked about.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: drive_summary, charge_session, alert_history."`

	// K is the requested top-k count. Optional; defaults to
	// nlSearchDefaultK when zero. Bounded to [0, nlSearchMaxK] —
	// the package-level validator does not special-case `omitempty`,
	// so we use `gte=0` (the zero sentinel passes; Execute
	// substitutes the default).
	K int `json:"k,omitempty" validate:"gte=0,lte=16" desc:"Top-k count to return; default 5 when omitted, max 16."`
}

// retrievedChunk is the shared envelope for one chunk in the
// retrieve_chunks output. Mirrors rag.Chunk but uses explicit
// JSON tags so the tool's output marshals stably regardless of any
// future change to the underlying rag.Chunk shape.
type retrievedChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveChunks is the read-only tool that calls the RAG retriever.
// It is the FIRST tool the LLM is expected to call (per the
// strategy's system prompt).
//
// Execution: typed input → user_subject from ctx → rag.Retriever.Retrieve
// → JSON envelope. No DB write; no SQL written by this method.
type retrieveChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveChunks) Name() string { return "retrieve_chunks" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the source-type
// allowlist appended so the model picks from the curated set.
func (t *retrieveChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's own corpora via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + nlSearchAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate a result to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveChunks) InputSchema() json.RawMessage {
	return CachedSchema(retrieveChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *retrieveChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *retrieveChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream, and the retriever scopes by the
// calling user_subject so cross-tenant leakage is impossible).
func (t *retrieveChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for feature fields.
func (t *retrieveChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := ValidateStruct[retrieveChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveChunksInput)
	if err := assertAllowedSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	return in, nil
}

// Execute implements [Tool]. Resolves user_subject from the ctx the
// AI handler installed via provider.WithSubject, then calls the RAG
// retriever. Returns a deterministic envelope with explicit JSON
// tags so the dispatcher's serialisation path is uniform across
// runs.
//
// A nil retriever is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests that
// instantiate the tool directly.
func (t *retrieveChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_chunks: no rag.Retriever wired")
	}

	k := input.K
	if k == 0 {
		k = nlSearchDefaultK
	}

	// Subject is sourced from ctx (installed by the AI handler via
	// provider.WithSubject). Empty subject is the open-mode value
	// the audit log treats as "anonymous" — single-tenant
	// installations pass "" and the retrieve scopes accordingly.
	subject := provider.SubjectFromContext(ctx)

	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_chunks: rag.Retrieve: %w", err)
	}

	// Convert to a deterministic envelope so the tool output renders
	// as a flat JSON object (matches the year-review / digest /
	// anomaly tools' shape, keeping the dispatcher's serialisation
	// path uniform across read tools).
	out := make([]retrievedChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedChunk{
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

// HydratedResult is the shared envelope for one hydrated search
// result. Returned by Hydrator.HydrateOne and surfaced verbatim by
// the hydrate_search_result tool. Fields:
//
//	SourceType: matches one of the rag.Source* constants the
//	  allowlist permits.
//	SourceID:   domain key the hydrator resolved (typically a
//	  numeric ID rendered as a string for cross-source uniformity).
//	Title:      one-line human-friendly title (e.g. "Drive #142
//	  2025-01-04 14:32 → 15:18").
//	Subtitle:   optional one-line context (route, total energy,
//	  alert message). May be empty.
//	URL:        SPA route the user can navigate to for the full
//	  entity view (e.g. "/drives/142"). May be empty if the source
//	  type does not have a dedicated detail page.
//	When:       RFC3339 timestamp of the entity's primary
//	  timestamp (drive start, charge start, alert fired_at). May
//	  be empty if the source type has no canonical timestamp.
//
// The shape mirrors web/src/api/types.ts SearchHit so the AI side
// panel can render the hydrated envelope using the same component
// the typed search uses for its hits — no duplicate render path.
type HydratedResult struct {
	SourceType string `json:"source_type"`
	SourceID   string `json:"source_id"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle,omitempty"`
	URL        string `json:"url,omitempty"`
	When       string `json:"when,omitempty"`
}

// Hydrator is the narrow read interface the hydrate_search_result
// tool needs. In production it is satisfied at boot by an adapter
// (see router.go) that delegates per-source-type lookups to the
// existing canonical read repos. Tests substitute a deterministic
// fake.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the propose-only contract that ADR-015 §I3 + the
// feature spec mandate. New methods that fetch additional read-only
// metadata (e.g. HydrateMany for batch lookups) are fine.
type Hydrator interface {
	// HydrateOne resolves a (sourceType, sourceID) reference into a
	// human-friendly HydratedResult. The userSubject parameter
	// scopes the lookup to the requesting principal so a confused
	// LLM that asks for someone else's drive ID gets a structured
	// "not found" rather than a cross-tenant leak.
	//
	// Returns ErrHydratorNotFound when no entity matches the
	// (subject, type, id) tuple. Other errors are propagated as-is
	// so the dispatcher can emit a tool-error frame.
	HydrateOne(ctx context.Context, userSubject, sourceType, sourceID string) (*HydratedResult, error)
}

// ErrHydratorNotFound is the sentinel error a Hydrator returns when
// the (subject, type, id) tuple does not resolve to an entity.
// hydrate_search_result surfaces this as a structured envelope with
// status="not_found" rather than a tool error so the LLM can adapt
// its narration without retrying.
var ErrHydratorNotFound = errors.New("tools: hydrator: source_id not found for subject")

// hydrateSearchResultInput is the typed input shape for
// hydrate_search_result. The dispatcher decodes the LLM's tool-call
// arguments JSON into this struct via ValidateStruct so a malformed
// input fails before any Hydrator method runs.
type hydrateSearchResultInput struct {
	// SourceType identifies which corpus the source_id belongs to.
	// Required + must match the per-feature allowlist.
	SourceType string `json:"source_type" validate:"required" desc:"Source type to hydrate; allowed values: drive_summary, charge_session, alert_history."`

	// SourceID is the domain key (typically a numeric ID rendered
	// as a string for cross-source uniformity). Required +
	// non-empty.
	SourceID string `json:"source_id" validate:"required" desc:"Domain identifier of the entity (e.g. drive ID, charge session ID)."`
}

// hydratedSearchResultOutput is the wire envelope for one
// hydrate_search_result call.
//
//	Status == "ok"        ⇒ Result populated.
//	Status == "not_found" ⇒ Result is the zero value; LLM should
//	                         tell the user the cited entity no
//	                         longer exists.
//	Status == "error"     ⇒ Error populated; the dispatcher will
//	                         relay this to the LLM as a tool error.
//	                         (Errors normally bypass this envelope
//	                         and surface as a tool-error frame; the
//	                         field exists for documentation
//	                         symmetry with the not_found path.)
type hydratedSearchResultOutput struct {
	Status string          `json:"status"`
	Result *HydratedResult `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// hydrateSearchResult is the read-only tool that resolves a chunk
// reference into a human-friendly envelope. It is the OPTIONAL
// follow-up tool the LLM calls after retrieve_chunks per the
// strategy's system prompt.
type hydrateSearchResult struct {
	h Hydrator
}

// Name implements [Tool].
func (t *hydrateSearchResult) Name() string { return "hydrate_search_result" }

// Description implements [Tool].
func (t *hydrateSearchResult) Description() string {
	return "Resolve a chunk reference (source_type + source_id from retrieve_chunks) into a human-friendly envelope: {title, subtitle, url, when}. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + nlSearchAllowedSourceTypesHint + ". " +
		"Use this AFTER retrieve_chunks to cite an entity by its hydrated title in your narration; do NOT paste raw chunk text. " +
		"Returns {status: ok|not_found|error, result, error}."
}

// InputSchema implements [Tool].
func (t *hydrateSearchResult) InputSchema() json.RawMessage {
	return CachedSchema(hydrateSearchResultInput{})
}

// OutputSchema implements [Tool].
func (t *hydrateSearchResult) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *hydrateSearchResult) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// retrieve_chunks.
func (t *hydrateSearchResult) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag could in principle express but which we
// keep centralised for symmetry with retrieve_chunks (single source
// of truth for the allowlist).
func (t *hydrateSearchResult) Validate(raw json.RawMessage) (any, error) {
	v, err := ValidateStruct[hydrateSearchResultInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(hydrateSearchResultInput)
	if _, ok := nlSearchAllowedSourceTypeSet[in.SourceType]; !ok {
		return nil, fmt.Errorf("hydrate_search_result: source_type %q not in allowed set %s",
			in.SourceType, nlSearchAllowedSourceTypesHint)
	}
	if strings.TrimSpace(in.SourceID) == "" {
		return nil, errors.New("hydrate_search_result: source_id must be non-empty after trim")
	}
	return in, nil
}

// Execute implements [Tool]. Calls Hydrator.HydrateOne with the
// user_subject from ctx. ErrHydratorNotFound is surfaced as a
// status="not_found" envelope (not a returned error) so the LLM can
// adapt its narration; any other error is propagated as a returned
// error and the dispatcher will emit a tool-error frame.
func (t *hydrateSearchResult) Execute(ctx context.Context, in any) (any, error) {
	input := in.(hydrateSearchResultInput)
	if t.h == nil {
		return nil, errors.New("hydrate_search_result: no Hydrator wired")
	}

	subject := provider.SubjectFromContext(ctx)
	res, err := t.h.HydrateOne(ctx, subject, input.SourceType, input.SourceID)
	if err != nil {
		if errors.Is(err, ErrHydratorNotFound) {
			return &hydratedSearchResultOutput{Status: "not_found"}, nil
		}
		return nil, fmt.Errorf("hydrate_search_result: hydrator: %w", err)
	}
	if res == nil {
		// Defensive: a hydrator that returns (nil, nil) is a
		// programming error; surface as not_found so the
		// narration stays sane.
		return &hydratedSearchResultOutput{Status: "not_found"}, nil
	}
	return &hydratedSearchResultOutput{Status: "ok", Result: res}, nil
}

// SearchSources bundles the narrow read interfaces
// RegisterSearchTools needs. Mirrors [DigestSources] /
// [YearReviewSources] / [AnomalySources] / [AlertBuilderSources] /
// [AutomationBuilderSources] but exposes only the surface the
// nl-search tools actually consume.
//
// Production wiring (router.go) instantiates a real rag.Retriever +
// a Hydrator adapter that delegates per-source-type lookups to the
// existing canonical read paths; tests substitute deterministic
// fakes per-source.
type SearchSources struct {
	Retriever rag.Retriever
	Hydrator  Hydrator
}

// RegisterSearchTools installs the nl-search feature's tools on r.
// Called from router.go AFTER RegisterAutomationBuilderTools so the
// registry's alphabetical Names list grows deterministically without
// disturbing earlier registrations or the BuiltinNames pin test.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterSearchTools(r *Registry, s SearchSources) {
	r.Register(&retrieveChunks{r: s.Retriever})
	r.Register(&hydrateSearchResult{h: s.Hydrator})
}

// assertAllowedSourceTypes enforces the per-feature source-type
// allowlist. Returns a deterministic error listing the offending
// entry plus the allowed set so the LLM's tool-error reply contains
// enough context to retry with a corrected payload.
func assertAllowedSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_chunks: source_types is required and must contain at least one entry")
	}
	// Reject duplicates so the LLM's payload is unambiguous and the
	// retriever doesn't double-search the same corpus.
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := nlSearchAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_chunks: source_type %q not in allowed set %s",
				st, nlSearchAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedSearchSourceTypes returns a defensive copy of the per-
// feature source-type allowlist. Exported so the AI handler + tests
// can reference the same set the tools enforce.
func AllowedSearchSourceTypes() []string {
	out := make([]string, len(nlSearchAllowedSourceTypes))
	copy(out, nlSearchAllowedSourceTypes)
	sort.Strings(out)
	return out
}
