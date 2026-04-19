package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// VehicleInfoHandler serves per-vehicle info stored in tesla_user_config:
// mobile_enabled, option codes, and vehicle specs.
type VehicleInfoHandler struct {
	teslaClient *tesla.Client
	configRepo  *database.TeslaUserConfigRepo
	vehicleRepo *database.VehicleRepo
}

// NewVehicleInfoHandler creates a new handler.
func NewVehicleInfoHandler(tc *tesla.Client, db *database.DB) *VehicleInfoHandler {
	return &VehicleInfoHandler{
		teslaClient: tc,
		configRepo:  database.NewTeslaUserConfigRepo(db),
		vehicleRepo: database.NewVehicleRepo(db),
	}
}

// vehicleInfoEnvelope wraps stored config data with metadata for the frontend.
type vehicleInfoEnvelope struct {
	Data      json.RawMessage `json:"data"`
	FetchedAt *string         `json:"fetched_at"`
}

// resolveVIN looks up the vehicle VIN from the vehicleID URL param.
func (h *VehicleInfoHandler) resolveVIN(r *http.Request) (string, error) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		return "", fmt.Errorf("invalid vehicle ID: %w", err)
	}
	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil {
		return "", fmt.Errorf("fetch vehicle: %w", err)
	}
	if vehicle == nil {
		return "", fmt.Errorf("vehicle not found")
	}
	return vehicle.VIN, nil
}

// ---------- Mobile Enabled ----------

// MobileEnabled returns stored mobile_enabled status from DB.
// GET /api/v1/vehicles/{vehicleID}/mobile-enabled
func (h *VehicleInfoHandler) MobileEnabled(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.getVehicleConfig(w, r, "mobile_enabled:"+vin)
}

// RefreshMobileEnabled fetches mobile_enabled from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/mobile-enabled/refresh
func (h *VehicleInfoHandler) RefreshMobileEnabled(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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
func (h *VehicleInfoHandler) VehicleOptions(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.getVehicleConfig(w, r, "vehicle_options:"+vin)
}

// RefreshVehicleOptions fetches options from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/options/refresh
func (h *VehicleInfoHandler) RefreshVehicleOptions(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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
func (h *VehicleInfoHandler) VehicleSpecs(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.getVehicleConfig(w, r, "vehicle_specs:"+vin)
}

// RefreshVehicleSpecs fetches specs from Tesla using a partner token and saves to DB.
// This endpoint costs $0.10 per successful call — a freshness guard prevents
// redundant calls if specs were already fetched within the last 24 hours.
// POST /api/v1/vehicles/{vehicleID}/specs/refresh
func (h *VehicleInfoHandler) RefreshVehicleSpecs(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	configKey := "vehicle_specs:" + vin

	// Freshness guard: reject if already fetched within 24 hours
	existing, err := h.configRepo.GetByType(r.Context(), configKey)
	if err != nil {
		log.Error().Err(err).Str("config_key", configKey).Msg("failed to check specs freshness")
		writeError(w, http.StatusInternalServerError, "failed to check specs freshness")
		return
	}
	if existing != nil && time.Since(existing.FetchedAt) < 24*time.Hour {
		log.Warn().
			Str("vin", vin).
			Time("fetched_at", existing.FetchedAt).
			Msg("vehicle specs refresh rejected — already fetched within 24 hours (costs $0.10/call)")
		writeError(w, http.StatusTooManyRequests, "specs were already fetched within the last 24 hours — this endpoint costs $0.10 per call")
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
func (h *VehicleInfoHandler) SubscriptionEligibility(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.getVehicleConfig(w, r, "subscriptions:"+vin)
}

// RefreshSubscriptionEligibility fetches subscription eligibility from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/subscriptions/refresh
func (h *VehicleInfoHandler) RefreshSubscriptionEligibility(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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
func (h *VehicleInfoHandler) UpgradeEligibility(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.getVehicleConfig(w, r, "upgrades:"+vin)
}

// RefreshUpgradeEligibility fetches upgrade eligibility from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/upgrades/refresh
func (h *VehicleInfoHandler) RefreshUpgradeEligibility(w http.ResponseWriter, r *http.Request) {
	vin, err := h.resolveVIN(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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
func (h *VehicleInfoHandler) WarrantyDetails(w http.ResponseWriter, r *http.Request) {
	h.getVehicleConfig(w, r, "warranty")
}

// RefreshWarrantyDetails fetches warranty details from Tesla and saves to DB.
// POST /api/v1/tesla/warranty/refresh
func (h *VehicleInfoHandler) RefreshWarrantyDetails(w http.ResponseWriter, r *http.Request) {
	configKey := "warranty"
	h.refreshVehicleConfig(w, r, configKey, "warranty", "", func() ([]byte, int, error) {
		return h.teslaClient.GetWarrantyDetails(r.Context())
	}, false)
}

// ---------- Shared helpers ----------

// getVehicleConfig returns stored per-vehicle config data with fetched_at metadata.
func (h *VehicleInfoHandler) getVehicleConfig(w http.ResponseWriter, r *http.Request, configKey string) {
	cfg, err := h.configRepo.GetByType(r.Context(), configKey)
	if err != nil {
		log.Error().Err(err).Str("config_key", configKey).Msg("failed to fetch vehicle config")
		writeError(w, http.StatusInternalServerError, "failed to fetch vehicle info")
		return
	}
	if cfg == nil {
		writeJSON(w, http.StatusOK, vehicleInfoEnvelope{
			Data:      json.RawMessage("null"),
			FetchedAt: nil,
		})
		return
	}
	ts := cfg.FetchedAt.UTC().Format("2006-01-02T15:04:05Z")
	writeJSON(w, http.StatusOK, vehicleInfoEnvelope{
		Data:      json.RawMessage(cfg.Data),
		FetchedAt: &ts,
	})
}

// refreshVehicleConfig fetches from Tesla, processes the response, persists, and returns.
// For mobile_enabled, the Tesla response envelope contains a bare boolean, which is
// wrapped as {"enabled": <bool>} before persisting.
func (h *VehicleInfoHandler) refreshVehicleConfig(
	w http.ResponseWriter, r *http.Request,
	configKey, configType, vin string,
	fetch func() ([]byte, int, error),
	isPaidEndpoint bool,
) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Str("config_type", configType).Str("vin", vin).Msg("refreshing vehicle info from Tesla")

	body, status, err := fetch()
	if err != nil {
		log.Error().Err(err).Str("config_type", configType).Str("vin", vin).Msg("tesla vehicle info API error")
		writeError(w, http.StatusBadGateway, "failed to fetch from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("config_type", configType).Str("vin", vin).Msg("tesla vehicle info non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
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

	// mobile_enabled returns a bare boolean (true/false) — wrap as {"enabled": <bool>}
	if configType == "mobile_enabled" {
		data = fmt.Sprintf(`{"enabled":%s}`, data)
	}

	if data == "" || data == "null" {
		data = "{}"
	}

	if err := h.configRepo.Upsert(r.Context(), configKey, data); err != nil {
		log.Error().Err(err).Str("config_key", configKey).Msg("failed to save vehicle info")
		writeError(w, http.StatusInternalServerError, "failed to save vehicle info")
		return
	}

	if isPaidEndpoint {
		log.Info().Str("vin", vin).Str("config_type", configType).Msg("paid Tesla API call completed and persisted")
	}

	h.getVehicleConfig(w, r, configKey)
}
