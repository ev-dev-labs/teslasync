package api

// Phase-50 / 0016 — N2 Natural-language automation builder.
//
// ai_automation_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/automations/draft. The flow mirrors the
// nl-alert-builder handler from slice 0015 — same dispatch+stream
// loop, same propose-only contract, no persistence (one-shot
// drafting; no conversation to record):
//
//   request JSON {vehicle_id, prompt}
//     ↓
//   resolve provider via *provider.Registry.For("nl-automation-builder")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("nl-automation-builder", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// PROPOSE-ONLY contract (slice prompt + ADR-015 §I3):
//
//   - Both tools the strategy declares (draft_automation_graph,
//     validate_automation_graph) are pure-functional DTO transforms
//     that do NOT touch the database.
//   - The actual save flows through the existing typed
//     POST /api/v1/automations handler AFTER the user explicitly
//     clicks Save in the AutomationBuilderPage UI.
//   - The deterministic AutomationBuilderPage form +
//     decodeAutomationInputDTO validator at
//     `internal/api/automation_handler_decode.go` remain the
//     canonical baseline for any user with `ai_mode='off'`. The
//     save path is unchanged.
//
// ADR-015 alignment:
//
//   - I1 default-off:    the feature toggle defaults false in
//                         features.Registry; the guard fails closed.
//   - I3 baseline intact: this handler never replaces the typed
//                         AutomationHandler.Create path or the
//                         AutomationBuilderPage manual form.
//   - I7 per-feature:     the AI route is gated by
//                         guard.Wrap("nl-automation-builder").
//   - I9 redaction:       PolicyAutomationBuilder (deny-all) is
//                         installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//                         /api/v1/ai/*; no field on the existing
//                         baseline JSON shape is added or modified
//                         by this slice.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	nlautomationbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-automation-builder"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiAutomationBuilderMaxIterations bounds the dispatcher's tool-loop.
// The nl-automation-builder strategy is a two-tool sequence (draft,
// then validate), with at most one retry if validate rejects the
// first draft — a hard ceiling of 6 is generous for an LLM that
// occasionally re-drafts twice before settling. Mirrors
// aiAlertBuilderMaxIterations from slice 0015.
const aiAutomationBuilderMaxIterations = 6

// aiAutomationBuilderMaxPromptChars bounds the user-supplied
// natural-language prompt at the HTTP boundary. Generous for a
// multi-sentence rule description; defensive against an enormous
// payload that would inflate the LLM's context window cost without
// any plausible legitimate use.
const aiAutomationBuilderMaxPromptChars = 4096

// AIAutomationHandler is the HTTP handler for
// POST /api/v1/ai/automations/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIAutomationHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIAutomationHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_automation_graph + validate_automation_graph
//	(registered by automationtool.RegisterAutomationBuilderTools in router.go).
//
// strat:      the nl-automation-builder Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIAutomationHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIAutomationHandler {
	switch {
	case registry == nil:
		panic("api: NewAIAutomationHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIAutomationHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIAutomationHandler: nil strategy.Strategy")
	}
	return &AIAutomationHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiAutomationBuilderMaxIterations,
	}
}

// aiAutomationBuilderRequest is the wire shape for
// POST /api/v1/ai/automations/draft.
//
// VehicleID is required and must be > 0 — the AI handler scopes the
// drafting to a single vehicle. Prompt is the user's plain-language
// description of the automation they want, capped at
// aiAutomationBuilderMaxPromptChars.
type aiAutomationBuilderRequest struct {
	VehicleID int64  `json:"vehicle_id"`
	Prompt    string `json:"prompt"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIAutomationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiAutomationBuilderRequest
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
	if len(prompt) > aiAutomationBuilderMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", aiAutomationBuilderMaxPromptChars))
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), nlautomationbuilder.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai automation builder: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nlautomationbuilder.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nlautomationbuilder.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai automation builder: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, nlautomationbuilder.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai automation builder: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// nl-automation-builder strategy declares only PROPOSE-only
	// tools (draft_automation_graph, validate_automation_graph) —
	// neither writes any state. The confirm hook is wired anyway as
	// defence-in-depth: if a future edit accidentally adds a
	// mutating tool, the dispatcher will REJECT it instead of
	// silently mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. We hand the LLM:
	//    - the caller's vehicle ID (so the typed clamp in the
	//      tool's wire-payload builder sees the correct scope);
	//    - the verbatim user prompt;
	//    - the deterministic call sequence directive so the model
	//      always exercises both tools in the canonical order.
	// The strategy's system prompt does the rest of the framing
	// (refuse cross-vehicle, propose-only, no SQL, etc.).
	userMsg := fmt.Sprintf(
		"Draft an Automation for vehicle %d. The user describes the automation as follows: %q. "+
			"Call draft_automation_graph first with vehicle_id=%d, then call validate_automation_graph "+
			"on the proposed draft, then write a one-sentence rationale describing the trigger, "+
			"conditions (if any), and actions. Do NOT save the automation yourself; the user reviews "+
			"and saves through the UI.",
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
			Msg("ai automation builder: dispatcher returned error")
	}
}

// Compile-time assertion: AIAutomationHandler satisfies http.Handler.
var _ http.Handler = (*AIAutomationHandler)(nil)

// AIAutomationGraphValidator is the production implementation of
// automationtool.AutomationGraphValidator. It is a thin wrapper around the
// unexported decodeAutomationInputDTO function in
// automation_handler_decode.go, kept in this file so the AI tool
// registration path can wire the canonical validator without
// exposing the unexported function to the rest of the codebase.
//
// One per process; stateless.
type AIAutomationGraphValidator struct{}

// NewAIAutomationGraphValidator returns a ready-to-use validator
// wrapper. Exists as a constructor (rather than a value) so a future
// change that adds wiring (e.g. a custom signal allowlist) does not
// force every call site to update.
func NewAIAutomationGraphValidator() *AIAutomationGraphValidator {
	return &AIAutomationGraphValidator{}
}

// ValidateAutomationWire implements [automationtool.AutomationGraphValidator].
// Delegates to the canonical decodeAutomationInputDTO function — same
// code path the POST /api/v1/automations handler runs, so a draft
// accepted here is byte-equivalent to a draft accepted by the
// canonical handler.
func (v *AIAutomationGraphValidator) ValidateAutomationWire(wireJSON json.RawMessage) error {
	if len(wireJSON) == 0 {
		return fmt.Errorf("empty wire payload")
	}
	if _, err := decodeAutomationInputDTO(bytes.NewReader(wireJSON)); err != nil {
		return err
	}
	return nil
}
