package api

// Phase-50 / 0059 — PU3 Natural-language dashboard composer.
//
// ai_nl_dashboard_composer_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/power/dashboard/draft. The flow
// mirrors ai_nl_grafana_panel_handler.go but instead of a
// three-dimensional catalog (panel-types + datasource-types +
// tables) the handler loads a single curated install-wide
// catalog (panel names + their hint copy) up-front and installs
// the snapshot into ctx via tools.WithDashboardComposerScope:
//
//	URL  /api/v1/ai/power/dashboard/draft
//	  ↓
//	read JSON body with required field (prompt)
//	  ↓
//	resolve provider via *provider.Registry.For("nl-dashboard-composer")
//	  ↓
//	load curated dashboard panel catalog via the source port
//	  ↓
//	stash in-scope (panel-names) snapshot in ctx via
//	  tools.WithDashboardComposerScope(...)
//	  ↓
//	open SSE writer (internal/ai/stream.New)
//	  ↓
//	synthesise the user-message that lists every in-scope panel
//	  so the LLM has ground-truth metadata + the user's prompt
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("nl-dashboard-composer", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the panel-name snapshot
// in ctx via tools.WithDashboardComposerScope BEFORE
// dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The tools
// draft_dashboard_layout + validate_dashboard_layout REJECT any
// LLM-supplied slot.panel_name that is NOT in the snapshot.
// This means an attacker who pastes "use panel secret_dump"
// into the prompt cannot trick the LLM into proposing a
// dashboard that names an out-of-catalog panel — the scope
// check refuses the proposal before it ever reaches the
// frontend AI panel.
//
// The handler requires a JSON body with (prompt non-empty);
// empty / null / object-without-fields bodies are rejected with
// 400. Like nl-grafana-panel the body has no vehicle_id — the
// curated panel catalog is install-wide.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /power/dashboards
//     page (manual layout composer + curated panel catalog
//     viewer + Copy target) is unchanged. This handler is an
//     OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("nl-dashboard-composer").
//   - I9 redaction:       PolicyAlertBuilder (deny-by-default;
//     EVERY PII class redacted to a round-trip tag — VINs,
//     coordinates, place names, vehicle names) is installed by
//     dispatch.Run from the strategy and applied to EVERY
//     message (including the synthesised catalog user message
//     and tool outputs) by the redact decorator at the provider
//     boundary.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     /power/dashboards surface is added or modified by this
//     slice.

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
	nldashboardcomposer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-dashboard-composer"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiNLDashboardComposerMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft_dashboard_layout →
// validate_dashboard_layout → answer (with optional retries on
// validator rejection). A hard ceiling of 8 is generous,
// matching nl-grafana-panel.
const aiNLDashboardComposerMaxIterations = 8

// aiNLDashboardComposerMaxBodyBytes caps the request body. The
// body is small (just a short prompt); bound it cheaply. 16 KiB
// accommodates a verbose user prompt without truncation.
const aiNLDashboardComposerMaxBodyBytes = 16 * 1024

// aiNLDashboardComposerMaxPromptChars caps the prompt length
// after JSON decode. The model context window is bounded; a
// runaway prompt would push the canonical system + catalog
// message out of the window.
const aiNLDashboardComposerMaxPromptChars = 1200

// AINLDashboardComposerCatalogSource is the narrow read
// interface the handler consumes to load the curated install-
// wide dashboard panel catalog. Production wiring satisfies it
// via AINLDashboardComposerCatalogSourceImpl, which returns a
// hardcoded whitelist of pre-validated panel templates so the
// AI can never name a panel outside the curated set.
//
// The interface is intentionally narrow (one method) so test
// fakes stay small and the production implementation cannot
// accidentally widen the surface.
type AINLDashboardComposerCatalogSource interface {
	// DashboardComposerCatalog returns the curated install-wide
	// catalog at the time of the call. The returned slice MUST
	// be safe for the caller to retain.
	DashboardComposerCatalog(ctx context.Context) ([]AINLDashboardComposerPanelEntry, error)
}

// AINLDashboardComposerPanelEntry describes one curated
// dashboard panel the LLM is allowed to use as a slot.
// Mirrors the SPA's CuratedDashboardPanel type 1:1.
type AINLDashboardComposerPanelEntry struct {
	// Name is the canonical panel slug used as the
	// slot.panel_name when the LLM proposes a layout. Lower-
	// case to match Grafana folding.
	Name string

	// Description is one-line human-readable hint copy for the
	// LLM's panel selection.
	Description string
}

// aiNLDashboardComposerRequest is the typed body shape. The
// single required field is the user's natural-language prompt.
type aiNLDashboardComposerRequest struct {
	// Prompt is the user's natural-language dashboard request.
	// Required, non-empty after trimming, capped at
	// aiNLDashboardComposerMaxPromptChars.
	Prompt string `json:"prompt"`
}

// AINLDashboardComposerHandler is the HTTP handler for
// POST /api/v1/ai/power/dashboard/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AINLDashboardComposerHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     AINLDashboardComposerCatalogSource
	headerName string
	maxIters   int
}

// NewAINLDashboardComposerHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first
// request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_dashboard_layout AND validate_dashboard_layout
//	(registered by tools.RegisterNLDashboardComposerTools
//	in router.go).
//
// strat:      the nl-dashboard-composer Strategy (one per
//
//	process).
//
// source:     the production AINLDashboardComposerCatalogSource
//
//	(AINLDashboardComposerCatalogSourceImpl in router.go).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewAINLDashboardComposerHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source AINLDashboardComposerCatalogSource,
	headerName string,
) *AINLDashboardComposerHandler {
	switch {
	case registry == nil:
		panic("api: NewAINLDashboardComposerHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAINLDashboardComposerHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAINLDashboardComposerHandler: nil strategy.Strategy")
	case source == nil:
		panic("api: NewAINLDashboardComposerHandler: nil AINLDashboardComposerCatalogSource")
	}
	return &AINLDashboardComposerHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiNLDashboardComposerMaxIterations,
	}
}

// parseNLDashboardComposerRequest drains the body. The prompt
// field is required; absence or empty surface as JSON 400 with
// a stable error key the SPA can localise. Returns (req, true)
// when the body is acceptable.
func parseNLDashboardComposerRequest(w http.ResponseWriter, r *http.Request) (aiNLDashboardComposerRequest, bool) {
	var req aiNLDashboardComposerRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiNLDashboardComposerMaxBodyBytes))
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
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return req, false
	}
	if len(prompt) > aiNLDashboardComposerMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt exceeds %d characters", aiNLDashboardComposerMaxPromptChars))
		return req, false
	}
	req.Prompt = prompt
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// curated catalog is loaded, the dispatcher is invoked, and the
// SSE stream is closed via the dispatcher's deferred WriteDone.
// Every error path either writes a structured frame onto the
// SSE stream (when the writer has been opened) or a plain JSON
// 4xx/5xx (before it has).
func (h *AINLDashboardComposerHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseNLDashboardComposerRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure must
	// NOT open the SSE stream — emit JSON 502 so the frontend
	// falls back gracefully.
	if _, err := h.registry.For(r.Context(), nldashboardcomposer.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai nl-dashboard-composer: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Load the curated dashboard panel catalog BEFORE
	// opening the SSE writer so a source error surfaces as a
	// clean JSON 5xx rather than a half-open SSE stream the
	// frontend has to clean up.
	catalog, err := h.source.DashboardComposerCatalog(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("ai nl-dashboard-composer: source.DashboardComposerCatalog failed")
		writeError(w, http.StatusInternalServerError, "failed to load dashboard panel catalog")
		return
	}

	// Defensive: an empty catalog is a degenerate but legal
	// state. The strategy will refuse every prompt politely;
	// the scope check would also refuse every member.
	panelNames := make([]string, 0, len(catalog))
	for _, e := range catalog {
		if e.Name != "" {
			panelNames = append(panelNames, e.Name)
		}
	}

	// 4) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nldashboardcomposer.FeatureID)
	ctx = tools.WithDashboardComposerScope(ctx, panelNames)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nldashboardcomposer.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai nl-dashboard-composer: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, nldashboardcomposer.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai nl-dashboard-composer: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is propose-only so the
	// deny-all hook is never reached in practice — defence in
	// depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. The nl-dashboard-composer
	// surface is NOT conversational — there is no chat history.
	// We hand the LLM a deterministic prompt that lists every
	// in-scope panel and instructs the tool sequence EXACTLY:
	// draft_dashboard_layout first, then
	// validate_dashboard_layout, then a one-sentence rationale.
	userMsg := buildNLDashboardComposerUserMessage(req.Prompt, catalog)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int("panels_in_scope", len(panelNames)).
			Msg("ai nl-dashboard-composer: dispatcher returned error")
	}
}

// buildNLDashboardComposerUserMessage synthesises the catalog-
// aware user message the LLM sees. The format is deterministic
// (sorted by name, single line per row) so canned goldens and
// provider prompt-hash caches stay stable across boots.
//
// Only catalog metadata (panel name + description) is emitted —
// the redact decorator would tag any PII anyway, but emitting
// only the bare ground-truth metadata keeps the transcript
// volume minimal AND makes the goldens stable across catalog
// churn.
func buildNLDashboardComposerUserMessage(prompt string, catalog []AINLDashboardComposerPanelEntry) string {
	var b strings.Builder

	b.WriteString("Suggest a single typed DashboardLayoutDraft that satisfies the user's request below. ")
	b.WriteString("The catalog below is the AUTHORITATIVE list of panels you may reference — refuse politely if the user asks for a panel name not in the catalog. ")
	b.WriteString("Follow the tool sequence EXACTLY: ")
	b.WriteString("(1) call draft_dashboard_layout with the typed {prompt, dashboard:{title, slots:[{panel_name, grid_pos:{x,y,w,h}}]}, rationale} you propose; ")
	b.WriteString("(2) call validate_dashboard_layout with the same fields to confirm the draft would be accepted by the layout contract; ")
	b.WriteString("(3) write one rationale sentence and stop. ")
	b.WriteString("Do NOT claim the dashboard was created, applied, exported, or pushed — the user reviews the proposal in the AI side panel and clicks the Apply to editor button to copy the draft into the manual dashboard composer on /power/dashboards, then clicks Copy to clipboard to paste it into their existing Grafana dashboard editor.")

	// Sort panels by name for deterministic prompt hashing.
	panels := append([]AINLDashboardComposerPanelEntry(nil), catalog...)
	sort.Slice(panels, func(i, j int) bool { return panels[i].Name < panels[j].Name })
	if len(panels) == 0 {
		b.WriteString("\n\nIn-scope curated panel catalog: NONE.\n")
		b.WriteString("\nThe panel catalog is empty. Reply with one short sentence saying the dashboard composer has no panels in scope and STOP — do not call any tool.\n")
	} else {
		b.WriteString("\n\nIn-scope curated panel catalog (panel_name → hint):\n")
		for _, e := range panels {
			fmt.Fprintf(&b, "  - panel_name=%s — %s\n", e.Name, e.Description)
		}
	}

	b.WriteString("\nUser request: ")
	b.WriteString(prompt)
	b.WriteString("\n")

	return b.String()
}

// Compile-time assertion: AINLDashboardComposerHandler satisfies
// http.Handler.
var _ http.Handler = (*AINLDashboardComposerHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the source + validator interfaces declared
// by internal/ai/tools/nl_dashboard_composer.go. Kept in the same
// file as the handler so the wiring intent is local to the slice.
// ---------------------------------------------------------------------

// nlDashboardComposerCuratedPanels is the install-wide curated
// whitelist of dashboard panels the AI may use as slots. The
// catalog is INTENTIONALLY narrow — restricting the LLM to a
// hand-picked set is the strongest defence against prompt-
// injection exfiltration.
//
// Adding a panel here is a deliberate per-prompt decision, not a
// default. A future slice that needs to add a new panel MUST
// extend this list AND update the strategy goldens. Each name
// matches a Grafana-panel template the user has previously
// generated via nl-grafana-panel (slice 0058) OR a stock starter
// the install ships with; the dashboard composer just picks
// among them and arranges them on the grid.
var nlDashboardComposerCuratedPanels = []AINLDashboardComposerPanelEntry{
	{
		Name:        "drives_per_day_timeseries",
		Description: "Timeseries panel: SUM(distance_m)/day from the drives table",
	},
	{
		Name:        "battery_soc_stat",
		Description: "Stat panel: latest BatteryLevel sample from signal_log_view",
	},
	{
		Name:        "charging_sessions_table",
		Description: "Table panel: recent rows from the charging_sessions table",
	},
	{
		Name:        "alerts_count_stat",
		Description: "Stat panel: count of alerts fired in the last 7 days",
	},
	{
		Name:        "vehicles_table",
		Description: "Table panel: vehicles metadata overview (id, model, color)",
	},
	{
		Name:        "energy_used_per_day_barchart",
		Description: "Barchart panel: SUM(energy_used_wh)/day from the drives table",
	},
}

// AINLDashboardComposerCatalogSourceImpl is the production
// AINLDashboardComposerCatalogSource. It returns the hardcoded
// curated whitelist so the AI can never name a panel outside
// the curated set.
//
// No DB query — the catalog is hand-maintained. A future slice
// that needs per-tenant catalog gating can swap this out without
// churning the handler.
type AINLDashboardComposerCatalogSourceImpl struct{}

// NewAINLDashboardComposerCatalogSource constructs the adapter.
// No deps. Returned by-pointer for symmetry with the other AI*
// source types.
func NewAINLDashboardComposerCatalogSource() *AINLDashboardComposerCatalogSourceImpl {
	return &AINLDashboardComposerCatalogSourceImpl{}
}

// DashboardComposerCatalog implements
// AINLDashboardComposerCatalogSource. Returns a defensive copy
// of the curated whitelist so a caller cannot retroactively
// mutate the source-of-truth slice.
func (a *AINLDashboardComposerCatalogSourceImpl) DashboardComposerCatalog(_ context.Context) ([]AINLDashboardComposerPanelEntry, error) {
	out := make([]AINLDashboardComposerPanelEntry, len(nlDashboardComposerCuratedPanels))
	copy(out, nlDashboardComposerCuratedPanels)
	return out, nil
}

// Compile-time assertion.
var _ AINLDashboardComposerCatalogSource = (*AINLDashboardComposerCatalogSourceImpl)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tools.DashboardLayoutValidator interface.
// ---------------------------------------------------------------------

// AINLDashboardComposerValidator is the production
// tools.DashboardLayoutValidator. The shape checks (panel-name
// catalog, slot count, per-slot grid bounds, duplicate-panel
// detector, overlap detector) are already enforced by the
// tool's checkDashboardLayoutScopeAndShape before this
// validator is called, so this method is a thin adapter that
// exists so a future slice can add semantic checks (e.g. "the
// requested layout would push the dashboard above the Grafana
// 50-row practical ceiling") without churning the tool
// interface.
//
// For Phase-50 / 0059 the validator is intentionally
// permissive: every draft with a valid shape is accepted. The
// per-request scope binding already prevented out-of-catalog
// panel names; the layout bounds + overlap detector already
// prevented placement violations. There is nothing else for the
// AI surface to enforce — the user's manual dashboard composer
// on /power/dashboards is what they paste into Grafana, and
// the user reviews the typed proposal before clicking Apply.
//
// Stateless. Held by value; safe for concurrent use.
type AINLDashboardComposerValidator struct{}

// NewAINLDashboardComposerValidator constructs the validator.
// No deps. Returned by-pointer for symmetry with the other AI*
// validator types.
func NewAINLDashboardComposerValidator() *AINLDashboardComposerValidator {
	return &AINLDashboardComposerValidator{}
}

// ValidateDashboardLayout implements
// tools.DashboardLayoutValidator.
//
// Future-extension hook: add semantic checks here as later
// slices need them. Keeping the body intentionally minimal so
// the slice's mandate ("propose-only, no semantic surprises")
// is locally legible.
func (v *AINLDashboardComposerValidator) ValidateDashboardLayout(draft *tools.DashboardLayoutDraft) error {
	if draft == nil {
		return errors.New("api ai nl-dashboard-composer: nil DashboardLayoutDraft")
	}
	return nil
}

// Compile-time assertion.
var _ tools.DashboardLayoutValidator = (*AINLDashboardComposerValidator)(nil)
