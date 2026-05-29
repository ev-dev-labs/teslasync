package aiincident

// Phase-50 / 0042 — S1 Incident timeline summarizer.
//
// This LLM-backed one-shot SSE handler adds POST
// /api/v1/ai/system/incidents/{incidentID}/summarize without changing the
// deterministic incident page. The URL incidentID is bound into context before
// tools run, so prompt-injected alternate incident IDs are rejected by the tool
// scope check.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	incidenttimelinesummarizer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/incident-timeline-summarizer"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/summary"
	apihttpx "github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_incident_timeline →
// (optional) retrieve_system_chunks → answer (with optional retries).
// A hard ceiling of 8 is generous, matching the other narrator
// handlers.
const maxIterations = 8

// Handler is the HTTP handler for
// POST /api/v1/ai/system/incidents/{incidentID}/summarize.
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

// NewHandler constructs the handler.
// All non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_incident_timeline AND retrieve_system_chunks
//	(registered by summary.RegisterIncidentTimelineSummarizerTools
//	in router.go).
//
// strat:      the incident-timeline-summarizer Strategy (one per
//
//	process).
//
// headerName: forward-auth header name; used to extract subject for
//
//	audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("api/aiincident: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api/aiincident: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("api/aiincident: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseRequest extracts the URL incidentID
// and (optionally) drains an empty JSON body. Pulled out so the
// validator-only test can exercise the same parsing without
// constructing a full handler with stub deps. Writes a 400 on
// failure and returns the (incidentID, ok) pair so the caller can
// early-return.
//
// The body is optional. The SPA sends {} for a body — accept that,
// but also accept an empty body, EOF, or "null" so legacy clients
// don't break. DisallowUnknownFields is off because the handler has
// nothing meaningful to do with body fields (the incidentID is in
// the URL path, not the body).
func parseRequest(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "incidentID")
	if raw == "" {
		writeError(w, http.StatusBadRequest, "incidentID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("incidentID must be a positive integer, got %q", raw))
		return 0, false
	}
	if r.Body != nil {
		defer r.Body.Close()
		// Accept the SPA's "{}" body, empty body, or null for compatibility.
		bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, 16*1024))
		if readErr != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
			return 0, false
		}
		trimmed := strings.TrimSpace(string(bodyBytes))
		if trimmed != "" && trimmed != "null" {
			var probe map[string]any
			if err := json.Unmarshal(bodyBytes, &probe); err != nil {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
				return 0, false
			}
		}
	}
	return id, true
}

// ServeHTTP implements [http.Handler]. The URL is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	incidentID, ok := parseRequest(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider failures remain JSON errors.
	if _, err := h.registry.For(r.Context(), incidenttimelinesummarizer.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai incident-timeline-summarizer: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Bind the incident scope before any tool can run.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, incidenttimelinesummarizer.FeatureID)
	ctx = summary.WithScopedIncidentID(ctx, incidentID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(incidenttimelinesummarizer.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai incident-timeline-summarizer: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, incidenttimelinesummarizer.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai incident-timeline-summarizer: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Non-conversational by design: force the scoped incident tool sequence.
	userMsg := fmt.Sprintf(
		"Summarize the timeline of incident %d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_incident_timeline with incident_id=%d to fetch the deterministic envelope "+
			"(id, title, description, severity, status, source, affected_components, started_at, "+
			"resolved_at, total_updates, and the chronological updates list with at/status/message/author). "+
			"(2) OPTIONALLY call retrieve_system_chunks with the incident's title or salient phrases as "+
			"the query, restricted to allowed source_types (system_event, audit_log) if you need additional "+
			"per-event context — answer gracefully when zero chunks are returned. "+
			"Produce a 3-6 sentence factual summary grounded strictly in the tool reply. "+
			"Name severity, status (current and final), opening time (and resolution time if applicable), "+
			"the count of timeline updates, and the most material status transitions. "+
			"Remember: you NEVER invent updates, never claim a status transition the timeline does not "+
			"record, never invent an author or timestamp, and never speculate about root cause beyond what "+
			"the messages explicitly state. "+
			"If total_updates is 1 or the incident is too sparse to support a meaningful narrative, say so "+
			"plainly rather than padding the summary with speculation. "+
			"Refuse politely if asked to summarize a different incident than %d.",
		incidentID, incidentID, incidentID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("incident_id", incidentID).
			Msg("ai incident-timeline-summarizer: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)

func writeError(w http.ResponseWriter, status int, msg string) {
	apihttpx.WriteError(w, status, msg)
}

// denyAllConfirm rejects every mutating tool as defence-in-depth.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// IncidentTimelineSource is the production
// summary.IncidentTimelineSource. It delegates to the SHARED
// dbobs.IncidentRepo.Get path that also backs the canonical
// baseline GET /api/v1/status/incidents/{id} handler so the AI
// summary is grounded in the SAME deterministic envelope the
// /system-status/incidents/:id page renders. No new SQL is added by
// this slice.
//
// The struct holds a *dbobs.IncidentRepo; the constructor panics
// on a nil so a wiring bug surfaces at boot.
type IncidentTimelineSource struct {
	repo *dbobs.IncidentRepo
}

// NewIncidentTimelineSource constructs the adapter. Panics on a
// nil *dbobs.IncidentRepo so a wiring mistake surfaces at boot
// rather than as a nil-deref on first AI request.
func NewIncidentTimelineSource(repo *dbobs.IncidentRepo) *IncidentTimelineSource {
	if repo == nil {
		panic("api/aiincident: NewIncidentTimelineSource: nil *dbobs.IncidentRepo")
	}
	return &IncidentTimelineSource{repo: repo}
}

// IncidentTimeline implements summary.IncidentTimelineSource. Composes
// the SAME dbobs.IncidentRepo.Get path
// IncidentsHandler.GetIncident uses so the returned envelope is
// identical to what GET /api/v1/status/incidents/{id} produces — the
// AI surface is grounded in the SAME deterministic model the
// IncidentTimelinePage renders.
//
// The function does NOT recompute or override anything the canonical
// repo computes; it only reshapes the existing typed
// dbobs.Incident into the typed [summary.IncidentTimelineEnvelope]
// the LLM can quote. Timestamps are stringified to RFC3339 UTC for
// determinism; the operator-installed wall-clock is preserved without
// timezone-conversion guesswork.
func (a *IncidentTimelineSource) IncidentTimeline(ctx context.Context, incidentID int64) (*summary.IncidentTimelineEnvelope, error) {
	if incidentID <= 0 {
		return nil, errors.New("api/aiincident: incident_id must be > 0")
	}

	inc, err := a.repo.Get(ctx, incidentID)
	if err != nil {
		return nil, fmt.Errorf("api/aiincident: IncidentRepo.Get: %w", err)
	}

	updates := make([]summary.IncidentTimelineUpdate, 0, len(inc.Updates))
	for _, u := range inc.Updates {
		updates = append(updates, summary.IncidentTimelineUpdate{
			At:      summary.FormatIncidentTimestamp(u.At),
			Status:  u.Status,
			Message: u.Message,
			Author:  u.Author,
		})
	}

	var resolvedAt *string
	if inc.ResolvedAt != nil {
		s := summary.FormatIncidentTimestamp(*inc.ResolvedAt)
		resolvedAt = &s
	}

	// Defensive: ensure AffectedComponents is non-nil even when the
	// row stored a NULL — the LLM should see [] (and the JSON tag
	// therefore renders []) rather than null which can confuse some
	// tool parsers.
	components := inc.AffectedComponents
	if components == nil {
		components = []string{}
	}

	return &summary.IncidentTimelineEnvelope{
		ID:                 inc.ID,
		Title:              inc.Title,
		Description:        inc.Description,
		Severity:           inc.Severity,
		Status:             inc.Status,
		Source:             inc.Source,
		AffectedComponents: components,
		StartedAt:          summary.FormatIncidentTimestamp(inc.StartedAt),
		ResolvedAt:         resolvedAt,
		TotalUpdates:       len(inc.Updates),
		Updates:            updates,
	}, nil
}

var _ summary.IncidentTimelineSource = (*IncidentTimelineSource)(nil)
