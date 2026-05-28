package api

// Phase-50 / 0058 — PU2 Natural-language Grafana panel.
//
// ai_nl_grafana_panel_handler.go implements the LLM-backed handler
// at POST /api/v1/ai/power/grafana-panel/draft. The flow mirrors
// ai_nl_sql_playground_handler.go but instead of a single
// table-name catalog the handler loads three install-wide curated
// catalogs (panel-type whitelist, datasource-type whitelist, and
// table-name whitelist) up-front and installs the snapshots into
// ctx via nlq.WithGrafanaPanelScope:
//
//	URL  /api/v1/ai/power/grafana-panel/draft
//	  ↓
//	read JSON body with required field (prompt)
//	  ↓
//	resolve provider via *provider.Registry.For("nl-grafana-panel")
//	  ↓
//	load curated panel-builder catalog via the source port
//	  ↓
//	stash in-scope (panel-types, ds-types, tables) snapshots in
//	  ctx via nlq.WithGrafanaPanelScope(...)
//	  ↓
//	open SSE writer (internal/ai/stream.New)
//	  ↓
//	synthesise the user-message that lists every in-scope catalog
//	  so the LLM has ground-truth metadata + the user's prompt
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("nl-grafana-panel", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the (panel-type, ds-type,
// table-name) snapshots in ctx via nlq.WithGrafanaPanelScope
// BEFORE dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The tools
// draft_grafana_panel + validate_grafana_panel REJECT any LLM-
// supplied panel.type, datasource.type, or postgres-target table
// reference that is NOT in the snapshots. This means an attacker
// who pastes "select * from secrets" into the prompt cannot trick
// the LLM into proposing a panel against an out-of-catalog table
// — the scope check refuses the proposal before it ever reaches
// the frontend AI panel.
//
// The handler requires a JSON body with (prompt non-empty); empty
// / null / object-without-fields bodies are rejected with 400.
// Like nl-sql-playground the body has no vehicle_id — the curated
// panel-builder catalogs are install-wide.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /power/grafana page
//     (manual JSON editor + curated catalog viewer + Copy target)
//     is unchanged. This handler is an OPT-IN add-on; off-mode
//     users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("nl-grafana-panel").
//   - I9 redaction:       PolicyAlertBuilder (deny-by-default;
//     EVERY PII class redacted to a round-trip tag — VINs,
//     coordinates, place names, vehicle names) is installed by
//     dispatch.Run from the strategy and applied to EVERY message
//     (including the synthesised catalog user message and tool
//     outputs) by the redact decorator at the provider boundary.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline /power/grafana
//     surface is added or modified by this slice.

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
	nlgrafanapanel "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-grafana-panel"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nlq"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiNLGrafanaPanelMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most draft_grafana_panel → validate_grafana_panel
// → answer (with optional retries on validator rejection). A hard
// ceiling of 8 is generous, matching nl-sql-playground.
const aiNLGrafanaPanelMaxIterations = 8

// aiNLGrafanaPanelMaxBodyBytes caps the request body. The body is
// small (just a short prompt); bound it cheaply. 16 KiB
// accommodates a verbose user prompt without truncation.
const aiNLGrafanaPanelMaxBodyBytes = 16 * 1024

// aiNLGrafanaPanelMaxPromptChars caps the prompt length after JSON
// decode. The model context window is bounded; a runaway prompt
// would push the canonical system + catalog message out of the
// window.
const aiNLGrafanaPanelMaxPromptChars = 1200

// AINLGrafanaPanelCatalogSource is the narrow read interface the
// handler consumes to load the curated install-wide panel-builder
// catalog. Production wiring satisfies it via
// AINLGrafanaPanelCatalogSourceImpl, which returns hardcoded
// whitelists (panel-types, datasource-types, tables) so the AI
// can never propose a panel outside the curated set.
//
// The interface is intentionally narrow (one method) so test
// fakes stay small and the production implementation cannot
// accidentally widen the surface.
type AINLGrafanaPanelCatalogSource interface {
	// PanelBuilderCatalog returns the curated install-wide
	// catalog at the time of the call. The returned struct's
	// slices MUST be safe for the caller to retain.
	PanelBuilderCatalog(ctx context.Context) (AINLGrafanaPanelCatalog, error)
}

// AINLGrafanaPanelCatalog is the bundle of in-scope catalogs the
// AI is allowed to draw from. A single struct lets the handler
// load all three with one source call and pass them to the user
// message + scope binding atomically.
type AINLGrafanaPanelCatalog struct {
	// PanelTypes is the curated whitelist of Grafana panel types
	// the AI may propose. Each entry carries a one-line hint so
	// the LLM picks the right type for the user's prompt.
	PanelTypes []AINLGrafanaPanelTypeEntry

	// DatasourceTypes is the curated whitelist of Grafana
	// datasource types the AI may propose. Each entry carries a
	// short hint and the canonical UID the install ships with so
	// the LLM emits a usable {type, uid} reference.
	DatasourceTypes []AINLGrafanaDatasourceTypeEntry

	// Tables is the curated whitelist of postgres tables the AI
	// may reference inside a postgres-target rawSql. Same shape
	// as nl-sql-playground's catalog so the validator + scope
	// regexes are interchangeable.
	Tables []AINLSQLSchemaCatalogEntry
}

// AINLGrafanaPanelTypeEntry describes one curated Grafana panel
// type the LLM is allowed to propose.
type AINLGrafanaPanelTypeEntry struct {
	// Name is the canonical panel-type slug as it appears in
	// Grafana's panel-type registry (e.g. "timeseries", "stat").
	// Lower-case to match Grafana folding.
	Name string

	// Description is one-line human-readable hint copy for the
	// LLM's tool selection.
	Description string
}

// AINLGrafanaDatasourceTypeEntry describes one curated Grafana
// datasource type the LLM is allowed to propose.
type AINLGrafanaDatasourceTypeEntry struct {
	// Name is the canonical datasource-type slug as it appears
	// in Grafana's plugin registry (e.g. "postgres",
	// "prometheus"). Lower-case to match Grafana folding.
	Name string

	// UID is the canonical datasource UID the install ships
	// with. Surfaced to the LLM so the proposed panel's
	// datasource reference points at a UID Grafana actually has
	// (rather than a hallucinated identifier).
	UID string

	// Description is one-line human-readable hint copy.
	Description string
}

// aiNLGrafanaPanelRequest is the typed body shape. The single
// required field is the user's natural-language prompt.
type aiNLGrafanaPanelRequest struct {
	// Prompt is the user's natural-language Grafana-panel
	// request. Required, non-empty after trimming, capped at
	// aiNLGrafanaPanelMaxPromptChars.
	Prompt string `json:"prompt"`
}

// AINLGrafanaPanelHandler is the HTTP handler for
// POST /api/v1/ai/power/grafana-panel/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AINLGrafanaPanelHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     AINLGrafanaPanelCatalogSource
	headerName string
	maxIters   int
}

// NewAINLGrafanaPanelHandler constructs the handler. All non-
// pointer arguments are required; the constructor panics on a nil
// so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_grafana_panel AND validate_grafana_panel
//	(registered by nlq.RegisterNLGrafanaPanelTools
//	in router.go).
//
// strat:      the nl-grafana-panel Strategy (one per process).
// source:     the production AINLGrafanaPanelCatalogSource
//
//	(AINLGrafanaPanelCatalogSourceImpl in router.go).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewAINLGrafanaPanelHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source AINLGrafanaPanelCatalogSource,
	headerName string,
) *AINLGrafanaPanelHandler {
	switch {
	case registry == nil:
		panic("api: NewAINLGrafanaPanelHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAINLGrafanaPanelHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAINLGrafanaPanelHandler: nil strategy.Strategy")
	case source == nil:
		panic("api: NewAINLGrafanaPanelHandler: nil AINLGrafanaPanelCatalogSource")
	}
	return &AINLGrafanaPanelHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiNLGrafanaPanelMaxIterations,
	}
}

// parseNLGrafanaPanelRequest drains the body. The prompt field is
// required; absence or empty surface as JSON 400 with a stable
// error key the SPA can localise. Returns (req, true) when the
// body is acceptable.
func parseNLGrafanaPanelRequest(w http.ResponseWriter, r *http.Request) (aiNLGrafanaPanelRequest, bool) {
	var req aiNLGrafanaPanelRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiNLGrafanaPanelMaxBodyBytes))
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
	if len(prompt) > aiNLGrafanaPanelMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt exceeds %d characters", aiNLGrafanaPanelMaxPromptChars))
		return req, false
	}
	req.Prompt = prompt
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// curated catalog is loaded, the dispatcher is invoked, and the
// SSE stream is closed via the dispatcher's deferred WriteDone.
// Every error path either writes a structured frame onto the SSE
// stream (when the writer has been opened) or a plain JSON 4xx/5xx
// (before it has).
func (h *AINLGrafanaPanelHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseNLGrafanaPanelRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), nlgrafanapanel.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai nl-grafana-panel: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Load the curated panel-builder catalog BEFORE opening the
	// SSE writer so a source error surfaces as a clean JSON 5xx
	// rather than a half-open SSE stream the frontend has to clean
	// up.
	catalog, err := h.source.PanelBuilderCatalog(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("ai nl-grafana-panel: source.PanelBuilderCatalog failed")
		writeError(w, http.StatusInternalServerError, "failed to load panel-builder catalog")
		return
	}

	// Defensive: an empty catalog dimension is a degenerate but
	// legal state. The strategy will refuse every prompt politely;
	// the scope check would also refuse every member of that
	// dimension.
	panelTypeNames := make([]string, 0, len(catalog.PanelTypes))
	for _, e := range catalog.PanelTypes {
		if e.Name != "" {
			panelTypeNames = append(panelTypeNames, e.Name)
		}
	}
	dsTypeNames := make([]string, 0, len(catalog.DatasourceTypes))
	for _, e := range catalog.DatasourceTypes {
		if e.Name != "" {
			dsTypeNames = append(dsTypeNames, e.Name)
		}
	}
	tableNames := make([]string, 0, len(catalog.Tables))
	for _, e := range catalog.Tables {
		if e.Name != "" {
			tableNames = append(tableNames, e.Name)
		}
	}

	// 4) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nlgrafanapanel.FeatureID)
	ctx = nlq.WithGrafanaPanelScope(ctx, panelTypeNames, dsTypeNames, tableNames)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nlgrafanapanel.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai nl-grafana-panel: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, nlgrafanapanel.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai nl-grafana-panel: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook. The
	// strategy's tool whitelist is propose-only so the deny-all
	// hook is never reached in practice — defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. The nl-grafana-panel surface
	// is NOT conversational — there is no chat history. We hand
	// the LLM a deterministic prompt that lists every in-scope
	// catalog and instructs the tool sequence EXACTLY:
	// draft_grafana_panel first, then validate_grafana_panel, then
	// a one-sentence rationale.
	userMsg := buildNLGrafanaPanelUserMessage(req.Prompt, catalog)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int("panel_types_in_scope", len(panelTypeNames)).
			Int("datasource_types_in_scope", len(dsTypeNames)).
			Int("tables_in_scope", len(tableNames)).
			Msg("ai nl-grafana-panel: dispatcher returned error")
	}
}

// buildNLGrafanaPanelUserMessage synthesises the catalog-aware
// user message the LLM sees. The format is deterministic (sorted
// by name, single line per row) so canned goldens and provider
// prompt-hash caches stay stable across boots.
//
// Only schema metadata (panel-type/datasource-type slugs, table
// name + column list) is emitted — the redact decorator would tag
// any PII anyway, but emitting only the bare ground-truth metadata
// keeps the transcript volume minimal AND makes the goldens
// stable across catalog churn.
func buildNLGrafanaPanelUserMessage(prompt string, catalog AINLGrafanaPanelCatalog) string {
	var b strings.Builder

	b.WriteString("Suggest a single typed GrafanaPanelDraft that satisfies the user's request below. ")
	b.WriteString("The catalogs below are the AUTHORITATIVE lists you may reference — refuse politely if the user asks for a panel type, datasource type, or table not in the catalog. ")
	b.WriteString("Follow the tool sequence EXACTLY: ")
	b.WriteString("(1) call draft_grafana_panel with the typed {prompt, panel:{title,type,datasource,targets,grid_pos}, rationale} you propose; ")
	b.WriteString("(2) call validate_grafana_panel with the same fields to confirm the draft would be accepted by the panel-builder contract; ")
	b.WriteString("(3) write one rationale sentence and stop. ")
	b.WriteString("Do NOT claim the panel was created, applied, exported, or pushed — the user reviews the proposal in the AI side panel and clicks the Apply to editor button to copy the draft into the manual Grafana panel JSON editor on /power/grafana, then clicks Copy to clipboard to paste it into their existing Grafana dashboard editor.")

	// Sort panel types by name for deterministic prompt hashing.
	panelTypes := append([]AINLGrafanaPanelTypeEntry(nil), catalog.PanelTypes...)
	sort.Slice(panelTypes, func(i, j int) bool { return panelTypes[i].Name < panelTypes[j].Name })
	if len(panelTypes) == 0 {
		b.WriteString("\n\nIn-scope curated panel-type catalog: NONE.\n")
	} else {
		b.WriteString("\n\nIn-scope curated panel-type catalog (panel.type → hint):\n")
		for _, e := range panelTypes {
			fmt.Fprintf(&b, "  - panel_type=%s — %s\n", e.Name, e.Description)
		}
	}

	// Sort datasource types by name for deterministic prompt
	// hashing.
	dsTypes := append([]AINLGrafanaDatasourceTypeEntry(nil), catalog.DatasourceTypes...)
	sort.Slice(dsTypes, func(i, j int) bool { return dsTypes[i].Name < dsTypes[j].Name })
	if len(dsTypes) == 0 {
		b.WriteString("\nIn-scope curated datasource-type catalog: NONE.\n")
	} else {
		b.WriteString("\nIn-scope curated datasource-type catalog (datasource.type → uid → hint):\n")
		for _, e := range dsTypes {
			fmt.Fprintf(&b, "  - datasource_type=%s uid=%s — %s\n", e.Name, e.UID, e.Description)
		}
	}

	// Sort table catalog by name for deterministic prompt hashing.
	tables := append([]AINLSQLSchemaCatalogEntry(nil), catalog.Tables...)
	sort.Slice(tables, func(i, j int) bool { return tables[i].Name < tables[j].Name })
	if len(tables) == 0 {
		b.WriteString("\nIn-scope curated table catalog (for postgres targets): NONE.\n")
		b.WriteString("\nThe table catalog is empty. If the user asks for a postgres-backed panel, reply with one short sentence saying the panel-builder has no tables in scope and STOP — do not call any tool.\n")
	} else {
		b.WriteString("\nIn-scope curated table catalog (for postgres targets, table → columns):\n")
		for _, e := range tables {
			fmt.Fprintf(&b, "  - table=%s — %s\n", e.Name, e.Description)
			cols := append([]AINLSQLSchemaColumn(nil), e.Columns...)
			sort.Slice(cols, func(i, j int) bool { return cols[i].Name < cols[j].Name })
			for _, c := range cols {
				fmt.Fprintf(&b, "      - column=%s type=%s — %s\n", c.Name, c.Type, c.Description)
			}
		}
	}

	b.WriteString("\nUser request: ")
	b.WriteString(prompt)
	b.WriteString("\n")

	return b.String()
}

// Compile-time assertion: AINLGrafanaPanelHandler satisfies
// http.Handler.
var _ http.Handler = (*AINLGrafanaPanelHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the source + validator interfaces declared
// by internal/ai/tools/nl_grafana_panel.go. Kept in the same file
// as the handler so the wiring intent is local to the slice.
// ---------------------------------------------------------------------

// nlGrafanaPanelCuratedPanelTypes is the install-wide curated
// whitelist of Grafana panel types the AI may propose. The catalog
// is INTENTIONALLY narrow — restricting the LLM to a hand-picked
// set is the strongest defence against prompt-injection
// exfiltration.
//
// Adding a panel type here is a deliberate per-prompt decision,
// not a default. A future slice that needs to add a new panel
// type MUST extend this list AND update the strategy goldens.
var nlGrafanaPanelCuratedPanelTypes = []AINLGrafanaPanelTypeEntry{
	{Name: "timeseries", Description: "time-series chart (default for any time-vs-value query)"},
	{Name: "stat", Description: "single-value big-number stat panel (latest sample of one metric)"},
	{Name: "gauge", Description: "single-value gauge with min/max bounds"},
	{Name: "table", Description: "tabular result of an SQL/PromQL query"},
	{Name: "barchart", Description: "categorical bar chart"},
	{Name: "heatmap", Description: "two-dimensional heatmap (e.g. histograms over time)"},
	{Name: "piechart", Description: "categorical pie chart"},
	{Name: "logs", Description: "log-line stream (for text-shaped data)"},
}

// nlGrafanaPanelCuratedDatasourceTypes is the install-wide curated
// whitelist of Grafana datasource types the AI may propose. Each
// entry carries the canonical UID the install ships with.
//
// The UIDs here are placeholders — a future per-tenant slice can
// swap this source out to inject the install's actual UIDs at
// boot. For now the LLM emits them verbatim and the user fixes
// the UID when pasting into Grafana if needed; the validator
// allows any non-empty UID, and the SPA renders the proposal
// for review before any paste.
var nlGrafanaPanelCuratedDatasourceTypes = []AINLGrafanaDatasourceTypeEntry{
	{
		Name:        "postgres",
		UID:         "tesla-postgres",
		Description: "TimescaleDB postgres instance — for queries against the curated table catalog below",
	},
	{
		Name:        "prometheus",
		UID:         "tesla-prometheus",
		Description: "Prometheus instance — for PromQL queries against TeslaSync's metrics endpoint",
	},
}

// nlGrafanaPanelCuratedTables re-uses the same curated table
// whitelist nl-sql-playground ships. Re-using the same five
// tables guarantees the two slices stay in lock-step on what
// counts as an in-scope table for postgres targets, and means a
// future schema-catalog refactor only has one source of truth to
// update.
var nlGrafanaPanelCuratedTables = nlSqlPlaygroundCuratedCatalog

// AINLGrafanaPanelCatalogSourceImpl is the production
// AINLGrafanaPanelCatalogSource. It returns the three hardcoded
// curated whitelists so the AI can never propose a panel outside
// the curated set.
//
// No DB query — the catalogs are hand-maintained. A future slice
// that needs per-tenant catalog gating can swap this out without
// churning the handler.
type AINLGrafanaPanelCatalogSourceImpl struct{}

// NewAINLGrafanaPanelCatalogSource constructs the adapter. No
// deps. Returned by-pointer for symmetry with the other AI*
// source types.
func NewAINLGrafanaPanelCatalogSource() *AINLGrafanaPanelCatalogSourceImpl {
	return &AINLGrafanaPanelCatalogSourceImpl{}
}

// PanelBuilderCatalog implements AINLGrafanaPanelCatalogSource.
// Returns defensive copies of the three curated whitelists so a
// caller cannot retroactively mutate the source-of-truth slices.
func (a *AINLGrafanaPanelCatalogSourceImpl) PanelBuilderCatalog(_ context.Context) (AINLGrafanaPanelCatalog, error) {
	panelTypes := make([]AINLGrafanaPanelTypeEntry, len(nlGrafanaPanelCuratedPanelTypes))
	copy(panelTypes, nlGrafanaPanelCuratedPanelTypes)

	dsTypes := make([]AINLGrafanaDatasourceTypeEntry, len(nlGrafanaPanelCuratedDatasourceTypes))
	copy(dsTypes, nlGrafanaPanelCuratedDatasourceTypes)

	tables := make([]AINLSQLSchemaCatalogEntry, len(nlGrafanaPanelCuratedTables))
	for i, e := range nlGrafanaPanelCuratedTables {
		cols := make([]AINLSQLSchemaColumn, len(e.Columns))
		copy(cols, e.Columns)
		tables[i] = AINLSQLSchemaCatalogEntry{
			Name:        e.Name,
			Description: e.Description,
			Columns:     cols,
		}
	}

	return AINLGrafanaPanelCatalog{
		PanelTypes:      panelTypes,
		DatasourceTypes: dsTypes,
		Tables:          tables,
	}, nil
}

// Compile-time assertion.
var _ AINLGrafanaPanelCatalogSource = (*AINLGrafanaPanelCatalogSourceImpl)(nil)

// ---------------------------------------------------------------------
// Production wiring for the nlq.GrafanaPanelValidator interface.
// ---------------------------------------------------------------------

// AINLGrafanaValidator is the production nlq.GrafanaPanelValidator.
// The shape checks (panel-type catalog, datasource-type catalog,
// per-target shape, postgres rawSql contract, prometheus expr
// contract, gridPos bounds) are already enforced by the tool's
// checkGrafanaPanelScopeAndShape before this validator is called,
// so this method is a thin adapter that exists so a future slice
// can add semantic checks (e.g. "the requested aggregation will
// scan more than N partitions — suggest a narrower time filter")
// without churning the tool interface.
//
// For Phase-50 / 0058 the validator is intentionally permissive:
// every draft with a valid shape is accepted. The per-request
// scope binding already prevented out-of-catalog panel/datasource
// types and out-of-catalog tables; the keyword + prefix checks
// already prevented DML/DDL inside postgres rawSql. There is
// nothing else for the AI surface to enforce — the user's manual
// JSON editor on /power/grafana is what they paste into Grafana,
// and the user reviews the typed proposal before clicking Apply.
//
// Stateless. Held by value; safe for concurrent use.
type AINLGrafanaValidator struct{}

// NewAINLGrafanaValidator constructs the validator. No deps.
// Returned by-pointer for symmetry with the other AI* validator
// types.
func NewAINLGrafanaValidator() *AINLGrafanaValidator {
	return &AINLGrafanaValidator{}
}

// ValidateGrafanaPanel implements nlq.GrafanaPanelValidator.
//
// Future-extension hook: add semantic checks here as later slices
// need them. Keeping the body intentionally minimal so the
// slice's mandate ("propose-only, no semantic surprises") is
// locally legible.
func (v *AINLGrafanaValidator) ValidateGrafanaPanel(draft *nlq.GrafanaPanelDraft) error {
	if draft == nil {
		return errors.New("api ai nl-grafana-panel: nil GrafanaPanelDraft")
	}
	return nil
}

// Compile-time assertion.
var _ nlq.GrafanaPanelValidator = (*AINLGrafanaValidator)(nil)
