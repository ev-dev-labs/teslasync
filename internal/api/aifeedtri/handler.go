package aifeedtri

// Phase-50 / 0046 — S5 Feedback queue triage.
//
// LLM-backed POST /api/v1/ai/feedback/triage/draft. The guard in ai_routes.go
// fails closed before this handler when AI mode or the feature toggle is off
// (ADR-015 §I6).
//
// The request-scoped feedback_id is installed in context before dispatcher.Run;
// tools reject any LLM-supplied ID that does not match it. The surface is
// opt-in and propose-only, leaving the baseline manual triage PATCH contract
// unchanged (ADR-015 §I3, §I9-I10).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	feedbackqueuetriage "github.com/ev-dev-labs/teslasync/internal/ai/strategies/feedback-queue-triage"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/feedback"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
)

// aiFeedbackTriageMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most draft_feedback_triage → (optional)
// retrieve_feedback_chunks → (optional) validate_feedback_triage →
// answer (with optional retries on transient tool error). A hard
// ceiling of 8 is generous, matching the other narrator handlers.
const aiFeedbackTriageMaxIterations = 8

// aiFeedbackTriageMaxBodyBytes caps the request body. The body is
// trivial (1 numeric field); bound it cheaply. 16 KiB matches the
// other body-driven AI handlers.
const aiFeedbackTriageMaxBodyBytes = 16 * 1024

// aiFeedbackTriageBodyExcerptMaxChars caps the body excerpt the
// production source adapter forwards to the LLM. 4096 characters
// is generous for the longest plausible feedback narrative without
// blowing past the provider's prompt-token budget. The canonical
// validator caps Body at FeedbackBodyMaxBytes (16 KiB), so the
// excerpt is always a strict subset of the persisted column.
const aiFeedbackTriageBodyExcerptMaxChars = 4096

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// aiFeedbackTriageRequest is the typed body shape. feedback_id is
// the only required field.
type aiFeedbackTriageRequest struct {
	// FeedbackID is the user_feedback row to propose triage for.
	// Required + strictly positive.
	FeedbackID int64 `json:"feedback_id"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/feedback/triage/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     feedback.FeedbackTriageSource
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_feedback_triage AND validate_feedback_triage
//	AND retrieve_feedback_chunks (registered by
//	feedback.RegisterFeedbackQueueTriageTools in router.go).
//
// strat:      the feedback-queue-triage Strategy (one per process).
// source:     the production feedback.FeedbackTriageSource (a thin
//
//	wrapper around *dbuser.UserFeedbackRepo.Get that
//	PII-minimizes the row into a FeedbackTriageEntry).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source feedback.FeedbackTriageSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aifeedtri: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aifeedtri: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aifeedtri: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("aifeedtri: NewHandler: nil feedback.FeedbackTriageSource")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiFeedbackTriageMaxIterations,
	}
}

// parseFeedbackTriageRequest drains the body. feedback_id is the
// only required field. Absence or invalid value surface as JSON 400
// with a stable error key the SPA can localise. Returns (req, true)
// when the body is acceptable.
func parseFeedbackTriageRequest(w http.ResponseWriter, r *http.Request) (aiFeedbackTriageRequest, bool) {
	var req aiFeedbackTriageRequest
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiFeedbackTriageMaxBodyBytes))
	if readErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "empty body")
		return req, false
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if req.FeedbackID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "feedback_id must be > 0")
		return req, false
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	req, ok := parseFeedbackTriageRequest(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider failures stay plain JSON errors.
	if _, err := h.registry.For(r.Context(), feedbackqueuetriage.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai feedback-queue-triage: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Bind the in-scope feedback row before any tool can run.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, feedbackqueuetriage.FeatureID)
	ctx = feedback.WithScopedFeedback(ctx, feedback.ScopedFeedback{
		FeedbackID: req.FeedbackID,
	})

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(feedbackqueuetriage.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai feedback-queue-triage: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, feedbackqueuetriage.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai feedback-queue-triage: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirmation is defence in depth for this propose-only surface.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Feedback triage is NOT
	// conversational — there is no chat history. We hand the LLM a
	// deterministic prompt that scopes to the in-scope row and
	// instructs the tool sequence EXACTLY: draft_feedback_triage
	// first, then OPTIONALLY retrieve_feedback_chunks, then
	// OPTIONALLY validate_feedback_triage, then a 1-3 sentence
	// narration that mirrors the proposal.
	userMsg := synthesizeFeedbackTriageUserMessage(req.FeedbackID)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("feedback_id", req.FeedbackID).
			Msg("ai feedback-queue-triage: dispatcher returned error")
	}
}

// synthesizeFeedbackTriageUserMessage builds the deterministic
// per-request user message. Format is stable across boots so canned
// goldens and provider prompt-hash caches stay stable.
func synthesizeFeedbackTriageUserMessage(feedbackID int64) string {
	return fmt.Sprintf(
		"Propose a triage envelope for user_feedback row id=%d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call draft_feedback_triage with feedback_id=%d and your typed proposed_status (one of: new, triaged, closed), "+
			"proposed_category (one of: bug, feature, other), proposed_priority (one of: low, normal, high, critical), "+
			"and a 1-3 sentence rationale grounded strictly in the loaded row's title + body. "+
			"(2) OPTIONALLY call retrieve_feedback_chunks with the most salient phrase from the row's title or body as the query, "+
			"restricted to allowed source_types (feedback_item, audit_log) — answer gracefully when zero chunks are returned. "+
			"(3) OPTIONALLY call validate_feedback_triage with the same typed proposal to confirm the closed-enum check passes. "+
			"Produce a 2-4 sentence factual narration grounded strictly in the tool replies. "+
			"State the current status, the proposed status, the proposed category, the proposed priority, and the rationale. "+
			"Remember: you NEVER invent feedback content, never claim a triage status the closed enum does not allow, "+
			"and never speculate about root cause beyond what the row's title + body explicitly state. "+
			"If the row is missing (status='feedback_not_found'), say so plainly and refuse to invent a proposal. "+
			"Refuse politely if asked to triage a different feedback id than the in-scope id %d.",
		feedbackID, feedbackID, feedbackID,
	)
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/feedback_queue_triage.go. Kept in the same file
// as the handler so the wiring intent is local to the slice; mirrors
// the log-trace-summarization slice's AILogTraceWindowSource pattern.
// ---------------------------------------------------------------------

// FeedbackTriageSource is the production
// feedback.FeedbackTriageSource. It wraps the canonical
// *dbuser.UserFeedbackRepo.Get and PII-minimizes the row into a
// FeedbackTriageEntry: only id / created_at / category / title /
// body[truncated] / page_route / app_version / status /
// github_issue_url are forwarded to the LLM. user_email,
// submitter_subject, submitter_ip, recent_errors, and console_tail
// are NOT forwarded — defence in depth on top of
// PolicyAlertBuilder's deny-by-default redaction.
type FeedbackTriageSource struct {
	repo *dbuser.UserFeedbackRepo
}

// NewFeedbackTriageSource constructs the production source
// adapter. Panics on a nil repo so the wiring bug surfaces at boot,
// not at first request.
func NewFeedbackTriageSource(repo *dbuser.UserFeedbackRepo) *FeedbackTriageSource {
	if repo == nil {
		panic("aifeedtri: NewFeedbackTriageSource: nil *dbuser.UserFeedbackRepo")
	}
	return &FeedbackTriageSource{repo: repo}
}

// LoadFeedback implements feedback.FeedbackTriageSource. Returns
// (nil, nil) when the row does not exist (dbuser.ErrFeedbackNotFound) —
// the tool surfaces this as a "feedback_not_found" status so the
// LLM can narrate honestly without crashing the dispatcher. Any
// other error propagates back to the dispatcher.
//
// The body is truncated to aiFeedbackTriageBodyExcerptMaxChars to
// bound the prompt-token budget; the canonical body is preserved
// in the database column unchanged.
func (a *FeedbackTriageSource) LoadFeedback(ctx context.Context, feedbackID int64) (*feedback.FeedbackTriageEntry, error) {
	row, err := a.repo.Get(ctx, feedbackID)
	if err != nil {
		if errors.Is(err, dbuser.ErrFeedbackNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("api ai feedback-queue-triage: load feedback %d: %w", feedbackID, err)
	}
	body := row.Body
	if len(body) > aiFeedbackTriageBodyExcerptMaxChars {
		body = body[:aiFeedbackTriageBodyExcerptMaxChars] + "…"
	}
	return &feedback.FeedbackTriageEntry{
		ID:             row.ID,
		CreatedAt:      row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		Category:       row.Category,
		Title:          row.Title,
		Body:           body,
		PageRoute:      row.PageRoute,
		AppVersion:     row.AppVersion,
		Status:         row.Status,
		GitHubIssueURL: row.GitHubIssueURL,
	}, nil
}

// Compile-time assertion: FeedbackTriageSource satisfies
// feedback.FeedbackTriageSource.
var _ feedback.FeedbackTriageSource = (*FeedbackTriageSource)(nil)
