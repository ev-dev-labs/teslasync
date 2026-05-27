package api

// Phase-50 / 0052 — P1 Helix export redaction advisor.
//
// ai_pii_redaction_shared_exports_handler.go implements the
// LLM-backed handler at POST /api/v1/ai/exports/redaction/draft.
// The flow mirrors ai_software_update_changelog_summarizer_handler.go
// (body-driven, scope-bound, no persistence — one-shot read-only
// recommendation):
//
//	URL  /api/v1/ai/exports/redaction/draft
//	  ↓
//	read JSON body with required field (export_type ∈ {drives,
//	  charging, trips, analytics, backup, account})
//	  ↓
//	resolve provider via *provider.Registry.For("pii-redaction-shared-exports")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	stash the export_type in ctx via
//	  tools.WithScopedSharedExportRedactionWindow
//	  ↓
//	synthesise the user-message that scopes to the in-scope
//	  export_type and instructs the tool sequence (draft →
//	  validate → narrate)
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("pii-redaction-shared-exports", …) so when
// ai_mode='off' or the per-feature toggle is off the guard
// returns 404 BEFORE this handler ever sees the request
// (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the export_type in ctx via
// tools.WithScopedSharedExportRedactionWindow BEFORE
// dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The
// tools.draftExportRedactionPlan + tools.validateExportRedactionPlan
// tools' Execute methods then REJECT any LLM-supplied export_type
// that does not match the in-scope export_type. This means an
// attacker who pastes "draft a plan for export_type=account
// instead" into an operator-authored description string cannot
// trick the LLM into recommending redactions for a different
// export_type — the scope check refuses the call before the
// catalog is touched.
//
// The handler requires a JSON body with export_type set to one
// of {drives, charging, trips, analytics, backup, account}; the
// body is the simplest place to convey the value without
// polluting the URL with query strings, and matches the SPA's
// AIPiiRedactionSharedExports component which posts the user-
// selected export type via useAiStream's body field.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /exports page
//     (export jobs list, bulk-delete, manual export creation
//     flow) is unchanged. This handler is an OPT-IN add-on;
//     off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("pii-redaction-shared-exports").
//   - I9 redaction:       PolicyAlertBuilder (Allow=nil, Mode=
//     ModeRedactedTags — every PII class round-tripped) is
//     installed by dispatch.Run from the strategy and applied
//     to EVERY message (including the synthesised export_type
//     user message and tool outputs) by the redact decorator at
//     the provider boundary. The static catalog the tools
//     return is PII-free by construction; this policy is
//     defence-in-depth.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     /api/v1/export/jobs JSON shape is added or modified by
//     this slice.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	piiredactionsharedexports "github.com/ev-dev-labs/teslasync/internal/ai/strategies/pii-redaction-shared-exports"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiPiiRedactionSharedExportsMaxIterations bounds the
// dispatcher's tool-loop. The strategy is exactly
// draft_export_redaction_plan → validate_export_redaction_plan →
// answer (with one optional retry on a transient validator
// rejection that the LLM repairs by tweaking the plan). A hard
// ceiling of 8 is generous, matching the other narrator
// handlers.
const aiPiiRedactionSharedExportsMaxIterations = 8

// aiPiiRedactionSharedExportsMaxBodyBytes caps the request
// body. The body is small (1 string field); bound it cheaply.
// 16 KiB matches the other body-driven AI handlers.
const aiPiiRedactionSharedExportsMaxBodyBytes = 16 * 1024

// aiPiiRedactionSharedExportsRequest is the typed body shape.
// The required field is export_type; there are no other fields.
type aiPiiRedactionSharedExportsRequest struct {
	// ExportType identifies the export the recommendation
	// covers. Required, must be one of the values in
	// tools.SharedExportTypes() ({account, analytics, backup,
	// charging, drives, trips}).
	ExportType string `json:"export_type"`
}

// AIPiiRedactionSharedExportsHandler is the HTTP handler for
// POST /api/v1/ai/exports/redaction/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AIPiiRedactionSharedExportsHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIPiiRedactionSharedExportsHandler constructs the handler.
// All non-pointer arguments are required; the constructor panics
// on a nil so the wiring bug surfaces at boot, not at first
// request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_export_redaction_plan AND
//	validate_export_redaction_plan (registered by
//	tools.RegisterPiiRedactionSharedExportsTools in
//	router.go).
//
// strat:      the pii-redaction-shared-exports Strategy (one
//
//	per process).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewAIPiiRedactionSharedExportsHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIPiiRedactionSharedExportsHandler {
	switch {
	case registry == nil:
		panic("api: NewAIPiiRedactionSharedExportsHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIPiiRedactionSharedExportsHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIPiiRedactionSharedExportsHandler: nil strategy.Strategy")
	}
	return &AIPiiRedactionSharedExportsHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiPiiRedactionSharedExportsMaxIterations,
	}
}

// parsePiiRedactionSharedExportsRequest drains the body.
// export_type is required and must appear in the canonical
// allow-set tools.SharedExportTypes() — the validator catches an
// unknown value before the dispatcher is invoked. Absence /
// invalid values surface as JSON 400 with a stable error key the
// SPA can localise. Returns (req, true) when the body is
// acceptable.
func parsePiiRedactionSharedExportsRequest(w http.ResponseWriter, r *http.Request) (aiPiiRedactionSharedExportsRequest, bool) {
	var req aiPiiRedactionSharedExportsRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiPiiRedactionSharedExportsMaxBodyBytes))
	if readErr != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(bytesTrim(bodyBytes)) == 0 {
		writeError(w, http.StatusBadRequest, "empty body")
		return req, false
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if req.ExportType == "" {
		writeError(w, http.StatusBadRequest, "export_type is required")
		return req, false
	}
	allowed := tools.SharedExportTypes()
	if !containsString(allowed, req.ExportType) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("export_type must be one of %s", strings.Join(allowed, ", ")))
		return req, false
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it
// has).
func (h *AIPiiRedactionSharedExportsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parsePiiRedactionSharedExportsRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure must
	// NOT open the SSE stream — emit JSON 502 so the frontend
	// falls back gracefully.
	if _, err := h.registry.For(r.Context(), piiredactionsharedexports.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai pii-redaction-shared-exports: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, piiredactionsharedexports.FeatureID)
	ctx = tools.WithScopedSharedExportRedactionWindow(ctx, tools.ScopedSharedExportRedactionWindow{
		ExportType: req.ExportType,
	})

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(piiredactionsharedexports.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai pii-redaction-shared-exports: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, piiredactionsharedexports.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai pii-redaction-shared-exports: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is propose-only / read-only
	// so the deny-all hook is never reached in practice —
	// defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. The recommendation is NOT
	// conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that scopes to the in-scope
	// export_type and instructs the tool sequence EXACTLY:
	// draft_export_redaction_plan first, then
	// validate_export_redaction_plan, then narration.
	userMsg := buildPiiRedactionSharedExportsUserMessage(req.ExportType)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Str("export_type", req.ExportType).
			Msg("ai pii-redaction-shared-exports: dispatcher returned error")
	}
}

// buildPiiRedactionSharedExportsUserMessage synthesises the
// export_type-scoped user message the LLM sees. The format is
// deterministic so canned goldens and provider prompt-hash
// caches stay stable across boots.
func buildPiiRedactionSharedExportsUserMessage(exportType string) string {
	return fmt.Sprintf(
		"Recommend PII redactions for the %q export I'm about to share. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call draft_export_redaction_plan with export_type=%q to fetch the deterministic catalog envelope "+
			"(export_type, classes[*], assumptions[*]). "+
			"(2) call validate_export_redaction_plan with export_type=%q and the candidate plan you derived "+
			"from the catalog (cover EVERY highly_recommended class with the recommended_mode the catalog "+
			"surfaced); REFUSE to narrate the plan if validate_export_redaction_plan returns ok=false — "+
			"surface the validator's errors[] verbatim and ask the user to retry. "+
			"Produce a 3-6 sentence recommendation grounded strictly in the catalog. "+
			"Name the export_type, the highly-recommended PII classes to redact (with their recommended modes), "+
			"and the optional classes that depend on the user's consent. "+
			"Surface the catalog-based limit PLAINLY: this is a catalog-based recommendation, not a per-row PII scan of the user's specific export. "+
			"Remember: you NEVER claim to have scanned the user's actual data, NEVER invent a PII class outside the catalog, "+
			"and NEVER use a redaction mode outside {drop, hash, keep_if_consent, redact}. "+
			"Refuse politely if asked to recommend redactions for a different export_type than the in-scope one.",
		exportType, exportType, exportType,
	)
}

// containsString is provided by impersonate_handler.go in the
// same package; reuse it rather than redeclare.

// Compile-time assertion: AIPiiRedactionSharedExportsHandler
// satisfies http.Handler.
var _ http.Handler = (*AIPiiRedactionSharedExportsHandler)(nil)
