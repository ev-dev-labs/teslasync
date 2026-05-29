package aipiiredact

// This guarded, body-driven endpoint streams a one-shot redaction recommendation
// without persistence. The export_type is bound into context before dispatch so
// tools reject prompt-injected attempts to switch scope.
import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	piiredactionsharedexports "github.com/ev-dev-labs/teslasync/internal/ai/strategies/pii-redaction-shared-exports"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/export"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the
// dispatcher's tool-loop. The strategy is exactly
// draft_export_redaction_plan → validate_export_redaction_plan →
// answer (with one optional retry on a transient validator
// rejection that the LLM repairs by tweaking the plan). A hard
// ceiling of 8 is generous, matching the other narrator
// handlers.
const maxIterations = 8

// maxBodyBytes caps the request
// body. The body is small (1 string field); bound it cheaply.
// 16 KiB matches the other body-driven AI handlers.
const maxBodyBytes = 16 * 1024

// request is the typed body shape.
// The required field is export_type; there are no other fields.
type request struct {
	// ExportType identifies the export the recommendation
	// covers. Required, must be one of the values in
	// export.SharedExportTypes() ({account, analytics, backup,
	// charging, drives, trips}).
	ExportType string `json:"export_type"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/exports/redaction/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler.
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
//	export.RegisterPiiRedactionSharedExportsTools in
//	router.go).
//
// strat:      the pii-redaction-shared-exports Strategy (one
//
//	per process).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("api/aipiiredact: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api/aipiiredact: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("api/aipiiredact: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseRequest drains the body.
// export_type is required and must appear in the canonical
// allow-set export.SharedExportTypes() — the validator catches an
// unknown value before the dispatcher is invoked. Absence /
// invalid values surface as JSON 400 with a stable error key the
// SPA can localise. Returns (req, true) when the body is
// acceptable.
func parseRequest(w http.ResponseWriter, r *http.Request) (request, bool) {
	var req request
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if readErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(bytesTrim(bodyBytes)) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "empty body")
		return req, false
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if req.ExportType == "" {
		httpx.WriteError(w, http.StatusBadRequest, "export_type is required")
		return req, false
	}
	allowed := export.SharedExportTypes()
	if !slices.Contains(allowed, req.ExportType) {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("export_type must be one of %s", strings.Join(allowed, ", ")))
		return req, false
	}
	return req, true
}

// bytesTrim is a defensive ASCII whitespace trimmer used only by
// the body-empty check. Avoids importing bytes for one call.
func bytesTrim(b []byte) []byte {
	for len(b) > 0 && (b[0] == ' ' || b[0] == '\t' || b[0] == '\r' || b[0] == '\n') {
		b = b[1:]
	}
	for len(b) > 0 && (b[len(b)-1] == ' ' || b[len(b)-1] == '\t' || b[len(b)-1] == '\r' || b[len(b)-1] == '\n') {
		b = b[:len(b)-1]
	}
	return b
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it
// has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseRequest(w, r)
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
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, piiredactionsharedexports.FeatureID)
	ctx = export.WithScopedSharedExportRedactionWindow(ctx, export.ScopedSharedExportRedactionWindow{
		ExportType: req.ExportType,
	})

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(piiredactionsharedexports.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai pii-redaction-shared-exports: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
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
	userMsg := buildUserMessage(req.ExportType)

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

// buildUserMessage synthesises the
// export_type-scoped user message the LLM sees. The format is
// deterministic so canned goldens and provider prompt-hash
// caches stay stable across boots.
func buildUserMessage(exportType string) string {
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

// denyAllConfirm rejects mutating tool calls for this read-only strategy.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)
