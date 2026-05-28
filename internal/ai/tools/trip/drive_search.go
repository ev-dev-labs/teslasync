// Phase-50 / 0021 — D1 Natural-language drive search and replay.
//
// drive_search.go ships TWO new read-only tools:
//
//   - `retrieve_drive_chunks` — accept a typed natural-language
//     query + a small list of drive-domain source types and
//     return the top-k nearest chunks via the F7 rag.Retriever
//     scoped to the calling user_subject.
//   - `hydrate_drive_replay`  — accept a typed (source_type,
//     source_id) reference and return a human-friendly envelope
//     (title, subtitle, url, replay_url, when) by delegating to a
//     narrow DriveReplayHydrator port. The hydrator is satisfied
//     at boot by an adapter (see router.go) that calls the
//     canonical read path for the drive domain.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool. The actual rendering of
// drive matches to the user happens in the SPA via the existing
// /drives baseline UI (DrivesListPage) and /drives/:id/replay
// TripReplayPage — the AI side panel decorates these with a
// narrative summary plus the replay anchor (replay_url) the
// hydrator returns.
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → retrieve_drive_chunks delegates to
//     the F7 rag.Retriever (the single canonical retrieval entry
//     point); hydrate_drive_replay delegates to a narrow read
//     interface satisfied at boot by an adapter wrapping the
//     existing Drive read handler (no new SQL).
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     interfaces are intentionally narrow — Retriever exposes only
//     Retrieve / Index / Forget; DriveReplayHydrator exposes only
//     HydrateOne.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; hydration is a pure read.
//
// The source-type allowlist is enforced at the tool boundary (any
// other rag.Source* constant is refused), so a confused LLM that
// asks the assistant to search e.g. "user_note" cannot accidentally
// expose a corpus the slice did not enumerate.
//
// Forward-compat note: the slice prompt enumerates three source
// types — drive_summary, route_segment, location_summary. Only
// drive_summary is wired into the F7 indexer today (see
// internal/ai/rag/rag.go SourceDriveSummary). route_segment and
// location_summary are reserved by string so a future indexer slice
// can register them without re-touching the tool boundary. Until
// that indexer ships, retrieve_drive_chunks called with
// source_types=["route_segment"] or ["location_summary"] returns
// zero chunks — which is the correct behaviour: the retriever
// simply has nothing indexed yet, and the strategy's goldens
// already cover the zero-matches narration.

package trip

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// nlDriveSearchSourceRouteSegment / nlDriveSearchSourceLocationSummary
// are the two source-type strings reserved by the slice prompt that
// have no F7 indexer today. They are intentionally NOT exported as
// rag.Source* constants because adding to that package widens the
// global F7 contract beyond this slice's mandate. When a future
// slice adds the indexer it should promote these strings to
// rag.SourceRouteSegment / rag.SourceLocationSummary in one place.
const (
	nlDriveSearchSourceRouteSegment    = "route_segment"
	nlDriveSearchSourceLocationSummary = "location_summary"
)

// nlDriveSearchAllowedSourceTypes is the per-feature allowlist of
// source-type strings the nl-drive-search-replay strategy may
// retrieve over. Any other source type passed via the LLM's typed
// input is refused at validation time — the slice prompt explicitly
// enumerates these three corpora and a future slice that adds a new
// source must add it here AND extend the strategy's system prompt +
// goldens, not silently widen.
//
// Kept in lex order so error messages list a stable allowed-set.
var nlDriveSearchAllowedSourceTypes = []string{
	rag.SourceDriveSummary,
	nlDriveSearchSourceLocationSummary,
	nlDriveSearchSourceRouteSegment,
}

// nlDriveSearchAllowedSourceTypeSet is the O(1) membership lookup
// for the allowlist above. Computed at package init so the tool's
// Validate hot path doesn't re-hash on every call.
var nlDriveSearchAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(nlDriveSearchAllowedSourceTypes))
	for _, s := range nlDriveSearchAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// nlDriveSearchMaxK is the per-call upper bound on the retriever's
// k parameter. Mirrors nl-search's ceiling: a conversational NL
// drive search returning >16 results adds no value (the LLM won't
// cite them all and chunk text inflates context cost).
const nlDriveSearchMaxK = 16

// nlDriveSearchDefaultK is the value substituted when the LLM omits
// k or passes 0.
const nlDriveSearchDefaultK = 5

// nlDriveSearchMaxQueryChars caps the user-supplied
// natural-language query at the tool boundary. Generous for a
// multi-sentence search prompt; defensive against an enormous
// payload that would inflate the embedding API cost and dominate
// the model's input window.
const nlDriveSearchMaxQueryChars = 1024

// nlDriveSearchAllowedSourceTypesHint is the comma-separated
// allowlist rendered in retrieve_drive_chunks's Description so the
// LLM picks from the enumerated set. Computed once at package init.
var nlDriveSearchAllowedSourceTypesHint = strings.Join(nlDriveSearchAllowedSourceTypes, ", ")

// retrieveDriveChunksInput is the typed input shape for
// retrieve_drive_chunks. The dispatcher decodes the LLM's tool-call
// arguments JSON into this struct via ValidateStruct so a malformed
// input fails before any rag.Retriever method runs.
type retrieveDriveChunksInput struct {
	// Query is the natural-language search expression. Required +
	// non-empty + bounded — an empty query embeds to a meaningless
	// zero-vector and a 100KB query inflates cost.
	Query string `json:"query" validate:"required" desc:"Natural-language drive search query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to search.
	// Each entry MUST appear in nlDriveSearchAllowedSourceTypes;
	// an unknown source type is refused at validation time. Empty
	// / omitted is rejected — the LLM MUST be explicit about
	// which corpora the user asked about.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: drive_summary, location_summary, route_segment."`

	// K is the requested top-k count. Optional; defaults to
	// nlDriveSearchDefaultK when zero. Bounded to
	// [0, nlDriveSearchMaxK].
	K int `json:"k,omitempty" validate:"gte=0,lte=16" desc:"Top-k count to return; default 5 when omitted, max 16."`
}

// retrievedDriveChunk is the shared envelope for one chunk in the
// retrieve_drive_chunks output. Mirrors rag.Chunk but uses explicit
// JSON tags so the tool's output marshals stably regardless of any
// future change to the underlying rag.Chunk shape.
type retrievedDriveChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveDriveChunks is the read-only tool that calls the F7
// retriever for the drive domain. It is the FIRST tool the LLM is
// expected to call (per the strategy's system prompt).
//
// Execution: typed input → user_subject from ctx →
// rag.Retriever.Retrieve → JSON envelope. No DB write; no SQL
// written by this method.
type retrieveDriveChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveDriveChunks) Name() string { return "retrieve_drive_chunks" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the source-type
// allowlist appended so the model picks from the curated set.
func (t *retrieveDriveChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's drive history via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + nlDriveSearchAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate a drive to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveDriveChunks) InputSchema() json.RawMessage {
	return tools.CachedSchema(retrieveDriveChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *retrieveDriveChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *retrieveDriveChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream, and the retriever scopes by the
// calling user_subject so cross-tenant leakage is impossible).
func (t *retrieveDriveChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for slice fields.
func (t *retrieveDriveChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[retrieveDriveChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveDriveChunksInput)
	if err := assertAllowedDriveSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > nlDriveSearchMaxQueryChars {
		return nil, fmt.Errorf("retrieve_drive_chunks: query length %d exceeds cap %d",
			len(in.Query), nlDriveSearchMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool]. Resolves user_subject from the ctx the
// AI handler installed via provider.WithSubject, then calls the F7
// retriever. Returns a deterministic envelope with explicit JSON
// tags so the dispatcher's serialisation path is uniform across
// runs.
//
// A nil retriever is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests that
// instantiate the tool directly.
func (t *retrieveDriveChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveDriveChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_drive_chunks: no rag.Retriever wired")
	}

	k := input.K
	if k == 0 {
		k = nlDriveSearchDefaultK
	}

	subject := provider.SubjectFromContext(ctx)

	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_drive_chunks: rag.Retrieve: %w", err)
	}

	out := make([]retrievedDriveChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedDriveChunk{
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

// HydratedDriveReplay is the envelope returned by
// DriveReplayHydrator.HydrateOne. Mirrors HydratedResult but adds
// the ReplayURL field so the LLM can offer a one-click replay
// anchor in its narration without having to construct
// /drives/:id/replay by string-formatting (which would be brittle
// across SPA-route renames).
//
// Fields:
//
//   - SourceType: matches one of the allowed source-type strings
//     above.
//   - SourceID:   domain key the hydrator resolved (typically a
//     numeric ID rendered as a string for cross-source uniformity).
//   - Title:      one-line human-friendly title (e.g. "Drive #142
//     2025-01-04 14:32 → 15:18").
//   - Subtitle:   optional one-line context (route summary, total
//     energy, distance). May be empty.
//   - URL:        SPA route for the drive's detail page (e.g.
//     "/drives/142"). May be empty if the source type does not
//     have a dedicated detail page (location_summary,
//     route_segment).
//   - ReplayURL:  SPA route for the drive's replay scrubber (e.g.
//     "/drives/142/replay"). May be empty if no canonical replay
//     route exists for the source type — narrations should fall
//     back to URL in that case.
//   - When:       RFC3339 timestamp of the entity's primary
//     timestamp (drive start). May be empty if the source type
//     has no canonical timestamp.
type HydratedDriveReplay struct {
	SourceType string `json:"source_type"`
	SourceID   string `json:"source_id"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle,omitempty"`
	URL        string `json:"url,omitempty"`
	ReplayURL  string `json:"replay_url,omitempty"`
	When       string `json:"when,omitempty"`
}

// DriveReplayHydrator is the narrow read interface the
// hydrate_drive_replay tool needs. In production it is satisfied at
// boot by an adapter (see internal/api/ai_drive_search_hydrator.go)
// that delegates per-source-type lookups to the existing canonical
// Drive read handler. Tests substitute a deterministic fake.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the propose-only contract that ADR-015 §I3 + the
// slice prompt mandate.
type DriveReplayHydrator interface {
	// HydrateOne resolves a (sourceType, sourceID) reference into
	// a human-friendly HydratedDriveReplay. The userSubject
	// parameter scopes the lookup to the requesting principal so
	// a confused LLM that asks for someone else's drive ID gets
	// a structured "not found" rather than a cross-tenant leak.
	//
	// Returns ErrDriveReplayHydratorNotFound when no entity
	// matches the (subject, type, id) tuple. Other errors are
	// propagated as-is so the dispatcher can emit a tool-error
	// frame.
	HydrateOne(ctx context.Context, userSubject, sourceType, sourceID string) (*HydratedDriveReplay, error)
}

// ErrDriveReplayHydratorNotFound is the sentinel error a
// DriveReplayHydrator returns when the (subject, type, id) tuple
// does not resolve to an entity. hydrate_drive_replay surfaces this
// as a structured envelope with status="not_found" rather than a
// tool error so the LLM can adapt its narration without retrying.
var ErrDriveReplayHydratorNotFound = errors.New("tools: drive_replay_hydrator: source_id not found for subject")

// hydrateDriveReplayInput is the typed input shape for
// hydrate_drive_replay. The dispatcher decodes the LLM's tool-call
// arguments JSON into this struct via ValidateStruct so a malformed
// input fails before any DriveReplayHydrator method runs.
type hydrateDriveReplayInput struct {
	// SourceType identifies which corpus the source_id belongs
	// to. Required + must match the per-feature allowlist.
	SourceType string `json:"source_type" validate:"required" desc:"Source type to hydrate; allowed values: drive_summary, location_summary, route_segment."`

	// SourceID is the domain key (typically a numeric drive ID
	// rendered as a string). Required + non-empty.
	SourceID string `json:"source_id" validate:"required" desc:"Domain identifier of the drive entity."`
}

// hydratedDriveReplayOutput is the wire envelope for one
// hydrate_drive_replay call.
//
//	Status == "ok"        ⇒ Result populated.
//	Status == "not_found" ⇒ Result is nil; LLM should tell the
//	                         user the cited drive no longer exists.
//	Status == "error"     ⇒ Error populated; the dispatcher will
//	                         relay this to the LLM as a tool error.
type hydratedDriveReplayOutput struct {
	Status string               `json:"status"`
	Result *HydratedDriveReplay `json:"result,omitempty"`
	Error  string               `json:"error,omitempty"`
}

// hydrateDriveReplay is the read-only tool that resolves a chunk
// reference into a human-friendly envelope including the replay
// URL. It is the follow-up tool the LLM calls after
// retrieve_drive_chunks per the strategy's system prompt.
type hydrateDriveReplay struct {
	h DriveReplayHydrator
}

// Name implements [Tool].
func (t *hydrateDriveReplay) Name() string { return "hydrate_drive_replay" }

// Description implements [Tool].
func (t *hydrateDriveReplay) Description() string {
	return "Resolve a chunk reference (source_type + source_id from retrieve_drive_chunks) into a human-friendly envelope: {title, subtitle, url, replay_url, when}. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + nlDriveSearchAllowedSourceTypesHint + ". " +
		"Use this AFTER retrieve_drive_chunks to cite a drive by its hydrated title AND surface the replay anchor (/drives/:id/replay) in your narration; do NOT paste raw chunk text. " +
		"Returns {status: ok|not_found|error, result, error}."
}

// InputSchema implements [Tool].
func (t *hydrateDriveReplay) InputSchema() json.RawMessage {
	return tools.CachedSchema(hydrateDriveReplayInput{})
}

// OutputSchema implements [Tool].
func (t *hydrateDriveReplay) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *hydrateDriveReplay) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// retrieve_drive_chunks.
func (t *hydrateDriveReplay) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist.
func (t *hydrateDriveReplay) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[hydrateDriveReplayInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(hydrateDriveReplayInput)
	if _, ok := nlDriveSearchAllowedSourceTypeSet[in.SourceType]; !ok {
		return nil, fmt.Errorf("hydrate_drive_replay: source_type %q not in allowed set %s",
			in.SourceType, nlDriveSearchAllowedSourceTypesHint)
	}
	if strings.TrimSpace(in.SourceID) == "" {
		return nil, errors.New("hydrate_drive_replay: source_id must be non-empty after trim")
	}
	return in, nil
}

// Execute implements [Tool]. Calls DriveReplayHydrator.HydrateOne
// with the user_subject from ctx. ErrDriveReplayHydratorNotFound is
// surfaced as a status="not_found" envelope (not a returned error)
// so the LLM can adapt its narration; any other error is propagated
// as a returned error and the dispatcher will emit a tool-error
// frame.
func (t *hydrateDriveReplay) Execute(ctx context.Context, in any) (any, error) {
	input := in.(hydrateDriveReplayInput)
	if t.h == nil {
		return nil, errors.New("hydrate_drive_replay: no DriveReplayHydrator wired")
	}

	subject := provider.SubjectFromContext(ctx)
	res, err := t.h.HydrateOne(ctx, subject, input.SourceType, input.SourceID)
	if err != nil {
		if errors.Is(err, ErrDriveReplayHydratorNotFound) {
			return &hydratedDriveReplayOutput{Status: "not_found"}, nil
		}
		return nil, fmt.Errorf("hydrate_drive_replay: hydrator: %w", err)
	}
	if res == nil {
		return &hydratedDriveReplayOutput{Status: "not_found"}, nil
	}
	return &hydratedDriveReplayOutput{Status: "ok", Result: res}, nil
}

// DriveSearchSources bundles the narrow read interfaces
// RegisterDriveSearchTools needs. Mirrors [SearchSources] /
// [DigestSources] / etc. but exposes only the surface the
// nl-drive-search-replay tools actually consume.
//
// Production wiring (router.go) instantiates a real rag.Retriever +
// a DriveReplayHydrator adapter that delegates per-source-type
// lookups to the existing canonical drive read paths; tests
// substitute deterministic fakes per-source.
type DriveSearchSources struct {
	Retriever rag.Retriever
	Hydrator  DriveReplayHydrator
}

// RegisterDriveSearchTools installs the nl-drive-search-replay
// slice's tools on r. Called from router.go AFTER RegisterHelpTools
// so the registry's alphabetical Names list grows deterministically
// without disturbing earlier registrations or the BuiltinNames pin
// test.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterDriveSearchTools(r *tools.Registry, s DriveSearchSources) {
	r.Register(&retrieveDriveChunks{r: s.Retriever})
	r.Register(&hydrateDriveReplay{h: s.Hydrator})
}

// assertAllowedDriveSourceTypes enforces the per-feature source-type
// allowlist. Returns a deterministic error listing the offending
// entry plus the allowed set so the LLM's tool-error reply contains
// enough context to retry with a corrected payload.
func assertAllowedDriveSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_drive_chunks: source_types is required and must contain at least one entry")
	}
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := nlDriveSearchAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_drive_chunks: source_type %q not in allowed set %s",
				st, nlDriveSearchAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_drive_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedDriveSearchSourceTypes returns a defensive copy of the
// per-feature source-type allowlist. Exported so the AI handler +
// tests can reference the same set the tools enforce.
func AllowedDriveSearchSourceTypes() []string {
	out := make([]string, len(nlDriveSearchAllowedSourceTypes))
	copy(out, nlDriveSearchAllowedSourceTypes)
	sort.Strings(out)
	return out
}
