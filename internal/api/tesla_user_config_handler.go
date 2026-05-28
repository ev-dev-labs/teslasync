package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// TeslaUserConfigHandler serves Tesla user-level configuration data (feature flags, region).
type TeslaUserConfigHandler struct {
	teslaClient *tesla.Client
	configRepo  *tesladb.TeslaUserConfigRepo
}

// NewTeslaUserConfigHandler creates a new handler.
func NewTeslaUserConfigHandler(tc *tesla.Client, db *database.DB) *TeslaUserConfigHandler {
	return &TeslaUserConfigHandler{
		teslaClient: tc,
		configRepo:  tesladb.NewTeslaUserConfigRepo(db),
	}
}

// configEnvelope wraps stored config data with metadata for the frontend.
type configEnvelope struct {
	Data      json.RawMessage `json:"data"`
	FetchedAt *string         `json:"fetched_at"`
}

// FeatureConfig returns stored feature config from DB.
// GET /api/v1/tesla/user/feature-config
func (h *TeslaUserConfigHandler) FeatureConfig(w http.ResponseWriter, r *http.Request) {
	h.getConfig(w, r, "feature_config")
}

// RefreshFeatureConfig fetches feature config from Tesla and saves to DB.
// POST /api/v1/tesla/user/feature-config/refresh
func (h *TeslaUserConfigHandler) RefreshFeatureConfig(w http.ResponseWriter, r *http.Request) {
	h.refreshConfig(w, r, "feature_config", func() ([]byte, int, error) {
		return h.teslaClient.GetUserFeatureConfig(r.Context())
	})
}

// Region returns stored region from DB.
// GET /api/v1/tesla/user/region
func (h *TeslaUserConfigHandler) Region(w http.ResponseWriter, r *http.Request) {
	h.getConfig(w, r, "region")
}

// RefreshRegion fetches region from Tesla and saves to DB.
// POST /api/v1/tesla/user/region/refresh
func (h *TeslaUserConfigHandler) RefreshRegion(w http.ResponseWriter, r *http.Request) {
	h.refreshConfig(w, r, "region", func() ([]byte, int, error) {
		return h.teslaClient.GetUserRegion(r.Context())
	})
}

// getConfig is a shared helper to return stored config with fetched_at metadata.
func (h *TeslaUserConfigHandler) getConfig(w http.ResponseWriter, r *http.Request, configType string) {
	cfg, err := h.configRepo.GetByType(r.Context(), configType)
	if err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("failed to fetch user config")
		writeError(w, http.StatusInternalServerError, "failed to fetch "+configType)
		return
	}
	if cfg == nil {
		writeJSON(w, http.StatusOK, configEnvelope{
			Data:      json.RawMessage("{}"),
			FetchedAt: nil,
		})
		return
	}
	ts := cfg.FetchedAt.UTC().Format("2006-01-02T15:04:05Z")
	writeJSON(w, http.StatusOK, configEnvelope{
		Data:      json.RawMessage(cfg.Data),
		FetchedAt: &ts,
	})
}

// refreshConfig is a shared helper to fetch from Tesla, unwrap the envelope, persist, and return.
func (h *TeslaUserConfigHandler) refreshConfig(w http.ResponseWriter, r *http.Request, configType string, fetch func() ([]byte, int, error)) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Str("config_type", configType).Msg("refreshing tesla user config")

	body, status, err := fetch()
	if err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("tesla user config API error")
		writeError(w, http.StatusBadGateway, "failed to fetch from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("config_type", configType).Msg("tesla user config non-2xx")
		writeError(w, http.StatusBadGateway, "Tesla API returned non-success status")
		return
	}

	// Unwrap Tesla envelope: {"response": ...}
	var envelope struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("failed to parse tesla response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	data := string(envelope.Response)
	if data == "" || data == "null" {
		data = "{}"
	}

	if err := h.configRepo.Upsert(r.Context(), configType, data); err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("failed to save user config")
		writeError(w, http.StatusInternalServerError, "failed to save "+configType)
		return
	}

	// Return the freshly saved config via the standard getConfig path
	h.getConfig(w, r, configType)
}
