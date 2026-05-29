package ainldash

// Natural-language dashboard composer.
//
// This LLM-backed SSE handler drafts dashboard layouts from a curated
// install-wide panel catalog. The catalog snapshot is bound into context before
// tools run, so out-of-catalog panel names from prompt injection are rejected by
// the tool scope check.

import (
	"bytes"
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
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nlq"
	apihttpx "github.com/ev-dev-labs/teslasync/internal/api/httpx"
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

// CatalogSource is the narrow read
// interface the handler consumes to load the curated install-
// wide dashboard panel catalog. Production wiring satisfies it
// via CatalogSourceImpl, which returns a
// hardcoded whitelist of pre-validated panel templates so the
// AI can never name a panel outside the curated set.
//
// The interface is intentionally narrow (one method) so test
// fakes stay small and the production implementation cannot
// accidentally widen the surface.
type CatalogSource interface {
	// DashboardComposerCatalog returns the curated install-wide
	// catalog at the time of the call. The returned slice MUST
	// be safe for the caller to retain.
	DashboardComposerCatalog(ctx context.Context) ([]PanelEntry, error)
}

// PanelEntry describes one curated
// dashboard panel the LLM is allowed to use as a slot.
// Mirrors the SPA's CuratedDashboardPanel type 1:1.
type PanelEntry struct {
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

// Handler is the HTTP handler for
// POST /api/v1/ai/power/dashboard/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     CatalogSource
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
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
//	(registered by nlq.RegisterNLDashboardComposerTools
//	in router.go).
//
// strat:      the nl-dashboard-composer Strategy (one per
//
//	process).
//
// source:     the production CatalogSource
//
//	(CatalogSourceImpl in router.go).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source CatalogSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("ainldash: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("ainldash: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("ainldash: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("ainldash: NewHandler: nil CatalogSource")
	}
	return &Handler{
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
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
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
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	req, ok := parseNLDashboardComposerRequest(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider failures remain JSON errors.
	if _, err := h.registry.For(r.Context(), nldashboardcomposer.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai nl-dashboard-composer: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Load the catalog before SSE so source failures remain clean JSON 5xx.
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

	// Bind the catalog scope before any tool can run.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nldashboardcomposer.FeatureID)
	ctx = nlq.WithDashboardComposerScope(ctx, panelNames)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nldashboardcomposer.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai nl-dashboard-composer: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, nldashboardcomposer.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai nl-dashboard-composer: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all is defence-in-depth if a future strategy adds a mutating tool.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Non-conversational by design: force the scoped dashboard-draft tool sequence.
	userMsg := buildNLDashboardComposerUserMessage(req.Prompt, catalog)

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
func buildNLDashboardComposerUserMessage(prompt string, catalog []PanelEntry) string {
	var b strings.Builder

	b.WriteString("Suggest a single typed DashboardLayoutDraft that satisfies the user's request below. ")
	b.WriteString("The catalog below is the AUTHORITATIVE list of panels you may reference — refuse politely if the user asks for a panel name not in the catalog. ")
	b.WriteString("Follow the tool sequence EXACTLY: ")
	b.WriteString("(1) call draft_dashboard_layout with the typed {prompt, dashboard:{title, slots:[{panel_name, grid_pos:{x,y,w,h}}]}, rationale} you propose; ")
	b.WriteString("(2) call validate_dashboard_layout with the same fields to confirm the draft would be accepted by the layout contract; ")
	b.WriteString("(3) write one rationale sentence and stop. ")
	b.WriteString("Do NOT claim the dashboard was created, applied, exported, or pushed — the user reviews the proposal in the AI side panel and clicks the Apply to editor button to copy the draft into the manual dashboard composer on /power/dashboards, then clicks Copy to clipboard to paste it into their existing Grafana dashboard editor.")

	// Sort panels by name for deterministic prompt hashing.
	panels := append([]PanelEntry(nil), catalog...)
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

var _ http.Handler = (*Handler)(nil)

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
var nlDashboardComposerCuratedPanels = []PanelEntry{
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

// CatalogSourceImpl is the production
// CatalogSource. It returns the hardcoded
// curated whitelist so the AI can never name a panel outside
// the curated set.
//
// No DB query — the catalog is hand-maintained. A future slice
// that needs per-tenant catalog gating can swap this out without
// churning the handler.
type CatalogSourceImpl struct{}

// NewCatalogSource constructs the adapter.
func NewCatalogSource() *CatalogSourceImpl {
	return &CatalogSourceImpl{}
}

// DashboardComposerCatalog implements
// CatalogSource. Returns a defensive copy
// of the curated whitelist so a caller cannot retroactively
// mutate the source-of-truth slice.
func (a *CatalogSourceImpl) DashboardComposerCatalog(_ context.Context) ([]PanelEntry, error) {
	out := make([]PanelEntry, len(nlDashboardComposerCuratedPanels))
	copy(out, nlDashboardComposerCuratedPanels)
	return out, nil
}

var _ CatalogSource = (*CatalogSourceImpl)(nil)

// Validator is the production
// nlq.DashboardLayoutValidator. The shape checks (panel-name
// catalog, slot count, per-slot grid bounds, duplicate-panel
// detector, overlap detector) are already enforced by the
// tool's checkDashboardLayoutScopeAndShape before this
// validator is called, so this method is a thin adapter that
// exists so a future slice can add semantic checks (e.g. "the
// requested layout would push the dashboard above the Grafana
// 50-row practical ceiling") without churning the tool
// interface.
//
// The validator is intentionally permissive: every draft with a valid
// shape is accepted. The
// per-request scope binding already prevented out-of-catalog
// panel names; the layout bounds + overlap detector already
// prevented placement violations. There is nothing else for the
// AI surface to enforce — the user's manual dashboard composer
// on /power/dashboards is what they paste into Grafana, and
// the user reviews the typed proposal before clicking Apply.
//
// Stateless. Held by value; safe for concurrent use.
type Validator struct{}

// NewValidator constructs the validator.
// No deps. Returned by-pointer for symmetry with the other AI*
// validator types.
func NewValidator() *Validator {
	return &Validator{}
}

// ValidateDashboardLayout implements
// nlq.DashboardLayoutValidator.
//
// Future-extension hook: add semantic checks here as later
// slices need them. Keeping the body intentionally minimal so
// the slice's mandate ("propose-only, no semantic surprises")
// is locally legible.
func (v *Validator) ValidateDashboardLayout(draft *nlq.DashboardLayoutDraft) error {
	if draft == nil {
		return errors.New("ainldash: nil DashboardLayoutDraft")
	}
	return nil
}

// Compile-time assertion.
var _ nlq.DashboardLayoutValidator = (*Validator)(nil)

func writeError(w http.ResponseWriter, status int, msg string) {
	apihttpx.WriteError(w, status, msg)
}

// denyAllConfirm rejects every mutating tool as defence-in-depth.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}
