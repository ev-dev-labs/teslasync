package aialert

// Phase-50 / 0015 — N1 natural-language alert builder.
//
// This read-only AI route drafts alert rules through propose-only tools; the
// existing POST /api/v1/alerts/rules path remains the only persistence path.
// guard.Wrap("nl-alert-builder", …) keeps the surface hidden when AI is off
// (ADR-015 §I3, §I6).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	nlalertbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-alert-builder"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	apialerts "github.com/ev-dev-labs/teslasync/internal/api/alerts"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// builderMaxIterations allows draft/validate plus a small retry budget without
// falling back to the dispatcher's broader default.
const builderMaxIterations = 6

// builderMaxPromptChars allows multi-sentence rule descriptions while capping
// token-cost amplification from accidental or hostile paste payloads.
const builderMaxPromptChars = 4096

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Handler is the HTTP handler for
// POST /api/v1/ai/alerts/rules/draft.
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
//	draft_alert_rule + validate_alert_rule (registered by
//	alert.RegisterAlertBuilderTools in router.go).
//
// strat:      the nl-alert-builder Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aialert: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aialert: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aialert: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   builderMaxIterations,
	}
}

// builderRequest is the wire shape for
// POST /api/v1/ai/alerts/rules/draft.
//
// VehicleID is required and must be > 0 — the AI handler scopes the
// drafting to a single vehicle. Prompt is the user's plain-language
// description of the rule they want, capped at
// builderMaxPromptChars.
type builderRequest struct {
	VehicleID int64  `json:"vehicle_id"`
	Prompt    string `json:"prompt"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body builderRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > builderMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", builderMaxPromptChars))
		return
	}

	// Resolve before opening SSE so provider failures remain plain JSON 502s.
	if _, err := h.registry.For(r.Context(), nlalertbuilder.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai alert builder: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Empty subject is the open-mode audit value ("anonymous").
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nlalertbuilder.FeatureID)

	// Pass the stream's child context into dispatch so client stalls cancel upstream work.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nlalertbuilder.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai alert builder: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Resolve again after annotations so decorators see subject and feature ID.
	prov, err := h.registry.For(ctx, nlalertbuilder.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai alert builder: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny confirmations defensively; this surface should only ever propose drafts.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Keep the tool order deterministic so every draft is validated before narration.
	userMsg := fmt.Sprintf(
		"Draft an AlertRule for vehicle %d. The user describes the rule as follows: %q. "+
			"Call draft_alert_rule first with vehicle_id=%d, then call validate_alert_rule on the proposed draft, "+
			"then write a one-sentence rationale describing the threshold, signal, severity, and trigger mode. "+
			"Do NOT save the rule yourself; the user reviews and saves through the UI.",
		body.VehicleID, prompt, body.VehicleID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		// Errors are also surfaced on the SSE wire by the
		// dispatcher's terminal frame (WriteError or
		// EmitLimitError on the underlying writer); we just log.
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Int("prompt_chars", len(prompt)).
			Msg("ai alert builder: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// RuleValidator is the production implementation of
// alert.AlertRuleValidator. It delegates to the canonical validation
// function exported by the non-AI alerts subpackage so the AI tool
// registration path uses the same validation as the typed handler.
//
// One per process; stateless.
type RuleValidator struct{}

// NewRuleValidator returns a ready-to-use validator wrapper.
// Exists as a constructor (rather than a value) so a future change
// that adds wiring (e.g. a custom signal allowlist) does not force
// every call site to update.
func NewRuleValidator() *RuleValidator { return &RuleValidator{} }

// ValidateAlertRule implements [alert.AlertRuleValidator]. Delegates
// to the canonical alerts validation path — same code path the
// POST /api/v1/alerts/rules handler runs, so a draft accepted here
// is byte-equivalent to a draft accepted by the canonical handler.
func (v *RuleValidator) ValidateAlertRule(rule *alertmodel.AlertRule) error {
	return apialerts.ValidateAlertRule(rule)
}
