package teslauserconfig

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/rs/zerolog/log"
)

// teslaFetchTimeout bounds a single outbound Tesla Fleet API call made
// while refreshing user config. An unbounded call would let a hung Tesla
// edge pin a request goroutine indefinitely; 30s matches the Tesla API
// timeout budget used elsewhere in the codebase.
const teslaFetchTimeout = 30 * time.Second

// teslaConfigClient is the subset of *tesla.Client this handler needs.
// Depending on the port (rather than the concrete client) keeps the
// handler unit-testable without a live Fleet API or OAuth token.
type teslaConfigClient interface {
	HasValidToken() bool
	GetUserFeatureConfig(ctx context.Context) ([]byte, int, error)
	GetUserRegion(ctx context.Context) ([]byte, int, error)
}

// teslaConfigStore is the subset of *tesladb.TeslaUserConfigRepo this
// handler needs — the persistence port for stored config blobs.
type teslaConfigStore interface {
	GetByType(ctx context.Context, configType string) (*teslamodel.TeslaUserConfig, error)
	Upsert(ctx context.Context, configType, data string) error
}

// Compile-time guarantees that the production dependencies still satisfy
// the ports the handler is written against, so an upstream signature
// drift fails the build here rather than at wiring time in router.go.
var (
	_ teslaConfigClient = (*tesla.Client)(nil)
	_ teslaConfigStore  = (*tesladb.TeslaUserConfigRepo)(nil)
)

// Handler serves Tesla user-level configuration data (feature flags, region).
type Handler struct {
	teslaClient teslaConfigClient
	configRepo  teslaConfigStore
}

// NewHandler creates a new handler.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
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
func (h *Handler) FeatureConfig(w http.ResponseWriter, r *http.Request) {
	h.getConfig(w, r, "feature_config")
}

// RefreshFeatureConfig fetches feature config from Tesla and saves to DB.
// POST /api/v1/tesla/user/feature-config/refresh
func (h *Handler) RefreshFeatureConfig(w http.ResponseWriter, r *http.Request) {
	h.refreshConfig(w, r, "feature_config", h.teslaClient.GetUserFeatureConfig)
}

// Region returns stored region from DB.
// GET /api/v1/tesla/user/region
func (h *Handler) Region(w http.ResponseWriter, r *http.Request) {
	h.getConfig(w, r, "region")
}

// RefreshRegion fetches region from Tesla and saves to DB.
// POST /api/v1/tesla/user/region/refresh
func (h *Handler) RefreshRegion(w http.ResponseWriter, r *http.Request) {
	h.refreshConfig(w, r, "region", h.teslaClient.GetUserRegion)
}

// getConfig is a shared helper to return stored config with fetched_at metadata.
func (h *Handler) getConfig(w http.ResponseWriter, r *http.Request, configType string) {
	cfg, err := h.configRepo.GetByType(r.Context(), configType)
	if err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("failed to fetch user config")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch "+configType)
		return
	}
	if cfg == nil {
		httpx.WriteJSON(w, http.StatusOK, configEnvelope{
			Data:      json.RawMessage("{}"),
			FetchedAt: nil,
		})
		return
	}
	// Guard against a blank stored blob: an empty json.RawMessage marshals
	// to invalid JSON and would emit a 200 with a malformed body. The write
	// path already normalises to "{}", but legacy or hand-inserted rows may
	// still be empty.
	data := cfg.Data
	if strings.TrimSpace(data) == "" {
		data = "{}"
	}
	ts := cfg.FetchedAt.UTC().Format("2006-01-02T15:04:05Z")
	httpx.WriteJSON(w, http.StatusOK, configEnvelope{
		Data:      json.RawMessage(data),
		FetchedAt: &ts,
	})
}

// refreshConfig is a shared helper to fetch from Tesla, unwrap the envelope, persist, and return.
func (h *Handler) refreshConfig(w http.ResponseWriter, r *http.Request, configType string, fetch func(ctx context.Context) ([]byte, int, error)) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Str("config_type", configType).Msg("refreshing tesla user config")

	ctx, cancel := context.WithTimeout(r.Context(), teslaFetchTimeout)
	defer cancel()

	body, status, err := fetch(ctx)
	if err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("tesla user config API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("config_type", configType).Msg("tesla user config non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, "Tesla API returned non-success status")
		return
	}

	// Unwrap Tesla envelope: {"response": ...}
	var envelope struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("failed to parse tesla response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	data := string(envelope.Response)
	if data == "" || data == "null" {
		data = "{}"
	}

	if err := h.configRepo.Upsert(r.Context(), configType, data); err != nil {
		log.Error().Err(err).Str("config_type", configType).Msg("failed to save user config")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save "+configType)
		return
	}

	// Return the freshly saved config via the standard getConfig path
	h.getConfig(w, r, configType)
}
