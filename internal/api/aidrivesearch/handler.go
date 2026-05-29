package aidrivesearch

// Natural-language drive search and replay handler.
//
// This AI route is read-only: it retrieves drive chunks, hydrates replay links,
// and streams narration without replacing the typed /drives and /drives/:id/replay
// surfaces. guard.Wrap("nl-drive-search-replay", …) hides it when AI is off
// (ADR-015 §I3, §I6).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	nldrivesearchreplay "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-drive-search-replay"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiDriveSearchMaxIterations allows retrieval plus a few replay hydrations while
// keeping the read-only tool loop bounded.
const aiDriveSearchMaxIterations = 6

// aiDriveSearchMaxPromptChars allows multi-sentence prompts while capping token
// cost from accidental or hostile paste payloads.
const aiDriveSearchMaxPromptChars = 4096

// Handler is the HTTP handler for
// POST /api/v1/ai/drives/search.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	retrieve_drive_chunks + hydrate_drive_replay
//	(registered by trip.RegisterDriveSearchTools in router.go).
//
// strat:      the nl-drive-search-replay Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aidrivesearch: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aidrivesearch: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aidrivesearch: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiDriveSearchMaxIterations,
	}
}

// aiDriveSearchRequest is the wire shape for
// POST /api/v1/ai/drives/search.
//
// Prompt is the user's plain-language drive search query, capped at
// aiDriveSearchMaxPromptChars. The request deliberately does NOT
// accept a vehicle_id — retrieval scopes by user_subject (the
// authenticated principal) and has no per-vehicle filter; adding a
// vehicle_id field would create a UI affordance we cannot enforce
// server-side (same rationale as nl-search).
type aiDriveSearchRequest struct {
	Prompt string `json:"prompt"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body aiDriveSearchRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		httpx.WriteError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > aiDriveSearchMaxPromptChars {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", aiDriveSearchMaxPromptChars))
		return
	}

	// Resolve before opening SSE so provider failures remain plain JSON 502s.
	if _, err := h.registry.For(r.Context(), nldrivesearchreplay.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai drive search: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nldrivesearchreplay.FeatureID)

	// Pass the stream's child context into dispatch so client stalls cancel upstream work.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nldrivesearchreplay.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai drive search: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Resolve again after annotations so decorators see subject and feature ID.
	prov, err := h.registry.For(ctx, nldrivesearchreplay.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai drive search: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny confirmations defensively; this surface should only ever read.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Keep the tool order deterministic so cited drives are hydrated before narration.
	userMsg := fmt.Sprintf(
		"Search the user's drive history for: %q. Call retrieve_drive_chunks first with the "+
			"appropriate source_types from {drive_summary, route_segment, location_summary}, then "+
			"call hydrate_drive_replay for each top hit you cite, then write a concise narration "+
			"that names the cited drives by their hydrated titles AND surfaces the replay anchor "+
			"(replay_url, which points at /drives/{id}/replay). If retrieve_drive_chunks returns "+
			"zero matches, say so plainly and suggest a rephrase or broader window — do NOT "+
			"fabricate a drive.",
		prompt,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int("prompt_chars", len(prompt)).
			Msg("ai drive search: dispatcher returned error")
	}
}

// denyAllConfirm is the dispatch confirm hook for this read-only AI surface.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)
