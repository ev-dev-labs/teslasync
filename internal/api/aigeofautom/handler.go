package aigeofautom

// Phase-50 / 0039 — G3 Geofence-aware automation suggestions.
//
// POST /api/v1/ai/geofences/automations/draft mirrors the propose-only
// automation flow, but injects a deterministic geofence catalog so the LLM must
// choose an existing place_id without seeing coordinates. The request is
// validated before SSE starts so malformed input remains a plain JSON 400, and
// guard.Wrap enforces ADR-015 off-mode and per-feature gating before entry.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	geofenceawareautomationsuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/geofence-aware-automation-suggestions"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft-then-validate-then-answer
// (with optional retries) — a hard ceiling of 8 is generous and
// matches the other propose-only N/G-tier handlers.
const maxIterations = 8

// maxBodyBytes caps the JSON body. The
// prompt text is the only non-trivial field; 8 KiB allows a
// reasonably descriptive natural-language request without inviting
// abuse. Mirrors the cap nl-automation-builder uses.
const maxBodyBytes = 1 << 13 // 8 KiB

// maxPromptLen is the rune-length cap on
// the user prompt itself. Below the body cap so a body that is
// mostly padding still bounces. 4096 runes covers every realistic
// natural-language request the AutomationBuilderPage UI surfaces.
const maxPromptLen = 4096

// maxCatalogEntries caps the number of
// geofences the handler injects into the synthesised user message.
// The canonical GeofenceRepo.GetAll already caps at 500 rows; this
// secondary cap protects against catastrophic prompt-bloat if the
// upstream cap is ever raised. Mirrors the in-tool default.
const maxCatalogEntries = 50

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Handler is the HTTP handler for
// POST /api/v1/ai/geofences/automations/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type Handler struct {
	registry     *provider.Registry
	tools        *tools.Registry
	strategy     strategy.Strategy
	geofenceRepo GeofenceLister
	headerName   string
	maxIters     int
}

// GeofenceLister is the narrow read seam the handler depends on so
// tests can substitute a fake. Satisfied by *geofencedb.GeofenceRepo.
//
// Kept narrow on purpose: the handler ONLY needs the existing
// geofence catalog for the synthesised user message; it never
// writes, deletes, or mutates a geofence.
type GeofenceLister interface {
	GetAll(ctx context.Context) ([]*systemmodel.Geofence, error)
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	geofenceRepo *geofencedb.GeofenceRepo,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aigeofautom: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aigeofautom: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aigeofautom: NewHandler: nil strategy.Strategy")
	case geofenceRepo == nil:
		panic("aigeofautom: NewHandler: nil *geofencedb.GeofenceRepo")
	}
	return &Handler{
		registry:     registry,
		tools:        toolReg,
		strategy:     strat,
		geofenceRepo: geofenceRepo,
		headerName:   headerName,
		maxIters:     maxIterations,
	}
}

// request is the wire shape the SPA POSTs.
// vehicle_id and prompt are required; future fields MAY be added
// without changing the off-mode contract.
type request struct {
	// VehicleID is the vehicle the proposed automation will apply
	// to. Required and positive. The handler clamps it before
	// the LLM sees it, so a missing or nonsense ID is a wiring
	// bug rather than a user-facing case.
	VehicleID int64 `json:"vehicle_id"`

	// Prompt is the user's natural-language description of the
	// automation they want. Required, trimmed; rune-length
	// bounded by maxPromptLen.
	Prompt string `json:"prompt"`
}

// parseBody decodes + validates the request
// body. Pulled out so the off-mode test can exercise the parsing
// without constructing a full handler with stub deps. The function
// writes a 400 on failure and returns the (req, ok) pair so the
// caller can early-return.
//
// Rules:
//
//   - body MUST be valid JSON capped at maxBodyBytes;
//   - vehicle_id MUST be a positive integer;
//   - prompt MUST be non-empty after trim and ≤ maxPromptLen runes.
//
// An empty / nil body is REJECTED — the SPA always carries the
// scope; a missing field is a wiring bug, not a default.
func parseBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required (vehicle_id + prompt)")
		return nil, false
	}
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, maxBodyBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return nil, false
	}
	if int64(len(raw)) > maxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("request body exceeds %d bytes", maxBodyBytes))
		return nil, false
	}
	if len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "request body is required (vehicle_id + prompt)")
		return nil, false
	}
	var body request
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		if errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "request body is required (vehicle_id + prompt)")
			return nil, false
		}
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if body.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return nil, false
	}
	body.Prompt = strings.TrimSpace(body.Prompt)
	if body.Prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt must be non-empty")
		return nil, false
	}
	if runes := []rune(body.Prompt); len(runes) > maxPromptLen {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be ≤ %d characters", maxPromptLen))
		return nil, false
	}
	return &body, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// geofence catalog is loaded, the dispatcher is invoked, and the
// SSE stream is closed via the dispatcher's deferred WriteDone.
// Every error path either writes a structured frame onto the SSE
// stream (when the writer has been opened) or a plain JSON 4xx/5xx
// (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the body.
	body, ok := parseBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), geofenceawareautomationsuggestions.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai geofence-aware-automation-suggestions: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Load the geofence catalog. We deliberately load BEFORE
	// opening the SSE stream so a transient DB failure surfaces as
	// a plain JSON 502 (the SPA's QueryError component renders this
	// gracefully) rather than as a half-opened stream the user
	// cannot recover from. The 500-row cap inside
	// GeofenceRepo.GetAll is the primary defence; the secondary
	// in-handler trim caps the LLM prompt at
	// maxCatalogEntries entries.
	geofences, err := h.geofenceRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("ai geofence-aware-automation-suggestions: GeofenceRepo.GetAll failed")
		writeError(w, http.StatusBadGateway, "geofence catalog unavailable")
		return
	}
	catalog := buildCatalogLine(geofences, maxCatalogEntries)

	// 4) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, geofenceawareautomationsuggestions.FeatureID)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(geofenceawareautomationsuggestions.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai geofence-aware-automation-suggestions: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, geofenceawareautomationsuggestions.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai geofence-aware-automation-suggestions: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook —
	// geofence-aware-automation-suggestions has no write tools, so
	// the deny-all confirm path is unreachable in normal operation;
	// defence in depth against a future edit that accidentally adds
	// one.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. The geofence-aware suggester
	// is NOT conversational — there is no chat history. We hand
	// the LLM a deterministic prompt that names the in-scope
	// vehicle, lists the user's existing geofences (id + name +
	// category — NO lat/lon; PolicyAlertBuilder denies coordinate
	// prose), names the user's free-form request, and asks the
	// LLM to call the two propose-only tools in sequence.
	userMsg := fmt.Sprintf(
		"Draft a geofence-aware Automation for vehicle %d. %s "+
			"User request: %q. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call draft_automation_graph FIRST with vehicle_id=%d and a typed graph that uses trigger_geofence (or condition_geofence) referencing exactly one place_id from the catalog above; "+
			"(2) call validate_automation_graph on the SAME envelope so the proposed draft is byte-equivalent to one the canonical typed POST /api/v1/automations handler would accept. "+
			"Narrate the result in 1-2 sentences grounded strictly in the tool reply, naming the geofence by NAME (not coordinates). "+
			"NEVER claim the automation was created, saved, added, or deleted — your role is propose-only; the user reviews the structured draft in the AutomationBuilderPage UI and clicks Apply to form to copy it into the existing baseline form, then SAVES IT THEMSELVES via the canonical POST /api/v1/automations write path.",
		body.VehicleID, catalog, body.Prompt, body.VehicleID,
	)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai geofence-aware-automation-suggestions: dispatcher returned error")
	}
}

// buildCatalogLine renders the geofence catalog as a
// single-line deterministic string the LLM can read and pick
// place_id values from. Sorted by id ASC for byte-stable goldens.
// Capped at maxEntries so a misconfigured deployment with thousands
// of geofences doesn't blow the prompt budget.
//
// Each entry is rendered as `[id=<n> name=<q> category=<c>]` with
// double quotes around the name. Lat/lon are deliberately omitted
// — PolicyAlertBuilder denies every PII class, so emitting
// coordinates here would either leak them past the policy or
// require redaction of the catalog line itself (which would defeat
// its purpose). The LLM only needs id + name + category to pick
// the right place_id; the canonical typed automation handler reads
// the geometry from the database when the saved automation runs.
func buildCatalogLine(geofences []*systemmodel.Geofence, maxEntries int) string {
	if len(geofences) == 0 {
		return "Geofence catalog is empty for this user (no place_ids to reference). Refuse the request politely and explain that the user must add at least one geofence at /geofences before this assistant can propose a geofence-aware automation."
	}
	// Defensive copy so we don't mutate the caller's slice with
	// our sort.
	in := make([]*systemmodel.Geofence, 0, len(geofences))
	for _, g := range geofences {
		if g == nil {
			continue
		}
		in = append(in, g)
	}
	sort.Slice(in, func(i, j int) bool { return in[i].ID < in[j].ID })
	if maxEntries > 0 && len(in) > maxEntries {
		in = in[:maxEntries]
	}
	var b strings.Builder
	b.WriteString("Geofence catalog for this user (use ONLY these place_id values; never invent one): ")
	for i, g := range in {
		if i > 0 {
			b.WriteString(", ")
		}
		category := ""
		if g.Category != nil {
			category = string(*g.Category)
		}
		fmt.Fprintf(&b, "[id=%d name=%q category=%q]", g.ID, g.Name, category)
	}
	b.WriteString(".")
	return b.String()
}

// Compile-time assertion: Handler satisfies
// http.Handler.
var _ http.Handler = (*Handler)(nil)
