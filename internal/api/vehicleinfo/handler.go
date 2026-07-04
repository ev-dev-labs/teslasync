package vehicleinfo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/rs/zerolog/log"
)

// teslaInfoClient is the slice of *tesla.Client the handler needs to fetch
// per-vehicle account metadata from Tesla's Fleet API. Depending on the
// interface (rather than the concrete client) lets the unit tests inject a
// fake without a live Fleet API connection or partner token.
type teslaInfoClient interface {
	HasValidToken() bool
	GetMobileEnabled(ctx context.Context, vin string) ([]byte, int, error)
	GetVehicleOptions(ctx context.Context, vin string) ([]byte, int, error)
	GetVehicleSpecs(ctx context.Context, vin string) ([]byte, int, error)
	GetSubscriptionEligibility(ctx context.Context, vin string) ([]byte, int, error)
	GetUpgradeEligibility(ctx context.Context, vin string) ([]byte, int, error)
	GetWarrantyDetails(ctx context.Context) ([]byte, int, error)
}

// userConfigStore is the subset of *tesladb.TeslaUserConfigRepo used to read
// and persist the stored metadata blobs.
type userConfigStore interface {
	GetByType(ctx context.Context, configType string) (*teslamodel.TeslaUserConfig, error)
	Upsert(ctx context.Context, configType, data string) error
}

// vehicleFinder is the subset of *vehicledb.VehicleRepo used to resolve a
// vehicle id to its VIN.
type vehicleFinder interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
}

// Handler serves per-vehicle info stored in tesla_user_config:
// mobile_enabled, option codes, and vehicle specs.
type Handler struct {
	teslaClient teslaInfoClient
	configRepo  userConfigStore
	vehicleRepo vehicleFinder
}

// NewHandler wires Tesla account metadata dependencies.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
		teslaClient: tc,
		configRepo:  tesladb.NewTeslaUserConfigRepo(db),
		vehicleRepo: vehicledb.NewVehicleRepo(db),
	}
}

// vehicleInfoEnvelope wraps stored config data with metadata for the frontend.
type vehicleInfoEnvelope struct {
	Data      json.RawMessage `json:"data"`
	FetchedAt *string         `json:"fetched_at"`
}

// resolveVIN maps the {vehicleID} URL param to the vehicle's VIN and the
// HTTP status a caller should surface on failure:
//
//	400 — the param is missing or non-numeric (client error)
//	404 — no vehicle with that id exists
//	500 — the lookup itself failed (database error)
//
// On success it returns the VIN, http.StatusOK, and a nil error.
func (h *Handler) resolveVIN(r *http.Request) (string, int, error) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		return "", http.StatusBadRequest, fmt.Errorf("invalid vehicle ID: %w", err)
	}
	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil {
		return "", http.StatusInternalServerError, fmt.Errorf("fetch vehicle %d: %w", vehicleID, err)
	}
	if vehicle == nil {
		return "", http.StatusNotFound, fmt.Errorf("vehicle %d not found", vehicleID)
	}
	return vehicle.VIN, http.StatusOK, nil
}

// resolveVINOrWriteError resolves the VIN or writes the appropriate error
// response, returning ok=false when the caller should stop. Server-side
// failures are logged with the underlying error but surfaced to the client
// as a generic message so internal details never leak over the wire.
func (h *Handler) resolveVINOrWriteError(w http.ResponseWriter, r *http.Request) (string, bool) {
	vin, status, err := h.resolveVIN(r)
	if err != nil {
		switch status {
		case http.StatusNotFound:
			httpx.WriteError(w, status, "vehicle not found")
		case http.StatusInternalServerError:
			log.Error().Err(err).Msg("failed to resolve vehicle for vehicle-info endpoint")
			httpx.WriteError(w, status, "failed to resolve vehicle")
		default:
			httpx.WriteError(w, status, "invalid vehicle ID")
		}
		return "", false
	}
	return vin, true
}

// ---------- Mobile Enabled ----------

// MobileEnabled returns stored mobile_enabled status from DB.
// GET /api/v1/vehicles/{vehicleID}/mobile-enabled
func (h *Handler) MobileEnabled(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "mobile_enabled:"+vin)
}

// RefreshMobileEnabled fetches mobile_enabled from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/mobile-enabled/refresh
func (h *Handler) RefreshMobileEnabled(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "mobile_enabled:" + vin
	h.refreshVehicleConfig(w, r, configKey, "mobile_enabled", vin, func() ([]byte, int, error) {
		return h.teslaClient.GetMobileEnabled(r.Context(), vin)
	}, false)
}

// ---------- Vehicle Options ----------

// VehicleOptions returns stored option codes from DB.
// GET /api/v1/vehicles/{vehicleID}/options
func (h *Handler) VehicleOptions(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "vehicle_options:"+vin)
}

// RefreshVehicleOptions fetches options from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/options/refresh
func (h *Handler) RefreshVehicleOptions(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "vehicle_options:" + vin
	h.refreshVehicleConfig(w, r, configKey, "vehicle_options", vin, func() ([]byte, int, error) {
		return h.teslaClient.GetVehicleOptions(r.Context(), vin)
	}, false)
}

// ---------- Vehicle Specs ----------

// VehicleSpecs returns stored specs from DB.
// GET /api/v1/vehicles/{vehicleID}/specs
func (h *Handler) VehicleSpecs(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "vehicle_specs:"+vin)
}

// RefreshVehicleSpecs fetches specs from Tesla using a partner token and saves to DB.
// This endpoint costs $0.10 per successful call — a freshness guard prevents
// redundant calls if specs were already fetched within the last 24 hours.
// POST /api/v1/vehicles/{vehicleID}/specs/refresh
func (h *Handler) RefreshVehicleSpecs(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "vehicle_specs:" + vin

	// Freshness guard: reject if already fetched within 24 hours
	existing, err := h.configRepo.GetByType(r.Context(), configKey)
	if err != nil {
		log.Error().Err(err).Str("config_key", configKey).Msg("failed to check specs freshness")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to check specs freshness")
		return
	}
	if existing != nil && time.Since(existing.FetchedAt) < 24*time.Hour {
		log.Warn().
			Str("vin", vin).
			Time("fetched_at", existing.FetchedAt).
			Msg("vehicle specs refresh rejected — already fetched within 24 hours (costs $0.10/call)")
		httpx.WriteError(w, http.StatusTooManyRequests, "specs were already fetched within the last 24 hours — this endpoint costs $0.10 per call")
		return
	}

	log.Warn().Str("vin", vin).Msg("refreshing vehicle specs from Tesla — this call costs $0.10")

	h.refreshVehicleConfig(w, r, configKey, "vehicle_specs", vin, func() ([]byte, int, error) {
		return h.teslaClient.GetVehicleSpecs(r.Context(), vin)
	}, true)
}

// ---------- Subscription Eligibility ----------

// SubscriptionEligibility returns stored subscription eligibility from DB.
// GET /api/v1/vehicles/{vehicleID}/subscriptions
func (h *Handler) SubscriptionEligibility(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "subscriptions:"+vin)
}

// RefreshSubscriptionEligibility fetches subscription eligibility from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/subscriptions/refresh
func (h *Handler) RefreshSubscriptionEligibility(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "subscriptions:" + vin
	h.refreshVehicleConfig(w, r, configKey, "subscriptions", vin, func() ([]byte, int, error) {
		return h.teslaClient.GetSubscriptionEligibility(r.Context(), vin)
	}, false)
}

// ---------- Upgrade Eligibility ----------

// UpgradeEligibility returns stored upgrade eligibility from DB.
// GET /api/v1/vehicles/{vehicleID}/upgrades
func (h *Handler) UpgradeEligibility(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "upgrades:"+vin)
}

// RefreshUpgradeEligibility fetches upgrade eligibility from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/upgrades/refresh
func (h *Handler) RefreshUpgradeEligibility(w http.ResponseWriter, r *http.Request) {
	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "upgrades:" + vin
	h.refreshVehicleConfig(w, r, configKey, "upgrades", vin, func() ([]byte, int, error) {
		return h.teslaClient.GetUpgradeEligibility(r.Context(), vin)
	}, false)
}

// ---------- Warranty Details ----------

// WarrantyDetails returns stored warranty details from DB.
// GET /api/v1/tesla/warranty
func (h *Handler) WarrantyDetails(w http.ResponseWriter, r *http.Request) {
	h.getVehicleConfig(w, r, "warranty")
}

// RefreshWarrantyDetails fetches warranty details from Tesla and saves to DB.
// POST /api/v1/tesla/warranty/refresh
func (h *Handler) RefreshWarrantyDetails(w http.ResponseWriter, r *http.Request) {
	configKey := "warranty"
	h.refreshVehicleConfig(w, r, configKey, "warranty", "", func() ([]byte, int, error) {
		return h.teslaClient.GetWarrantyDetails(r.Context())
	}, false)
}

// ---------- Shared helpers ----------

// getVehicleConfig returns stored per-vehicle config data with fetched_at metadata.
func (h *Handler) getVehicleConfig(w http.ResponseWriter, r *http.Request, configKey string) {
	cfg, err := h.configRepo.GetByType(r.Context(), configKey)
	if err != nil {
		log.Error().Err(err).Str("config_key", configKey).Msg("failed to fetch vehicle config")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch vehicle info")
		return
	}
	if cfg == nil {
		httpx.WriteJSON(w, http.StatusOK, vehicleInfoEnvelope{
			Data:      json.RawMessage("null"),
			FetchedAt: nil,
		})
		return
	}
	ts := cfg.FetchedAt.UTC().Format("2006-01-02T15:04:05Z")
	httpx.WriteJSON(w, http.StatusOK, vehicleInfoEnvelope{
		Data:      json.RawMessage(cfg.Data),
		FetchedAt: &ts,
	})
}

// refreshVehicleConfig fetches from Tesla, processes the response, persists, and returns.
// For mobile_enabled, the Tesla response envelope contains a bare boolean, which is
// wrapped as {"enabled": <bool>} before persisting.
func (h *Handler) refreshVehicleConfig(
	w http.ResponseWriter, r *http.Request,
	configKey, configType, vin string,
	fetch func() ([]byte, int, error),
	isPaidEndpoint bool,
) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Str("config_type", configType).Str("vin", vin).Msg("refreshing vehicle info from Tesla")

	body, status, err := fetch()
	if err != nil {
		log.Error().Err(err).Str("config_type", configType).Str("vin", vin).Msg("tesla vehicle info API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("config_type", configType).Str("vin", vin).Msg("tesla vehicle info non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
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

	// mobile_enabled returns a bare boolean (true/false) — wrap as
	// {"enabled": <bool>}. The empty/null check below runs AFTER this guard,
	// so we must skip wrapping when the response is missing/null; otherwise a
	// blank Tesla response would produce syntactically invalid JSON such as
	// {"enabled":} that later fails to parse on read.
	if configType == "mobile_enabled" && data != "" && data != "null" {
		data = fmt.Sprintf(`{"enabled":%s}`, data)
	}

	if data == "" || data == "null" {
		data = "{}"
	}

	if err := h.configRepo.Upsert(r.Context(), configKey, data); err != nil {
		log.Error().Err(err).Str("config_key", configKey).Msg("failed to save vehicle info")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save vehicle info")
		return
	}

	if isPaidEndpoint {
		log.Info().Str("vin", vin).Str("config_type", configType).Msg("paid Tesla API call completed and persisted")
	}

	h.getVehicleConfig(w, r, configKey)
}
