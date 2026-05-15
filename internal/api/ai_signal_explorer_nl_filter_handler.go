package api

// Phase-50 / 0044 — S3 Signal explorer NL filter.
//
// ai_signal_explorer_nl_filter_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/signals/filter/draft. The flow mirrors
// ai_data_repair_handler.go but instead of an inventory snapshot the
// handler loads the per-vehicle signal catalog (the SAME catalog the
// SPA's GET /api/v1/signals/{vehicleID}/available endpoint returns)
// up-front and installs the snapshot of (vehicleID, signal-name set)
// into ctx via tools.WithScopedSignalCatalog:
//
//	URL  /api/v1/ai/signals/filter/draft
//	  ↓
//	read JSON body with required fields (vehicle_id, prompt)
//	  ↓
//	resolve provider via *provider.Registry.For("signal-explorer-nl-filter")
//	  ↓
//	open SSE writer (internal/ai/stream.New)
//	  ↓
//	load per-vehicle signal catalog via the source port
//	  ↓
//	stash in-scope (vehicleID, catalog) snapshot in ctx via
//	  tools.WithScopedSignalCatalog(vehicleID, signals)
//	  ↓
//	synthesise the user-message that lists the in-scope catalog
//	  (signal name + value_kind per row) so the LLM has
//	  ground-truth signal metadata + the user's prompt
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("signal-explorer-nl-filter", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the (vehicleID, signal-set)
// snapshot in ctx via tools.WithScopedSignalCatalog BEFORE
// dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The tools
// draft_signal_filter + validate_signal_filter REJECT any
// LLM-supplied signal name that is NOT in the snapshot, and any
// LLM-supplied vehicle_id that does not match the bound vehicle.
// This means an attacker who pastes "show me odometer for vehicle
// 99 instead" into the prompt cannot trick the LLM into proposing
// a filter for a different vehicle or out-of-catalog signal — the
// scope check refuses the proposal before it ever reaches the
// frontend AI panel.
//
// The handler requires a JSON body with (vehicle_id > 0, prompt
// non-empty); empty / null / object-without-fields bodies are
// rejected with 400. The vehicle_id appears in the URL of the
// canonical baseline signal-explorer page
// (/signals/explorer?vehicle_id=N), and the SPA passes it through
// the AI request body so the handler can scope-bind it.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /signals/explorer page
//     (SignalSelector + RangePicker + per-page select + Explore
//     button + Live toggle hitting
//     GET /api/v1/signals/{vehicleID}/{signalName}/history) is
//     unchanged. This handler is an OPT-IN add-on; off-mode users
//     never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("signal-explorer-nl-filter").
//   - I9 redaction:       PolicyChatbot (deny-by-default; EVERY
//     PII class redacted to a round-trip tag — VINs, coordinates,
//     place names, vehicle names) is installed by dispatch.Run from
//     the strategy and applied to EVERY message (including the
//     synthesised catalog user message and tool outputs) by the
//     redact decorator at the provider boundary.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline signal-
//     explorer JSON shape is added or modified by this slice.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	signalexplorernlfilter "github.com/ev-dev-labs/teslasync/internal/ai/strategies/signal-explorer-nl-filter"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiSignalExplorerNlFilterMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft_signal_filter →
// validate_signal_filter → answer (with optional retries on
// validator rejection). A hard ceiling of 8 is generous, matching
// the other propose-only handlers (alert-builder, data-repair-
// suggestions).
const aiSignalExplorerNlFilterMaxIterations = 8

// aiSignalExplorerNlFilterMaxBodyBytes caps the request body. The
// body is small (vehicle_id + a short prompt); bound it cheaply.
// 16 KiB accommodates a verbose user prompt without truncation.
const aiSignalExplorerNlFilterMaxBodyBytes = 16 * 1024

// aiSignalExplorerNlFilterMaxPromptChars caps the prompt length
// after JSON decode. The model context window is bounded; a
// runaway prompt would push the canonical system + catalog message
// out of the window.
const aiSignalExplorerNlFilterMaxPromptChars = 1024

// AISignalCatalogSource is the narrow read interface the handler
// consumes to load the per-vehicle signal catalog. Production
// wiring satisfies it via api.AvailableSignals (the SAME catalog
// the canonical baseline GET /api/v1/signals/{vehicleID}/available
// endpoint returns), so the AI sees the same catalog the user sees
// on the /signals/explorer page.
//
// The interface is intentionally narrow (one method) so test fakes
// stay small and the production implementation cannot accidentally
// widen the surface. The `vehicleID` argument is currently
// unused by the production implementation (the proto-derived
// catalog is global), but is plumbed through so a future per-
// vehicle filter (e.g. firmware-gated signals) can be added
// without churning the interface.
type AISignalCatalogSource interface {
	// SignalCatalog returns the per-vehicle signal catalog as a
	// list of (name, value_kind) pairs at the time of the call.
	// Both keys are non-empty for valid entries. The returned
	// slice MUST be safe for the caller to retain.
	SignalCatalog(ctx context.Context, vehicleID int64) ([]AISignalCatalogEntry, error)
}

// AISignalCatalogEntry is a (name, value_kind) pair for one signal.
// value_kind is the protomodel ValueKind string (e.g. "ValueKindFloat",
// "ValueKindInt", "ValueKindLocation") used by the SignalExplorerPage
// to pick a typed renderer for the history chart.
type AISignalCatalogEntry struct {
	Name      string
	ValueKind string
}

// aiSignalExplorerNlFilterRequest is the typed body shape. Both
// fields are required.
type aiSignalExplorerNlFilterRequest struct {
	// VehicleID is the canonical baseline vehicle ID (the URL
	// segment of /api/v1/signals/{vehicleID}/...). Required and
	// positive.
	VehicleID int64 `json:"vehicle_id"`

	// Prompt is the user's natural-language filter request.
	// Required, non-empty after trimming, capped at
	// aiSignalExplorerNlFilterMaxPromptChars.
	Prompt string `json:"prompt"`
}

// AISignalExplorerNlFilterHandler is the HTTP handler for
// POST /api/v1/ai/signals/filter/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AISignalExplorerNlFilterHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     AISignalCatalogSource
	headerName string
	maxIters   int
}

// NewAISignalExplorerNlFilterHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already
//             applied).
// toolReg:    process-wide tool registry. MUST contain
//             draft_signal_filter AND validate_signal_filter
//             (registered by tools.RegisterSignalExplorerNlFilterTools
//             in router.go).
// strat:      the signal-explorer-nl-filter Strategy (one per
//             process).
// source:     the production AISignalCatalogSource (currently
//             api.AvailableSignals adapter).
// headerName: forward-auth header name; used to extract subject for
//             audit.
func NewAISignalExplorerNlFilterHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source AISignalCatalogSource,
	headerName string,
) *AISignalExplorerNlFilterHandler {
	switch {
	case registry == nil:
		panic("api: NewAISignalExplorerNlFilterHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAISignalExplorerNlFilterHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAISignalExplorerNlFilterHandler: nil strategy.Strategy")
	case source == nil:
		panic("api: NewAISignalExplorerNlFilterHandler: nil AISignalCatalogSource")
	}
	return &AISignalExplorerNlFilterHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiSignalExplorerNlFilterMaxIterations,
	}
}

// parseSignalExplorerNlFilterRequest drains the body. Both
// fields (vehicle_id, prompt) are required; absence or invalid
// values surface as JSON 400 with a stable error key the SPA can
// localise. Returns (req, true) when the body is acceptable.
func parseSignalExplorerNlFilterRequest(w http.ResponseWriter, r *http.Request) (aiSignalExplorerNlFilterRequest, bool) {
	var req aiSignalExplorerNlFilterRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiSignalExplorerNlFilterMaxBodyBytes))
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
	if req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return req, false
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return req, false
	}
	if len(prompt) > aiSignalExplorerNlFilterMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt exceeds %d characters", aiSignalExplorerNlFilterMaxPromptChars))
		return req, false
	}
	req.Prompt = prompt
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
// catalog is loaded, the dispatcher is invoked, and the SSE
// stream is closed via the dispatcher's deferred WriteDone. Every
// error path either writes a structured frame onto the SSE stream
// (when the writer has been opened) or a plain JSON 4xx/5xx
// (before it has).
func (h *AISignalExplorerNlFilterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseSignalExplorerNlFilterRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), signalexplorernlfilter.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai signal-explorer-nl-filter: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Load the per-vehicle signal catalog BEFORE opening the
	// SSE writer so a source error surfaces as a clean JSON 5xx
	// rather than a half-open SSE stream the frontend has to
	// clean up.
	catalog, err := h.source.SignalCatalog(r.Context(), req.VehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("ai signal-explorer-nl-filter: source.SignalCatalog failed")
		writeError(w, http.StatusInternalServerError, "failed to load signal catalog")
		return
	}
	if catalog == nil {
		catalog = make([]AISignalCatalogEntry, 0)
	}

	// Defensive: empty catalog is a degenerate but legal state
	// (no signals subscribable for this vehicle). The strategy
	// will refuse every prompt politely; the scope check would
	// also refuse every signal name.
	signalNames := make([]string, 0, len(catalog))
	for _, e := range catalog {
		if e.Name != "" {
			signalNames = append(signalNames, e.Name)
		}
	}

	// 4) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, signalexplorernlfilter.FeatureID)
	ctx = tools.WithScopedSignalCatalog(ctx, req.VehicleID, signalNames)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(signalexplorernlfilter.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai signal-explorer-nl-filter: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, signalexplorernlfilter.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai signal-explorer-nl-filter: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook. The
	// strategy's tool whitelist is propose-only so the deny-all
	// hook is never reached in practice — defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. The signal-explorer-nl-filter
	// surface is NOT conversational — there is no chat history.
	// We hand the LLM a deterministic prompt that lists the in-
	// scope per-vehicle catalog and instructs the tool sequence
	// EXACTLY: draft_signal_filter first, then
	// validate_signal_filter, then a one-sentence rationale.
	userMsg := buildSignalExplorerNlFilterUserMessage(req.VehicleID, req.Prompt, catalog)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", req.VehicleID).
			Int("signals_in_scope", len(signalNames)).
			Msg("ai signal-explorer-nl-filter: dispatcher returned error")
	}
}

// buildSignalExplorerNlFilterUserMessage synthesises the catalog-
// aware user message the LLM sees. The format is deterministic
// (sorted by name, single line per row) so canned goldens and
// provider prompt-hash caches stay stable across boots.
//
// Only signal name + value_kind are emitted — the redact decorator
// would tag any PII anyway, but emitting only the bare ground-
// truth fields keeps the transcript volume minimal AND makes the
// goldens stable across catalog churn.
//
// Exported as `BuildSignalExplorerNlFilterUserMessage` would only
// be useful for tests; instead the test calls the unexported
// helper directly from the same package.
func buildSignalExplorerNlFilterUserMessage(vehicleID int64, prompt string, catalog []AISignalCatalogEntry) string {
	var b strings.Builder

	fmt.Fprintf(&b, "Suggest a single typed SignalFilter draft for vehicle %d that satisfies the user's request below. ", vehicleID)
	b.WriteString("The catalog below is the AUTHORITATIVE list of signal names you may propose — refuse politely if the user asks for a signal not in the catalog. ")
	b.WriteString("Follow the tool sequence EXACTLY: ")
	b.WriteString("(1) call draft_signal_filter with the typed SignalFilter you propose; ")
	b.WriteString("(2) call validate_signal_filter with the same SignalFilter to confirm it would be accepted by the canonical SignalExplorerPage form; ")
	b.WriteString("(3) write one rationale sentence and stop. ")
	b.WriteString("Do NOT claim the filter was applied — the user reviews the proposal in the AI side panel and clicks the Apply button to copy the draft into the baseline form. ")

	// Sort catalog by name for deterministic prompt hashing.
	sorted := append([]AISignalCatalogEntry(nil), catalog...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	if len(sorted) == 0 {
		b.WriteString("\n\nIn-scope signal catalog: NONE.\n")
		b.WriteString("\nThe catalog is empty. Reply with one short sentence saying the vehicle has no subscribable signals and STOP — do not call any tool.\n")
	} else {
		b.WriteString("\n\nIn-scope signal catalog (name, value_kind):\n")
		for _, e := range sorted {
			fmt.Fprintf(&b, "  - name=%s value_kind=%s\n", e.Name, e.ValueKind)
		}
	}

	b.WriteString("\nUser request: ")
	b.WriteString(prompt)
	b.WriteString("\n")

	return b.String()
}

// Compile-time assertion: AISignalExplorerNlFilterHandler satisfies
// http.Handler.
var _ http.Handler = (*AISignalExplorerNlFilterHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the source + validator interfaces declared by
// internal/ai/tools/signal_explorer_nl_filter.go. Kept in the same
// file as the handler so the wiring intent is local to the slice.
// ---------------------------------------------------------------------

// AISignalCatalogSourceImpl is the production AISignalCatalogSource.
// It delegates to the SHARED AvailableSignals() function that ALSO
// backs the canonical baseline GET /api/v1/signals/{vehicleID}/available
// handler so the AI surface sees the same catalog the user sees on
// the /signals/explorer page. No new SQL is added by this slice.
//
// The catalog is currently global (proto-derived); the vehicleID
// argument is plumbed through but unused. A future slice that
// gates signals per-firmware can scope here without churning the
// interface.
type AISignalCatalogSourceImpl struct{}

// NewAISignalCatalogSource constructs the adapter. No deps —
// AvailableSignals is package-static. Returned by-pointer for
// symmetry with the other AI* source types.
func NewAISignalCatalogSource() *AISignalCatalogSourceImpl {
	return &AISignalCatalogSourceImpl{}
}

// SignalCatalog implements AISignalCatalogSource. One synchronous
// call into the shared proto-derived catalog. Allocations are
// bounded by len(protomodel.Signals).
func (a *AISignalCatalogSourceImpl) SignalCatalog(_ context.Context, _ int64) ([]AISignalCatalogEntry, error) {
	src := AvailableSignals()
	out := make([]AISignalCatalogEntry, 0, len(src))
	for _, s := range src {
		// Filter compound parents — the SPA's SignalSelector only
		// surfaces atomic-children, so the LLM should not propose
		// a compound name (the history endpoint would 404).
		if s.IsCompound {
			continue
		}
		out = append(out, AISignalCatalogEntry{
			Name:      s.Name,
			ValueKind: s.ValueKind,
		})
	}
	return out, nil
}

// Compile-time assertion.
var _ AISignalCatalogSource = (*AISignalCatalogSourceImpl)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tools.SignalFilterValidator interface.
// ---------------------------------------------------------------------

// AISignalFilterValidator is the production
// tools.SignalFilterValidator. It enforces the SAME canonical
// SignalExplorerPage range/limit enumeration that the SPA's
// SignalSelector + RangePicker + per-page select would enforce, so
// a draft accepted here is byte-equivalent to a draft that would
// be accepted by the baseline form.
//
// Stateless. Held by value; safe for concurrent use.
type AISignalFilterValidator struct{}

// NewAISignalFilterValidator constructs the validator. No deps —
// the canonical enumeration lives as exported helpers in the
// tools package. Returned by-pointer for symmetry with the other
// AI* validator types.
func NewAISignalFilterValidator() *AISignalFilterValidator {
	return &AISignalFilterValidator{}
}

// ValidateSignalFilter implements tools.SignalFilterValidator.
//
// The shape checks (vehicle_id / signals length / range_preset /
// per_page) are already enforced by the tool's
// checkSignalFilterScopeAndShape before this validator is called,
// so this method is a thin adapter that exists so a future slice
// can add semantic checks (e.g. "the requested range exceeds 90d
// for a value_kind=Location signal where high-resolution history
// would be too large to chart") without churning the tool
// interface.
//
// For Phase-50 / 0044 the validator is intentionally permissive:
// every filter with a valid shape is accepted. The per-request
// scope binding already prevented out-of-catalog signals; the
// canonical enumeration already prevented bad range presets and
// page sizes. There is nothing else for the AI surface to enforce
// — the canonical baseline GET /api/v1/signals/{vehicleID}/{signalName}/history
// path will silently filter any stragglers.
func (v *AISignalFilterValidator) ValidateSignalFilter(filter *tools.SignalFilter) error {
	if filter == nil {
		return errors.New("api ai signal-explorer-nl-filter: nil SignalFilter")
	}
	// Future-extension hook: add semantic checks here as later
	// slices need them. Keeping the body intentionally minimal so
	// the slice's mandate ("propose-only, no semantic surprises")
	// is locally legible.
	return nil
}

// Compile-time assertion.
var _ tools.SignalFilterValidator = (*AISignalFilterValidator)(nil)
