package api

import (
	"context"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// onboardingTokenReader is the narrow surface OnboardingHandler needs
// from a TokenRepo (or test fake). Defined here so unit tests can
// stub the dependency without spinning up Postgres.
type onboardingTokenReader interface {
	Get(ctx context.Context) (*models.Token, error)
}

// onboardingStatusReader mirrors the database-derived portion of the
// status. The concrete *database.OnboardingRepo satisfies it.
type onboardingStatusReader interface {
	Get(ctx context.Context) (*database.OnboardingStatus, error)
}

// OnboardingHandler reports whether the install has completed the
// three first-run setup steps:
//
//  1. A Tesla OAuth token is stored locally (account is connected).
//  2. At least one vehicle row exists in the local fleet.
//  3. Telemetry has been received within the last 24 hours.
//
// The frontend "first-run gate" polls this endpoint and routes the
// user into <OnboardingPage> until is_complete flips to true.
type OnboardingHandler struct {
	tokens onboardingTokenReader
	repo   onboardingStatusReader
}

// NewOnboardingHandler constructs the handler with the production
// dependencies. The optional encryptor is forwarded to TokenRepo so
// the stored OAuth token can be decrypted before the existence check
// — though for "is the account connected" all we actually need is
// presence, not contents.
func NewOnboardingHandler(db *database.DB, enc ...*crypto.Encryptor) *OnboardingHandler {
	var e *crypto.Encryptor
	if len(enc) > 0 {
		e = enc[0]
	}
	return &OnboardingHandler{
		tokens: database.NewTokenRepo(db, e),
		repo:   database.NewOnboardingRepo(db),
	}
}

// onboardingStatusResponse is the JSON shape exposed at
// GET /api/v1/onboarding/status. Field names use snake_case to match
// the rest of the v1 contract.
type onboardingStatusResponse struct {
	TeslaConnected bool `json:"tesla_connected"`
	VehicleCount   int  `json:"vehicle_count"`
	DataFlowing    bool `json:"data_flowing"`
	IsComplete     bool `json:"is_complete"`
}

// Status reports the three first-run anchors. It deliberately returns
// 200 even when individual checks fail in unexpected ways — falling
// back to "not connected / no vehicles / no data" — so the frontend
// gate keeps working when, for example, the tokens table is missing
// during a first-boot race. Hard infrastructure errors are still
// surfaced as 500 so operators see them in the dashboard.
func (h *OnboardingHandler) Status(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	teslaConnected := false
	if token, err := h.tokens.Get(ctx); err != nil {
		log.Warn().Err(err).Msg("onboarding: token lookup failed")
	} else if token != nil && token.AccessToken != "" {
		teslaConnected = true
	}

	dbStatus, err := h.repo.Get(ctx)
	if err != nil {
		log.Error().Err(err).Msg("onboarding: status query failed")
		writeError(w, http.StatusInternalServerError, "failed to read onboarding status")
		return
	}

	resp := onboardingStatusResponse{
		TeslaConnected: teslaConnected,
		VehicleCount:   dbStatus.VehicleCount,
		DataFlowing:    dbStatus.DataFlowing,
	}
	resp.IsComplete = resp.TeslaConnected && resp.VehicleCount > 0 && resp.DataFlowing

	writeJSON(w, http.StatusOK, resp)
}
