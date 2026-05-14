package api

// Phase-50 / 0015 — N1 Natural-language alert builder.
//
// ai_alert_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/alerts/rules/draft. The flow mirrors the
// digest / yir / anomaly narration handlers — same dispatch+stream
// loop, no persistence (one-shot drafting; no conversation to
// record):
//
//   request JSON {vehicle_id, prompt}
//     ↓
//   resolve provider via *provider.Registry.For("nl-alert-builder")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("nl-alert-builder", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// PROPOSE-ONLY contract (slice prompt + ADR-015 §I3):
//
//   - Both tools the strategy declares (draft_alert_rule,
//     validate_alert_rule) are pure-functional DTO transforms that
//     do NOT touch the database.
//   - The actual save flows through the existing typed
//     POST /api/v1/alerts/rules handler AFTER the user explicitly
//     clicks Save in the AlertStudioPage UI.
//   - The deterministic AlertStudioPage form +
//     validateAlertRule validator at
//     `internal/api/alert_handler_rules.go` remain the canonical
//     baseline for any user with `ai_mode='off'`. The save path
//     is unchanged.
//
// ADR-015 alignment:
//
//   - I1 default-off:    the feature toggle defaults false in
//                         features.Registry; the guard fails closed.
//   - I3 baseline intact: this handler never replaces the typed
//                         AlertHandler.CreateAlertRule path or the
//                         AlertStudioPage manual form.
//   - I7 per-feature:     the AI route is gated by
//                         guard.Wrap("nl-alert-builder").
//   - I9 redaction:       PolicyAlertBuilder (deny-all) is installed
//                         by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//                         /api/v1/ai/*; no field on the existing
//                         baseline JSON shape is added or modified
//                         by this slice.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	nlalertbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-alert-builder"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// aiAlertBuilderMaxIterations bounds the dispatcher's tool-loop. The
// nl-alert-builder strategy is a two-tool sequence (draft, then
// validate), with at most one retry if validate rejects the first
// draft — a hard ceiling of 6 is generous for an LLM that
// occasionally re-drafts twice before settling. Mirrors
// aiAnomalyMaxIterations from slice 0014 in spirit (small,
// per-feature cap rather than the dispatcher's DefaultMaxIterations).
const aiAlertBuilderMaxIterations = 6

// aiAlertBuilderMaxPromptChars bounds the user-supplied
// natural-language prompt at the HTTP boundary. Generous for a
// multi-sentence rule description; defensive against an enormous
// payload that would inflate the LLM's context window cost without
// any plausible legitimate use.
const aiAlertBuilderMaxPromptChars = 4096

// AIAlertHandler is the HTTP handler for
// POST /api/v1/ai/alerts/rules/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIAlertHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIAlertHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//             draft_alert_rule + validate_alert_rule (registered by
//             tools.RegisterAlertBuilderTools in router.go).
// strat:      the nl-alert-builder Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIAlertHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIAlertHandler {
	switch {
	case registry == nil:
		panic("api: NewAIAlertHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIAlertHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIAlertHandler: nil strategy.Strategy")
	}
	return &AIAlertHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiAlertBuilderMaxIterations,
	}
}

// aiAlertBuilderRequest is the wire shape for
// POST /api/v1/ai/alerts/rules/draft.
//
// VehicleID is required and must be > 0 — the AI handler scopes the
// drafting to a single vehicle. Prompt is the user's plain-language
// description of the rule they want, capped at
// aiAlertBuilderMaxPromptChars.
type aiAlertBuilderRequest struct {
	VehicleID int64  `json:"vehicle_id"`
	Prompt    string `json:"prompt"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIAlertHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiAlertBuilderRequest
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
	if len(prompt) > aiAlertBuilderMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", aiAlertBuilderMaxPromptChars))
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), nlalertbuilder.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai alert builder: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nlalertbuilder.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nlalertbuilder.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai alert builder: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, nlalertbuilder.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai alert builder: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// nl-alert-builder strategy declares only PROPOSE-only tools
	// (draft_alert_rule, validate_alert_rule) — neither writes any
	// state. The confirm hook is wired anyway as defence-in-depth:
	// if a future edit accidentally adds a mutating tool, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. We hand the LLM:
	//    - the caller's vehicle ID (so the typed clamp in
	//      buildDraftRule sees the correct scope);
	//    - the verbatim user prompt;
	//    - the deterministic call sequence directive so the model
	//      always exercises both tools in the canonical order.
	// The strategy's system prompt does the rest of the framing
	// (refuse cross-vehicle, propose-only, no SQL, etc.).
	userMsg := fmt.Sprintf(
		"Draft an AlertRule for vehicle %d. The user describes the rule as follows: %q. "+
			"Call draft_alert_rule first with vehicle_id=%d, then call validate_alert_rule on the proposed draft, "+
			"then write a one-sentence rationale describing the threshold, signal, severity, and trigger mode. "+
			"Do NOT save the rule yourself; the user reviews and saves through the UI.",
		body.VehicleID, prompt, body.VehicleID,
	)

	// 8) Run the dispatcher. The deferred WriteDone in dispatch.Run
	// closes the SSE stream cleanly on any path.
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

// Compile-time assertion: AIAlertHandler satisfies http.Handler.
var _ http.Handler = (*AIAlertHandler)(nil)

// AIAlertRuleValidator is the production implementation of
// tools.AlertRuleValidator. It is a thin wrapper around the
// unexported validateAlertRule function in alert_handler_rules.go,
// kept in this file so the AI tool registration path can wire the
// canonical validator without exposing the unexported function to
// the rest of the codebase.
//
// One per process; stateless.
type AIAlertRuleValidator struct{}

// NewAIAlertRuleValidator returns a ready-to-use validator wrapper.
// Exists as a constructor (rather than a value) so a future change
// that adds wiring (e.g. a custom signal allowlist) does not force
// every call site to update.
func NewAIAlertRuleValidator() *AIAlertRuleValidator { return &AIAlertRuleValidator{} }

// ValidateAlertRule implements [tools.AlertRuleValidator]. Delegates
// to the canonical validateAlertRule function — same code path the
// POST /api/v1/alerts/rules handler runs, so a draft accepted here
// is byte-equivalent to a draft accepted by the canonical handler.
func (v *AIAlertRuleValidator) ValidateAlertRule(rule *models.AlertRule) error {
	return validateAlertRule(rule)
}
