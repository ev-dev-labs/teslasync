package aiautoname

// G1 Auto-name unnamed locations.
//
// POST /api/v1/ai/locations/{locationID}/name/draft streams a propose-only location-name draft. The AI-gated route validates locationID before opening SSE, never persists changes, and leaves the deterministic /locations baseline untouched.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	autonameunnamedlocations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/auto-name-unnamed-locations"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/location"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft-then-validate-then-answer
// (with optional retries) — a hard ceiling of 6 is generous. Mirrors
// aiAutoTripNamingMaxIterations.
const maxIterations = 6

// Handler is the HTTP handler for
// POST /api/v1/ai/locations/{locationID}/name/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry: AI provider registry (decorator chain already applied).
// toolReg: process-wide tool registry. MUST contain
//
//	draft_location_name AND validate_location_name (both
//	registered by location.RegisterAutoNameUnnamedLocationsTools
//	in router.go).
//
// strat: the auto-name-unnamed-locations Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aiautoname: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aiautoname: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aiautoname: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseURL extracts and validates the
// locationID URL parameter. Pulled out so the off-mode test and the
// validator-only test can exercise the same parsing without
// constructing a full handler with stub deps. The function writes a
// 400 on failure and returns the (id, ok) pair so the caller can
// early-return.
//
// locationID MUST be a positive integer; zero or negative values are
// rejected with a 400.
func parseURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "locationID")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "locationID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("locationID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "locationID must be > 0")
		return 0, false
	}
	return id, true
}

// denyAllConfirm is the dispatcher's user-confirm hook. Auto-name unnamed
// locations declares only propose-only tools, so this should never be called;
// if a future edit accidentally adds a mutating tool, fail closed instead of
// mutating fleet state.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ServeHTTP implements [http.Handler]. The locationID is parsed
// from the URL, the dispatcher is invoked, and the SSE stream is
// closed via the dispatcher's deferred WriteDone. Every error path
// either writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate URL parameters. Body is intentionally
	// ignored; this endpoint takes its only input from the URL.
	locationID, ok := parseURL(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), autonameunnamedlocations.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai auto-name-unnamed-locations: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, autonameunnamedlocations.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(autonameunnamedlocations.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai auto-name-unnamed-locations: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, autonameunnamedlocations.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai auto-name-unnamed-locations: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Auto-name-unnamed-locations
	// is NOT conversational — there is no chat history. We hand
	// the LLM a deterministic prompt that asks it to call the two
	// propose-only tools and narrate the result.
	userMsg := fmt.Sprintf(
		"Propose a concise human-readable name for visited location %d. "+
			"Call draft_location_name FIRST with the location_id and your proposed name, then call "+
			"validate_location_name on the proposal to confirm it satisfies the location-name contract. "+
			"Narrate the result in one or two sentences grounded strictly in the tool replies, "+
			"naming the proposed string and one short rationale that references the location's "+
			"current address_name (when human-readable) or its visit pattern. Remember: you NEVER save anything; "+
			"the user reviews the structured proposal in the UI before clicking Save.",
		locationID,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("location_id", locationID).
			Msg("ai auto-name-unnamed-locations: dispatcher returned error")
	}
}

// Compile-time assertion: Handler
// satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interfaces declared by
// internal/ai/tools/auto_name_unnamed_locations.go. Kept in the same
// file as the handler so the wiring intent is local to the slice;
// mirrors the auto-trip-naming AITripSourceAdapter / AITripNameValidator
// pattern.
// ---------------------------------------------------------------------

// autoNameUnnamedLocationsMaxNameLen mirrors the cap enforced by
// tools.validateLocationNameShape so the production wrapper's verdict
// is byte-equivalent. Pinned by tests on both sides.
const autoNameUnnamedLocationsMaxNameLen = 200

// LocationNameValidator enforces the save-path name shape so AI drafts match canonical validation.
// The empty receiver keeps router wiring substitutable while the rules remain pure.
type LocationNameValidator struct{}

// NewLocationNameValidator constructs the validator.
func NewLocationNameValidator() *LocationNameValidator {
	return &LocationNameValidator{}
}

// ValidateLocationName implements location.LocationNameValidator.
// Rules:
//
// - rune-trimmed name must be 1-200 chars;
// - no control characters (Unicode category Cc) anywhere;
// - leading / trailing whitespace is rejected.
//
// The loc argument is currently unused by the validator — the rule
// is shape-only — but kept on the interface so a future per-location
// rule (e.g. "name must not equal another geofence's name on the
// same vehicle") can be added without rewiring callers.
func (v *LocationNameValidator) ValidateLocationName(_ *geomodel.VisitedLocation, proposed string) error {
	if proposed == "" {
		return errors.New("location name must not be empty")
	}
	if strings.TrimSpace(proposed) == "" {
		return errors.New("location name must contain at least one non-whitespace character")
	}
	if proposed[0] == ' ' || proposed[0] == '\t' ||
		proposed[len(proposed)-1] == ' ' || proposed[len(proposed)-1] == '\t' {
		return errors.New("location name must not have leading or trailing whitespace")
	}
	runes := []rune(proposed)
	if len(runes) > autoNameUnnamedLocationsMaxNameLen {
		return errors.New("location name must be at most 200 characters")
	}
	for _, r := range runes {
		if unicode.IsControl(r) {
			return errors.New("location name must not contain control characters")
		}
	}
	return nil
}

// LocationSource reads the same derived drives aggregate served by /api/v1/locations; no write path is invoked.
// visited_locations no longer exists, so the synthetic locationID is the MIN(d.id) for each (vehicle_id, end_place) group, matching the list rows the SPA already carries.
// The constructor panics on nil DB so wiring bugs fail at boot.
type LocationSource struct {
	db *database.DB
}

// NewLocationSource constructs the adapter. Panics on a nil DB so
// a wiring mistake surfaces at boot rather than as a nil-deref on
// first AI request.
func NewLocationSource(db *database.DB) *LocationSource {
	if db == nil {
		panic("aiautoname: NewLocationSource: nil *database.DB")
	}
	return &LocationSource{db: db}
}

// LoadVisitedLocation implements location.LocationSource. Returns
// (nil, nil) when no aggregate matches the synthetic locationID;
// any other error is propagated. The query mirrors
// VisitedLocationRepo.deriveFromDrives's GROUP BY + aggregate
// shape, then constrains the HAVING clause to the row whose
// MIN(d.id) == locationID, which is at most one row.
//
// The error text is suitable for surfacing to the LLM (it'll be
// relayed back as a tool error reply).
func (a *LocationSource) LoadVisitedLocation(ctx context.Context, locationID int64) (*geomodel.VisitedLocation, error) {
	const q = `WITH anchor AS (
			SELECT vehicle_id, end_place
			FROM drives
			WHERE id = $1
			  AND ended_at IS NOT NULL
			  AND end_place IS NOT NULL
			  AND end_place != ''
		)
		SELECT MIN(d.id) AS id,
			d.vehicle_id,
			d.end_place,
			COUNT(*) AS visit_count,
			COALESCE(SUM(d.duration_s), 0) AS total_duration_s,
			MAX(d.ended_at) AS last_visited,
			MIN(d.started_at) AS first_visited
		FROM drives d
		JOIN anchor a ON a.vehicle_id = d.vehicle_id AND a.end_place = d.end_place
		WHERE d.ended_at IS NOT NULL
		  AND d.end_place IS NOT NULL
		  AND d.end_place != ''
		GROUP BY d.vehicle_id, d.end_place`

	row := a.db.Pool.QueryRow(ctx, q, locationID)
	loc := &geomodel.VisitedLocation{}
	var firstVisited time.Time
	if err := row.Scan(
		&loc.ID,
		&loc.VehicleID,
		&loc.AddressName,
		&loc.VisitCount,
		&loc.TotalDurationS,
		&loc.LastVisited,
		&firstVisited,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("api ai auto-name-unnamed-locations: load visited-location %d: %w", locationID, err)
	}
	loc.CreatedAt = firstVisited
	return loc, nil
}

// Compile-time assertions: the adapters satisfy the tool ports.
var (
	_ location.LocationSource        = (*LocationSource)(nil)
	_ location.LocationNameValidator = (*LocationNameValidator)(nil)
)
