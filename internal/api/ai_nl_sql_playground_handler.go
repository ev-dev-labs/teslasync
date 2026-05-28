package api

// Phase-50 / 0057 — PU1 Natural-language SQL playground.
//
// ai_nl_sql_playground_handler.go implements the LLM-backed handler
// at POST /api/v1/ai/power/sql/draft. The flow mirrors
// ai_signal_explorer_nl_filter_handler.go but instead of a per-
// vehicle signal catalog the handler loads an install-wide curated
// schema catalog (a hardcoded whitelist of safe read-only table
// names — drives, charging_sessions, vehicles, alerts, and
// signal_log_view) up-front and installs the snapshot of table-
// names into ctx via nlq.WithScopedSchemaCatalog:
//
//	URL  /api/v1/ai/power/sql/draft
//	  ↓
//	read JSON body with required field (prompt)
//	  ↓
//	resolve provider via *provider.Registry.For("nl-sql-playground")
//	  ↓
//	open SSE writer (internal/ai/stream.New)
//	  ↓
//	load curated schema catalog via the source port
//	  ↓
//	stash in-scope (table-set) snapshot in ctx via
//	  nlq.WithScopedSchemaCatalog(tableNames)
//	  ↓
//	synthesise the user-message that lists the in-scope catalog
//	  (table name + column list per row) so the LLM has
//	  ground-truth schema metadata + the user's prompt
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("nl-sql-playground", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the (table-name set)
// snapshot in ctx via nlq.WithScopedSchemaCatalog BEFORE
// dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The tools
// draft_readonly_sql + validate_readonly_sql REJECT any LLM-
// supplied SQL that references a table NOT in the snapshot. This
// means an attacker who pastes "select * from secrets" into the
// prompt cannot trick the LLM into proposing a query against an
// out-of-catalog table — the scope check refuses the proposal
// before it ever reaches the frontend AI panel.
//
// The handler requires a JSON body with (prompt non-empty); empty
// / null / object-without-fields bodies are rejected with 400.
// Unlike signal-explorer-nl-filter the body has no vehicle_id —
// the curated schema catalog is install-wide.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /power/sql page (manual
//     SQL editor + curated catalog viewer + Apply target) is
//     unchanged. This handler is an OPT-IN add-on; off-mode users
//     never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("nl-sql-playground").
//   - I9 redaction:       PolicyAlertBuilder (deny-by-default;
//     EVERY PII class redacted to a round-trip tag — VINs,
//     coordinates, place names, vehicle names) is installed by
//     dispatch.Run from the strategy and applied to EVERY message
//     (including the synthesised catalog user message and tool
//     outputs) by the redact decorator at the provider boundary.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline /power/sql
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
	nlsqlplayground "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-sql-playground"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nlq"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiNLSqlPlaygroundMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most draft_readonly_sql → validate_readonly_sql
// → answer (with optional retries on validator rejection). A hard
// ceiling of 8 is generous, matching the other propose-only
// handlers (alert-builder, data-repair-suggestions,
// signal-explorer-nl-filter).
const aiNLSqlPlaygroundMaxIterations = 8

// aiNLSqlPlaygroundMaxBodyBytes caps the request body. The body is
// small (just a short prompt); bound it cheaply. 16 KiB
// accommodates a verbose user prompt without truncation.
const aiNLSqlPlaygroundMaxBodyBytes = 16 * 1024

// aiNLSqlPlaygroundMaxPromptChars caps the prompt length after
// JSON decode. The model context window is bounded; a runaway
// prompt would push the canonical system + catalog message out of
// the window.
const aiNLSqlPlaygroundMaxPromptChars = 1200

// AINLSQLSchemaCatalogSource is the narrow read interface the
// handler consumes to load the curated install-wide schema
// catalog. Production wiring satisfies it via
// AINLSQLSchemaCatalogSourceImpl, which returns a hardcoded
// whitelist of safe read-only tables (drives, charging_sessions,
// vehicles, alerts, signal_log_view) so the AI can never propose
// a query against tables outside the curated set.
//
// The interface is intentionally narrow (one method) so test
// fakes stay small and the production implementation cannot
// accidentally widen the surface.
type AINLSQLSchemaCatalogSource interface {
	// SchemaCatalog returns the curated install-wide schema
	// catalog as a list of (name, description, columns) entries
	// at the time of the call. The returned slice MUST be safe
	// for the caller to retain.
	SchemaCatalog(ctx context.Context) ([]AINLSQLSchemaCatalogEntry, error)
}

// AINLSQLSchemaCatalogEntry describes one curated table the LLM
// is allowed to reference in a draft. Name + Columns are
// authoritative; Description is human-readable hint copy that
// steers the LLM toward the right table for the user's prompt
// (e.g. "trips a vehicle has driven, including distance and
// energy used").
type AINLSQLSchemaCatalogEntry struct {
	// Name is the canonical table name as it appears in the
	// physical schema. Lower-case to match Postgres folding.
	Name string

	// Description is one-line human-readable hint copy.
	Description string

	// Columns is the ordered list of column definitions exposed
	// to the LLM. Order is the canonical column-list order the
	// schema documentation uses.
	Columns []AINLSQLSchemaColumn
}

// AINLSQLSchemaColumn is one column definition inside an
// AINLSQLSchemaCatalogEntry.
type AINLSQLSchemaColumn struct {
	// Name is the column name as it appears in the physical
	// schema (lower_snake_case to match Postgres folding).
	Name string

	// Type is the canonical SQL type label (e.g. "bigint",
	// "timestamptz", "double precision"). Surfaced in the user
	// message so the LLM picks correct comparison operators.
	Type string

	// Description is one-line human-readable hint copy.
	Description string
}

// aiNLSqlPlaygroundRequest is the typed body shape. The single
// required field is the user's natural-language prompt.
type aiNLSqlPlaygroundRequest struct {
	// Prompt is the user's natural-language SQL request.
	// Required, non-empty after trimming, capped at
	// aiNLSqlPlaygroundMaxPromptChars.
	Prompt string `json:"prompt"`
}

// AINLSQLPlaygroundHandler is the HTTP handler for
// POST /api/v1/ai/power/sql/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AINLSQLPlaygroundHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     AINLSQLSchemaCatalogSource
	headerName string
	maxIters   int
}

// NewAINLSQLPlaygroundHandler constructs the handler. All non-
// pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_readonly_sql AND validate_readonly_sql
//	(registered by nlq.RegisterNLSqlPlaygroundTools
//	in router.go).
//
// strat:      the nl-sql-playground Strategy (one per process).
// source:     the production AINLSQLSchemaCatalogSource
//
//	(AINLSQLSchemaCatalogSourceImpl in router.go).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewAINLSQLPlaygroundHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source AINLSQLSchemaCatalogSource,
	headerName string,
) *AINLSQLPlaygroundHandler {
	switch {
	case registry == nil:
		panic("api: NewAINLSQLPlaygroundHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAINLSQLPlaygroundHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAINLSQLPlaygroundHandler: nil strategy.Strategy")
	case source == nil:
		panic("api: NewAINLSQLPlaygroundHandler: nil AINLSQLSchemaCatalogSource")
	}
	return &AINLSQLPlaygroundHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiNLSqlPlaygroundMaxIterations,
	}
}

// parseNLSqlPlaygroundRequest drains the body. The prompt field
// is required; absence or empty surface as JSON 400 with a stable
// error key the SPA can localise. Returns (req, true) when the
// body is acceptable.
func parseNLSqlPlaygroundRequest(w http.ResponseWriter, r *http.Request) (aiNLSqlPlaygroundRequest, bool) {
	var req aiNLSqlPlaygroundRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiNLSqlPlaygroundMaxBodyBytes))
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
	if len(prompt) > aiNLSqlPlaygroundMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt exceeds %d characters", aiNLSqlPlaygroundMaxPromptChars))
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
func (h *AINLSQLPlaygroundHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseNLSqlPlaygroundRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model swap,
	// mode flip) without restart. A resolve failure must NOT
	// open the SSE stream — emit JSON 502 so the frontend falls
	// back gracefully.
	if _, err := h.registry.For(r.Context(), nlsqlplayground.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai nl-sql-playground: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Load the curated schema catalog BEFORE opening the SSE
	// writer so a source error surfaces as a clean JSON 5xx
	// rather than a half-open SSE stream the frontend has to
	// clean up.
	catalog, err := h.source.SchemaCatalog(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("ai nl-sql-playground: source.SchemaCatalog failed")
		writeError(w, http.StatusInternalServerError, "failed to load schema catalog")
		return
	}
	if catalog == nil {
		catalog = make([]AINLSQLSchemaCatalogEntry, 0)
	}

	// Defensive: empty catalog is a degenerate but legal state.
	// The strategy will refuse every prompt politely; the scope
	// check would also refuse every table name.
	tableNames := make([]string, 0, len(catalog))
	for _, e := range catalog {
		if e.Name != "" {
			tableNames = append(tableNames, e.Name)
		}
	}

	// 4) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nlsqlplayground.FeatureID)
	ctx = nlq.WithScopedSchemaCatalog(ctx, tableNames)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nlsqlplayground.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai nl-sql-playground: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, nlsqlplayground.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai nl-sql-playground: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is propose-only so the deny-
	// all hook is never reached in practice — defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. The nl-sql-playground
	// surface is NOT conversational — there is no chat history.
	// We hand the LLM a deterministic prompt that lists the in-
	// scope curated schema catalog and instructs the tool
	// sequence EXACTLY: draft_readonly_sql first, then
	// validate_readonly_sql, then a one-sentence rationale.
	userMsg := buildNLSqlPlaygroundUserMessage(req.Prompt, catalog)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int("tables_in_scope", len(tableNames)).
			Msg("ai nl-sql-playground: dispatcher returned error")
	}
}

// buildNLSqlPlaygroundUserMessage synthesises the catalog-aware
// user message the LLM sees. The format is deterministic (sorted
// by name, single line per row) so canned goldens and provider
// prompt-hash caches stay stable across boots.
//
// Only schema metadata (table name, description, column name +
// type + description) is emitted — the redact decorator would
// tag any PII anyway, but emitting only the bare ground-truth
// schema fields keeps the transcript volume minimal AND makes
// the goldens stable across catalog churn.
//
// Exported as `BuildNLSqlPlaygroundUserMessage` would only be
// useful for tests; instead the test calls the unexported helper
// directly from the same package.
func buildNLSqlPlaygroundUserMessage(prompt string, catalog []AINLSQLSchemaCatalogEntry) string {
	var b strings.Builder

	b.WriteString("Suggest a single typed ReadonlySQLDraft that satisfies the user's request below. ")
	b.WriteString("The catalog below is the AUTHORITATIVE list of table names you may reference — refuse politely if the user asks about a table not in the catalog. ")
	b.WriteString("Follow the tool sequence EXACTLY: ")
	b.WriteString("(1) call draft_readonly_sql with the typed {prompt, sql, rationale} you propose; ")
	b.WriteString("(2) call validate_readonly_sql with the same fields to confirm the draft would be accepted by the read-only contract; ")
	b.WriteString("(3) write one rationale sentence and stop. ")
	b.WriteString("Do NOT claim the query was executed — the user reviews the proposal in the AI side panel and clicks the Apply to editor button to copy the draft into the manual SQL editor on /power/sql, then clicks the Run button to execute.")

	// Sort catalog by name for deterministic prompt hashing.
	sorted := append([]AINLSQLSchemaCatalogEntry(nil), catalog...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	if len(sorted) == 0 {
		b.WriteString("\n\nIn-scope curated schema catalog: NONE.\n")
		b.WriteString("\nThe catalog is empty. Reply with one short sentence saying the playground has no tables in scope and STOP — do not call any tool.\n")
	} else {
		b.WriteString("\n\nIn-scope curated schema catalog (table → columns):\n")
		for _, e := range sorted {
			fmt.Fprintf(&b, "  - table=%s — %s\n", e.Name, e.Description)
			// Sort columns deterministically too — matches the
			// goldens-canned reply expectations.
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

// Compile-time assertion: AINLSQLPlaygroundHandler satisfies
// http.Handler.
var _ http.Handler = (*AINLSQLPlaygroundHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the source + validator interfaces declared by
// internal/ai/tools/nl_sql_playground.go. Kept in the same file as
// the handler so the wiring intent is local to the slice.
// ---------------------------------------------------------------------

// nlSqlPlaygroundCuratedCatalog is the install-wide curated
// whitelist of read-only-safe tables the AI may reference. The
// catalog is INTENTIONALLY narrow — restricting the LLM to a
// hand-picked set is the strongest defence against prompt-
// injection exfiltration. Adding a table here is a deliberate
// per-prompt decision, not a default.
//
// Tables present:
//
//   - drives:             Per-trip aggregates (start/end times,
//     distance, energy used, average power).
//   - charging_sessions:  Per-charge aggregates (start/end times,
//     energy added, cost, charger info).
//   - vehicles:           Vehicle metadata (id, vin, display_name,
//     model, color).
//   - alerts:             User-defined alerts that fired
//     (vehicle_id, alert_id, fired_at, level).
//   - signal_log_view:    Telemetry signal history (vehicle_id,
//     signal_name, ts, num_value, str_value)
//     exposed via a view that hides the raw
//     hypertable details.
//
// Each entry carries a small column list — enough for the LLM to
// pick correct WHERE filters and aggregation columns without
// pretending to know columns that aren't there.
//
// Kept here (not in a YAML file) so the catalog is locally
// reviewable in the same file as the handler that consumes it,
// and so a registry-renaming refactor cannot silently desync the
// catalog from the handler.
var nlSqlPlaygroundCuratedCatalog = []AINLSQLSchemaCatalogEntry{
	{
		Name:        "drives",
		Description: "Per-trip aggregates for completed drives (one row per trip)",
		Columns: []AINLSQLSchemaColumn{
			{Name: "id", Type: "bigint", Description: "primary key"},
			{Name: "vehicle_id", Type: "bigint", Description: "vehicle this drive belongs to"},
			{Name: "started_at", Type: "timestamptz", Description: "drive start timestamp UTC"},
			{Name: "ended_at", Type: "timestamptz", Description: "drive end timestamp UTC"},
			{Name: "distance_m", Type: "double precision", Description: "total distance in meters (SI canonical)"},
			{Name: "duration_s", Type: "double precision", Description: "total duration in seconds (SI canonical)"},
			{Name: "energy_used_wh", Type: "double precision", Description: "total energy consumed in watt-hours (SI canonical)"},
			{Name: "regen_wh", Type: "double precision", Description: "total regenerative energy recovered in watt-hours"},
			{Name: "avg_speed_mps", Type: "double precision", Description: "average speed in meters per second (SI canonical)"},
			{Name: "max_speed_mps", Type: "double precision", Description: "maximum speed in meters per second"},
		},
	},
	{
		Name:        "charging_sessions",
		Description: "Per-charge aggregates for completed charging sessions (one row per session)",
		Columns: []AINLSQLSchemaColumn{
			{Name: "id", Type: "bigint", Description: "primary key"},
			{Name: "vehicle_id", Type: "bigint", Description: "vehicle being charged"},
			{Name: "started_at", Type: "timestamptz", Description: "session start timestamp UTC"},
			{Name: "ended_at", Type: "timestamptz", Description: "session end timestamp UTC"},
			{Name: "energy_added_wh", Type: "double precision", Description: "total energy added in watt-hours (SI canonical)"},
			{Name: "cost_cents", Type: "bigint", Description: "session cost in user-currency cents"},
			{Name: "charger_kind", Type: "text", Description: "charger family (home, supercharger, third_party)"},
			{Name: "max_power_w", Type: "double precision", Description: "peak power draw in watts"},
		},
	},
	{
		Name:        "vehicles",
		Description: "Vehicle metadata (one row per vehicle)",
		Columns: []AINLSQLSchemaColumn{
			{Name: "id", Type: "bigint", Description: "primary key"},
			{Name: "vin", Type: "text", Description: "Tesla VIN (PII — redacted from any LLM transcript)"},
			{Name: "display_name", Type: "text", Description: "user-chosen display name (PII — redacted)"},
			{Name: "model", Type: "text", Description: "model code (3, Y, S, X, ...)"},
			{Name: "color", Type: "text", Description: "exterior color slug"},
		},
	},
	{
		Name:        "alerts",
		Description: "User-defined alerts that have fired (one row per fire event)",
		Columns: []AINLSQLSchemaColumn{
			{Name: "id", Type: "bigint", Description: "primary key"},
			{Name: "vehicle_id", Type: "bigint", Description: "vehicle the alert fired for"},
			{Name: "alert_rule_id", Type: "bigint", Description: "the alert rule that fired"},
			{Name: "fired_at", Type: "timestamptz", Description: "fire timestamp UTC"},
			{Name: "level", Type: "text", Description: "severity (info, warn, critical)"},
		},
	},
	{
		Name:        "signal_log_view",
		Description: "Telemetry signal history exposed as a stable view (no raw hypertable internals)",
		Columns: []AINLSQLSchemaColumn{
			{Name: "vehicle_id", Type: "bigint", Description: "vehicle the signal belongs to"},
			{Name: "signal_name", Type: "text", Description: "canonical signal name (e.g. VehicleSpeed, BatteryLevel)"},
			{Name: "ts", Type: "timestamptz", Description: "sample timestamp UTC"},
			{Name: "num_value", Type: "double precision", Description: "numeric value (SI canonical) — null when the signal is non-numeric"},
			{Name: "str_value", Type: "text", Description: "string value — null when the signal is numeric"},
		},
	},
}

// AINLSQLSchemaCatalogSourceImpl is the production
// AINLSQLSchemaCatalogSource. It returns the hardcoded
// nlSqlPlaygroundCuratedCatalog whitelist so the AI can never
// propose a query against tables outside the curated set.
//
// No DB query — the catalog is hand-maintained. A future slice
// that needs per-tenant catalog gating can swap this out without
// churning the handler.
type AINLSQLSchemaCatalogSourceImpl struct{}

// NewAINLSQLSchemaCatalogSource constructs the adapter. No deps.
// Returned by-pointer for symmetry with the other AI* source
// types.
func NewAINLSQLSchemaCatalogSource() *AINLSQLSchemaCatalogSourceImpl {
	return &AINLSQLSchemaCatalogSourceImpl{}
}

// SchemaCatalog implements AINLSQLSchemaCatalogSource. Returns a
// defensive copy of the curated catalog so a caller cannot
// retroactively mutate the source-of-truth slice.
func (a *AINLSQLSchemaCatalogSourceImpl) SchemaCatalog(_ context.Context) ([]AINLSQLSchemaCatalogEntry, error) {
	out := make([]AINLSQLSchemaCatalogEntry, len(nlSqlPlaygroundCuratedCatalog))
	for i, e := range nlSqlPlaygroundCuratedCatalog {
		cols := make([]AINLSQLSchemaColumn, len(e.Columns))
		copy(cols, e.Columns)
		out[i] = AINLSQLSchemaCatalogEntry{
			Name:        e.Name,
			Description: e.Description,
			Columns:     cols,
		}
	}
	return out, nil
}

// Compile-time assertion.
var _ AINLSQLSchemaCatalogSource = (*AINLSQLSchemaCatalogSourceImpl)(nil)

// ---------------------------------------------------------------------
// Production wiring for the nlq.ReadonlySQLValidator interface.
// ---------------------------------------------------------------------

// AINLSQLValidator is the production nlq.ReadonlySQLValidator.
// The shape checks (SELECT/WITH prefix, no-semicolon, no-DML/DDL
// keyword scan, in-scope catalog table check) are already
// enforced by the tool's checkReadonlySQLScopeAndShape before
// this validator is called, so this method is a thin adapter
// that exists so a future slice can add semantic checks (e.g.
// "the requested aggregation will scan more than N partitions —
// suggest a narrower time filter") without churning the tool
// interface.
//
// For Phase-50 / 0057 the validator is intentionally permissive:
// every draft with a valid shape is accepted. The per-request
// scope binding already prevented out-of-catalog tables; the
// keyword scan already prevented DML/DDL; the prefix check
// already prevented non-read statements. There is nothing else
// for the AI surface to enforce — the user's manual SQL editor
// on /power/sql is what actually fires the query, and the user
// reviews the typed proposal before clicking Run.
//
// Stateless. Held by value; safe for concurrent use.
type AINLSQLValidator struct{}

// NewAINLSQLValidator constructs the validator. No deps.
// Returned by-pointer for symmetry with the other AI* validator
// types.
func NewAINLSQLValidator() *AINLSQLValidator {
	return &AINLSQLValidator{}
}

// ValidateReadonlySQL implements nlq.ReadonlySQLValidator.
//
// Future-extension hook: add semantic checks here as later
// slices need them. Keeping the body intentionally minimal so
// the slice's mandate ("propose-only, no semantic surprises")
// is locally legible.
func (v *AINLSQLValidator) ValidateReadonlySQL(draft *nlq.ReadonlySQLDraft) error {
	if draft == nil {
		return errors.New("api ai nl-sql-playground: nil ReadonlySQLDraft")
	}
	return nil
}

// Compile-time assertion.
var _ nlq.ReadonlySQLValidator = (*AINLSQLValidator)(nil)
