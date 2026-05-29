package ainlsql

// Phase-50 / 0057 — PU1 Natural-language SQL playground.
//
// POST /api/v1/ai/power/sql/draft streams an LLM-proposed read-only SQL draft for the manual SQL playground. Before dispatch, the handler binds a curated install-wide schema snapshot into context so tools reject any table outside the whitelist, even if prompt injection asks for it.
//
// The route is AI-gated (ADR-015 §I6), accepts only a non-empty prompt, and leaves the deterministic /power/sql page unchanged.

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
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
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

// SchemaCatalogSource loads the curated install-wide schema catalog.
// It stays narrow so tests can fake it and production code cannot widen the AI's table surface accidentally.
type SchemaCatalogSource interface {
	// SchemaCatalog returns the curated install-wide schema
	// catalog as a list of (name, description, columns) entries
	// at the time of the call. The returned slice MUST be safe
	// for the caller to retain.
	SchemaCatalog(ctx context.Context) ([]SchemaCatalogEntry, error)
}

// SchemaCatalogEntry describes one curated table the LLM may reference.
// Name and Columns are authoritative; Description is hint copy for table selection.
type SchemaCatalogEntry struct {
	// Name is the canonical table name as it appears in the
	// physical schema. Lower-case to match Postgres folding.
	Name string

	// Description is one-line human-readable hint copy.
	Description string

	// Columns is the ordered list of column definitions exposed
	// to the LLM. Order is the canonical column-list order the
	// schema documentation uses.
	Columns []SchemaColumn
}

// SchemaColumn is one column definition inside an
// SchemaCatalogEntry.
type SchemaColumn struct {
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

// Handler is the HTTP handler for
// POST /api/v1/ai/power/sql/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     SchemaCatalogSource
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All non-
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
// source:     the production SchemaCatalogSource
//
//	(SchemaCatalogSourceImpl in router.go).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source SchemaCatalogSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("ainlsql: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("ainlsql: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("ainlsql: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("ainlsql: NewHandler: nil SchemaCatalogSource")
	}
	return &Handler{
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
		httpx.WriteError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiNLSqlPlaygroundMaxBodyBytes))
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
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		httpx.WriteError(w, http.StatusBadRequest, "prompt is required")
		return req, false
	}
	if len(prompt) > aiNLSqlPlaygroundMaxPromptChars {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("prompt exceeds %d characters", aiNLSqlPlaygroundMaxPromptChars))
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
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Load the curated schema catalog BEFORE opening the SSE
	// writer so a source error surfaces as a clean JSON 5xx
	// rather than a half-open SSE stream the frontend has to
	// clean up.
	catalog, err := h.source.SchemaCatalog(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("ai nl-sql-playground: source.SchemaCatalog failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load schema catalog")
		return
	}
	if catalog == nil {
		catalog = make([]SchemaCatalogEntry, 0)
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
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
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
func buildNLSqlPlaygroundUserMessage(prompt string, catalog []SchemaCatalogEntry) string {
	var b strings.Builder

	b.WriteString("Suggest a single typed ReadonlySQLDraft that satisfies the user's request below. ")
	b.WriteString("The catalog below is the AUTHORITATIVE list of table names you may reference — refuse politely if the user asks about a table not in the catalog. ")
	b.WriteString("Follow the tool sequence EXACTLY: ")
	b.WriteString("(1) call draft_readonly_sql with the typed {prompt, sql, rationale} you propose; ")
	b.WriteString("(2) call validate_readonly_sql with the same fields to confirm the draft would be accepted by the read-only contract; ")
	b.WriteString("(3) write one rationale sentence and stop. ")
	b.WriteString("Do NOT claim the query was executed — the user reviews the proposal in the AI side panel and clicks the Apply to editor button to copy the draft into the manual SQL editor on /power/sql, then clicks the Run button to execute.")

	// Sort catalog by name for deterministic prompt hashing.
	sorted := append([]SchemaCatalogEntry(nil), catalog...)
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
			cols := append([]SchemaColumn(nil), e.Columns...)
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

// Compile-time assertion: Handler satisfies
// http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the source + validator interfaces declared by
// internal/ai/tools/nl_sql_playground.go. Kept in the same file as
// the handler so the wiring intent is local to the slice.
// ---------------------------------------------------------------------

// nlSqlPlaygroundCuratedCatalog is the narrow read-only table whitelist exposed to the AI.
// Keeping it local makes schema-surface changes reviewable beside the handler and prevents prompt injection from reaching unapproved tables.
var nlSqlPlaygroundCuratedCatalog = []SchemaCatalogEntry{
	{
		Name:        "drives",
		Description: "Per-trip aggregates for completed drives (one row per trip)",
		Columns: []SchemaColumn{
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
		Columns: []SchemaColumn{
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
		Columns: []SchemaColumn{
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
		Columns: []SchemaColumn{
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
		Columns: []SchemaColumn{
			{Name: "vehicle_id", Type: "bigint", Description: "vehicle the signal belongs to"},
			{Name: "signal_name", Type: "text", Description: "canonical signal name (e.g. VehicleSpeed, BatteryLevel)"},
			{Name: "ts", Type: "timestamptz", Description: "sample timestamp UTC"},
			{Name: "num_value", Type: "double precision", Description: "numeric value (SI canonical) — null when the signal is non-numeric"},
			{Name: "str_value", Type: "text", Description: "string value — null when the signal is numeric"},
		},
	},
}

// CuratedCatalog returns the install-wide curated read-only table catalog.
func CuratedCatalog() []SchemaCatalogEntry {
	out := make([]SchemaCatalogEntry, len(nlSqlPlaygroundCuratedCatalog))
	for i, e := range nlSqlPlaygroundCuratedCatalog {
		cols := make([]SchemaColumn, len(e.Columns))
		copy(cols, e.Columns)
		out[i] = SchemaCatalogEntry{
			Name:        e.Name,
			Description: e.Description,
			Columns:     cols,
		}
	}
	return out
}

// SchemaCatalogSourceImpl is the production
// SchemaCatalogSource. It returns the hardcoded
// nlSqlPlaygroundCuratedCatalog whitelist so the AI can never
// propose a query against tables outside the curated set.
//
// No DB query — the catalog is hand-maintained. A future slice
// that needs per-tenant catalog gating can swap this out without
// churning the handler.
type SchemaCatalogSourceImpl struct{}

// NewSchemaCatalogSource constructs the adapter. No deps.
// Returned by-pointer for symmetry with the other AI* source
// types.
func NewSchemaCatalogSource() *SchemaCatalogSourceImpl {
	return &SchemaCatalogSourceImpl{}
}

// SchemaCatalog implements SchemaCatalogSource. Returns a
// defensive copy of the curated catalog so a caller cannot
// retroactively mutate the source-of-truth slice.
func (a *SchemaCatalogSourceImpl) SchemaCatalog(_ context.Context) ([]SchemaCatalogEntry, error) {
	return CuratedCatalog(), nil
}

// Compile-time assertion.
var _ SchemaCatalogSource = (*SchemaCatalogSourceImpl)(nil)

// ---------------------------------------------------------------------
// Production wiring for the nlq.ReadonlySQLValidator interface.
// ---------------------------------------------------------------------

// Validator is the production nlq.ReadonlySQLValidator.
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
type Validator struct{}

// NewValidator constructs the validator. No deps.
// Returned by-pointer for symmetry with the other AI* validator
// types.
func NewValidator() *Validator {
	return &Validator{}
}

// ValidateReadonlySQL implements nlq.ReadonlySQLValidator.
//
// Future-extension hook: add semantic checks here as later
// slices need them. Keeping the body intentionally minimal so
// the slice's mandate ("propose-only, no semantic surprises")
// is locally legible.
func (v *Validator) ValidateReadonlySQL(draft *nlq.ReadonlySQLDraft) error {
	if draft == nil {
		return errors.New("ainlsql nl-sql-playground: nil ReadonlySQLDraft")
	}
	return nil
}

// Compile-time assertion.
var _ nlq.ReadonlySQLValidator = (*Validator)(nil)

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

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}
