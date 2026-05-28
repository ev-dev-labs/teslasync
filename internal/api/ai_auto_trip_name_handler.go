package api

// Phase-50 / 0024 — D4 Auto trip naming.
//
// ai_auto_trip_name_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/trips/{tripID}/name/draft. The flow mirrors the
// route-efficiency-suggestions / speed-profile-insights / drive-coaching
// narration handlers — same dispatch+stream loop, no persistence
// (one-shot proposal; no conversation to record):
//
//	URL  /api/v1/ai/trips/{tripID}/name/draft
//	  ↓
//	resolve provider via *provider.Registry.For("auto-trip-naming")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("auto-trip-naming", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// The tripID URL param is parsed + validated as a positive int64
// BEFORE opening the SSE stream so a malformed input surfaces as a
// plain JSON 400 (rather than a streamed error frame the SPA's
// QueryError will struggle to render meaningfully).
//
// There is no JSON body; an empty body is accepted.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic stat cards, KVList of
//     trip metadata, drive list, and manual trip-name field
//     rendered by TripDetailPage at /trips/:id are unchanged.
//     This handler is an OPT-IN add-on; off-mode users never see
//     it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("auto-trip-naming").
//   - I9 redaction:       PolicyAutoTripNaming (allows
//     ClassVehicleName only; lat/long, addresses, and place names
//     stay tagged) is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	autotripnaming "github.com/ev-dev-labs/teslasync/internal/ai/strategies/auto-trip-naming"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/trip"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// aiAutoTripNamingMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most draft-then-validate-then-answer (with
// optional retries) — a hard ceiling of 6 is generous. Mirrors
// aiRouteEfficiencySuggestionsMaxIterations.
const aiAutoTripNamingMaxIterations = 6

// AIAutoTripNameHandler is the HTTP handler for
// POST /api/v1/ai/trips/{tripID}/name/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIAutoTripNameHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIAutoTripNameHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_trip_name AND validate_trip_name (both registered by
//	trip.RegisterAutoTripNamingTools in router.go).
//
// strat:      the auto-trip-naming Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIAutoTripNameHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIAutoTripNameHandler {
	switch {
	case registry == nil:
		panic("api: NewAIAutoTripNameHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIAutoTripNameHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIAutoTripNameHandler: nil strategy.Strategy")
	}
	return &AIAutoTripNameHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiAutoTripNamingMaxIterations,
	}
}

// parseAutoTripNameURL extracts and validates the tripID URL
// parameter. Pulled out so the off-mode test and the validator-only
// test can exercise the same parsing without constructing a full
// handler with stub deps. The function writes a 400 on failure and
// returns the (id, ok) pair so the caller can early-return.
//
// tripID MUST be a positive integer; zero or negative values are
// rejected with a 400.
func parseAutoTripNameURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "tripID")
	if raw == "" {
		writeError(w, http.StatusBadRequest, "tripID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("tripID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		writeError(w, http.StatusBadRequest, "tripID must be > 0")
		return 0, false
	}
	return id, true
}

// ServeHTTP implements [http.Handler]. The tripID is parsed from the
// URL, the dispatcher is invoked, and the SSE stream is closed via
// the dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the writer
// has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIAutoTripNameHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate URL parameters. Body is intentionally
	// ignored; this endpoint takes its only input from the URL.
	tripID, ok := parseAutoTripNameURL(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back
	// gracefully.
	if _, err := h.registry.For(r.Context(), autotripnaming.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai auto-trip-naming: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, autotripnaming.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(autotripnaming.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai auto-trip-naming: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, autotripnaming.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai auto-trip-naming: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Auto-trip-naming is NOT
	// conversational — there is no chat history. We hand the LLM
	// a deterministic prompt that asks it to call the two
	// propose-only tools and narrate the result.
	userMsg := fmt.Sprintf(
		"Propose a concise human-readable name for trip %d. "+
			"Call draft_trip_name FIRST with the trip_id and your proposed name, then call "+
			"validate_trip_name on the proposal to confirm it satisfies the trip-name contract. "+
			"Narrate the result in one or two sentences grounded strictly in the tool replies, "+
			"naming the proposed string and one short rationale that references the trip's "+
			"start_place/end_place pair or time window. Remember: you NEVER save anything; "+
			"the user reviews the structured proposal in the UI before clicking Save.",
		tripID,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("trip_id", tripID).
			Msg("ai auto-trip-naming: dispatcher returned error")
	}
}

// Compile-time assertion: AIAutoTripNameHandler satisfies http.Handler.
var _ http.Handler = (*AIAutoTripNameHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interfaces declared by
// internal/ai/tools/auto_trip_naming.go. Kept in the same file as the
// handler so the wiring intent is local to the slice; mirrors the
// nl-alert-builder slice's AIAlertRuleValidator pattern.
// ---------------------------------------------------------------------

// autoTripNameMaxNameLen mirrors the cap enforced by
// tools.validateTripNameShape so the production wrapper's verdict is
// byte-equivalent. Pinned by tests on both sides.
const autoTripNameMaxNameLen = 200

// AITripNameValidator is the production trip.TripNameValidator. It
// enforces the same trimming + length + control-character rules that
// the future canonical trip-update handler will enforce, so a draft
// accepted by the AI tool is byte-equivalent to a draft accepted by
// the canonical save handler.
//
// The struct is intentionally empty — the validator is a pure
// function. The receiver is kept so the production wiring is a
// noun ("the validator") in router.go and tests can substitute a
// fake by satisfying the trip.TripNameValidator interface.
type AITripNameValidator struct{}

// NewAITripNameValidator constructs the validator.
func NewAITripNameValidator() *AITripNameValidator {
	return &AITripNameValidator{}
}

// ValidateTripName implements trip.TripNameValidator. Rules:
//
//   - rune-trimmed name must be 1-200 chars;
//   - no control characters (Unicode category Cc) anywhere;
//   - leading / trailing whitespace is rejected.
//
// The trip argument is currently unused by the validator — the rule
// is shape-only — but kept on the interface so a future per-trip rule
// (e.g. "name must not equal another trip's name on the same
// vehicle") can be added without rewiring callers.
func (v *AITripNameValidator) ValidateTripName(_ *models.Trip, proposed string) error {
	if proposed == "" {
		return errors.New("trip name must not be empty")
	}
	if strings.TrimSpace(proposed) == "" {
		return errors.New("trip name must contain at least one non-whitespace character")
	}
	if proposed[0] == ' ' || proposed[0] == '\t' ||
		proposed[len(proposed)-1] == ' ' || proposed[len(proposed)-1] == '\t' {
		return errors.New("trip name must not have leading or trailing whitespace")
	}
	runes := []rune(proposed)
	if len(runes) > autoTripNameMaxNameLen {
		return errors.New("trip name must be at most 200 characters")
	}
	for _, r := range runes {
		if unicode.IsControl(r) {
			return errors.New("trip name must not contain control characters")
		}
	}
	return nil
}

// AITripSourceAdapter wires *database.TripRepo into the
// trip.TripSource interface. Since TripRepo does not have a
// GetByID method (the existing baseline reads trip header via the
// detail repo's GetTrip), the adapter delegates to the detail repo
// and projects the *database.TripDetail header onto a *models.Trip.
//
// Kept as a thin adapter rather than adding a method to TripRepo
// because Phase-48's SI canonical guidance steers new reads through
// existing repos; mirroring the detail repo here keeps the AI
// surface dependency on a single trip read path.
type AITripSourceAdapter struct {
	details *database.TripsDetailRepo
}

// NewAITripSourceAdapter constructs the adapter. Panics on nil so a
// wiring mistake surfaces at boot.
func NewAITripSourceAdapter(details *database.TripsDetailRepo) *AITripSourceAdapter {
	if details == nil {
		panic("api: NewAITripSourceAdapter: nil *database.TripsDetailRepo")
	}
	return &AITripSourceAdapter{details: details}
}

// GetTripByID implements trip.TripSource. Returns (nil, nil) if the
// detail repo reports ErrTripNotFound; any other error is propagated.
// The projection copies only the fields the validator + draft
// builder actually consume — the full TripDetail aggregate is read
// once anyway by the detail tool path.
func (a *AITripSourceAdapter) GetTripByID(ctx context.Context, tripID int64) (*models.Trip, error) {
	detail, err := a.details.GetTrip(ctx, tripID)
	if err != nil {
		if errors.Is(err, database.ErrTripNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if detail == nil {
		return nil, nil
	}
	trip := &models.Trip{
		ID:        detail.ID,
		VehicleID: detail.VehicleID,
		StartedAt: detail.StartedAt,
		EndedAt:   detail.EndedAt,
	}
	if detail.Name != nil {
		trip.Name = *detail.Name
	}
	return trip, nil
}

// Compile-time assertions: the adapters satisfy the tool ports.
var (
	_ trip.TripSource        = (*AITripSourceAdapter)(nil)
	_ trip.TripNameValidator = (*AITripNameValidator)(nil)
)
