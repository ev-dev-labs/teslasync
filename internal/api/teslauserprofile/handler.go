package teslauserprofile

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/rs/zerolog/log"
)

// Handler serves the Tesla account owner's profile data.
type Handler struct {
	teslaClient *tesla.Client
	profileRepo *tesladb.TeslaUserProfileRepo
}

// NewHandler creates a new handler.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
		teslaClient: tc,
		profileRepo: tesladb.NewTeslaUserProfileRepo(db),
	}
}

// profileEnvelope wraps the profile with sync metadata for the frontend.
type profileEnvelope struct {
	Profile   *teslamodel.TeslaUserProfile `json:"profile"`
	FetchedAt *string                      `json:"fetched_at"`
}

// Profile returns the stored Tesla user profile from DB.
// GET /api/v1/tesla/user/profile
func (h *Handler) Profile(w http.ResponseWriter, r *http.Request) {
	profile, err := h.profileRepo.Get(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to fetch tesla user profile")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch profile")
		return
	}

	env := profileEnvelope{Profile: profile}
	if profile != nil {
		ts := profile.FetchedAt.UTC().Format(time.RFC3339)
		env.FetchedAt = &ts
	}
	httpx.WriteJSON(w, http.StatusOK, env)
}

// RefreshProfile fetches from Tesla API and saves to DB.
// POST /api/v1/tesla/user/profile/refresh
func (h *Handler) RefreshProfile(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing tesla user profile")

	body, status, err := h.teslaClient.GetUserProfile(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla user profile API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Msg("tesla user profile non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, "Tesla API returned non-success status")
		return
	}

	var envelope struct {
		Response struct {
			Email           string  `json:"email"`
			FullName        string  `json:"full_name"`
			ProfileImageURL *string `json:"profile_image_url"`
		} `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Msg("failed to parse tesla user profile response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	profile := &teslamodel.TeslaUserProfile{
		Email:           envelope.Response.Email,
		FullName:        envelope.Response.FullName,
		ProfileImageURL: envelope.Response.ProfileImageURL,
	}
	if err := h.profileRepo.Upsert(r.Context(), profile); err != nil {
		log.Error().Err(err).Msg("failed to save tesla user profile")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save profile")
		return
	}

	// Return the freshly saved data via the standard read path
	h.Profile(w, r)
}
