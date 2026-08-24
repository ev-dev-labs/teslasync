package onboarding

import (
	"context"
	"net/http"
	"time"

	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
)

// onboardingTokenReader is the narrow surface Handler needs
// from a TokenRepo (or test fake). Defined here so unit tests can
// stub the dependency without spinning up Postgres.
type onboardingTokenReader interface {
	Get(ctx context.Context) (*authmodel.Token, error)
}

// onboardingStatusReader mirrors the database-derived portion of the
// status. The concrete *dbuser.OnboardingRepo satisfies it.
type onboardingStatusReader interface {
	Get(ctx context.Context) (*dbuser.OnboardingStatus, error)
}

// onboardingStateReader mirrors the durable-marker read side. The
// concrete *dbuser.OnboardingStateRepo satisfies it.
type onboardingStateReader interface {
	Get(ctx context.Context) (dbuser.OnboardingState, error)
}

// onboardingStateWriter mirrors the durable-marker write side,
// invoked once to persist the ratchet the first time the live
// three-anchor check passes. The concrete *dbuser.OnboardingStateRepo
// satisfies it.
type onboardingStateWriter interface {
	MarkComplete(ctx context.Context) (dbuser.OnboardingState, error)
}

// Handler reports both:
//
//  1. The durable "is this install configured" contract
//     (setup_required / setup_complete): once true, it is NEVER
//     recomputed back to false by runtime signals such as an expired
//     Tesla token or a Fleet Telemetry outage. See
//     [dbuser.OnboardingStateRepo] for the persistence side and
//     migration 000230 for the backfill applied to installations that
//     were already configured before this contract existed.
//
//  2. The live, informational anchors first-run onboarding still uses
//     to decide when to flip the durable marker on for the first time:
//
//  1. A Tesla OAuth token is stored locally (account is connected).
//
//  2. At least one vehicle row exists in the local fleet.
//
//  3. Telemetry has been received within the last 24 hours.
//
// The frontend "first-run gate" polls this endpoint and routes the
// user into <OnboardingPage> until is_complete (an alias of
// setup_complete, kept for backward compatibility) flips to true.
type Handler struct {
	tokens      onboardingTokenReader
	repo        onboardingStatusReader
	state       onboardingStateReader
	stateWriter onboardingStateWriter
}

// NewHandler wires production dependencies; the optional encryptor lets TokenRepo
// read stored OAuth tokens before the connected-account check.
func NewHandler(db *database.DB, enc ...*crypto.Encryptor) *Handler {
	var e *crypto.Encryptor
	if len(enc) > 0 {
		e = enc[0]
	}
	stateRepo := dbuser.NewOnboardingStateRepo(db)
	return &Handler{
		tokens:      dbauth.NewTokenRepo(db, e),
		repo:        dbuser.NewOnboardingRepo(db),
		state:       stateRepo,
		stateWriter: stateRepo,
	}
}

// onboardingStatusResponse is the JSON shape exposed at
// GET /api/v1/onboarding/status. Field names use snake_case to match
// the rest of the v1 contract.
//
// SetupComplete/SetupRequired are the durable contract (see the
// Handler doc comment) — SetupRequired is simply !SetupComplete,
// exposed as its own field so the frontend never has to invert it.
// IsComplete is kept, verbatim equal to SetupComplete, purely for
// backward compatibility with the existing frontend gate
// (web/src/api/hooks/useOnboarding.ts) which already reads it.
//
// TelemetryHealth is informational only ("healthy" | "stale" |
// "unknown") — it does NOT gate SetupComplete/IsComplete. "unknown"
// covers both "no vehicles yet" and "no telemetry ever received";
// "stale" mirrors DataFlowing=false with a prior signal on record
// (i.e. beyond OnboardingRepo.Get's 24h freshness window); "healthy"
// mirrors DataFlowing=true. This is a display/diagnostic hint for the
// onboarding gate, not an alerting signal — see internal/app's health
// watchdog for the shorter, notification-triggering pipeline check.
type onboardingStatusResponse struct {
	TeslaConnected  bool       `json:"tesla_connected"`
	VehicleCount    int        `json:"vehicle_count"`
	DataFlowing     bool       `json:"data_flowing"`
	LastTelemetryAt *time.Time `json:"last_telemetry_at,omitempty"`
	TelemetryHealth string     `json:"telemetry_health"`
	SetupRequired   bool       `json:"setup_required"`
	SetupComplete   bool       `json:"setup_complete"`
	IsComplete      bool       `json:"is_complete"`
}

// Status reports the three first-run anchors. It deliberately returns
// 200 even when individual checks fail in unexpected ways — falling
// back to "not connected / no vehicles / no data" — so the frontend
// gate keeps working when, for example, the tokens table is missing
// during a first-boot race. Hard infrastructure errors are still
// surfaced as 500 so operators see them in the dashboard.
func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.onboarding.status")
	defer span.End()

	teslaConnected := false
	if token, err := h.tokens.Get(ctx); err != nil {
		log.Warn().Err(err).Msg("onboarding: token lookup failed")
	} else if token != nil && token.AccessToken != "" {
		teslaConnected = true
	}

	dbStatus, err := h.repo.Get(ctx)
	if err != nil {
		log.Error().Err(err).Msg("onboarding: status query failed")
		span.RecordError(err)
		span.SetStatus(codes.Error, "onboarding status query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read onboarding status")
		return
	}

	// liveComplete is the pre-existing three-anchor computation, kept
	// verbatim as the trigger for the FIRST observed completion. Once
	// the durable marker is set, liveComplete is no longer consulted —
	// see the ratchet logic below.
	liveComplete := teslaConnected && dbStatus.VehicleCount > 0 && dbStatus.DataFlowing

	state, stateErr := h.state.Get(ctx)
	if stateErr != nil {
		// A durable-state read failure must not route an established
		// token + vehicle installation back to onboarding merely because
		// telemetry is stale. This mirrors migration 000230's backfill
		// predicate and remains pessimistic for genuinely fresh installs.
		log.Warn().Err(stateErr).Msg("onboarding: durable state lookup failed")
		span.RecordError(stateErr)
		state.Completed = teslaConnected && dbStatus.VehicleCount > 0
	}

	setupComplete := state.Completed
	if !setupComplete && liveComplete {
		if newState, markErr := h.stateWriter.MarkComplete(ctx); markErr != nil {
			log.Warn().Err(markErr).Msg("onboarding: failed to persist durable setup completion")
			span.RecordError(markErr)
			// Don't block the user on a transient write failure — this
			// response still reports complete (matching pre-existing
			// live-only behavior); the next successful tick persists it.
			setupComplete = true
		} else {
			setupComplete = newState.Completed
		}
	}

	telemetryHealth := "unknown"
	if dbStatus.VehicleCount > 0 && dbStatus.LastSignalAt != nil {
		if dbStatus.DataFlowing {
			telemetryHealth = "healthy"
		} else {
			telemetryHealth = "stale"
		}
	}

	resp := onboardingStatusResponse{
		TeslaConnected:  teslaConnected,
		VehicleCount:    dbStatus.VehicleCount,
		DataFlowing:     dbStatus.DataFlowing,
		LastTelemetryAt: dbStatus.LastSignalAt,
		TelemetryHealth: telemetryHealth,
		SetupComplete:   setupComplete,
		SetupRequired:   !setupComplete,
		IsComplete:      setupComplete,
	}

	httpx.WriteJSON(w, http.StatusOK, resp)
}
