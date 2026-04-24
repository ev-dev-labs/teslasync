package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SettingsHandler handles user settings.
type SettingsHandler struct {
	settingsRepo     *database.SettingsRepo
	db               *database.DB
	telemetryHandler *TelemetryHandler
}

func NewSettingsHandler(db *database.DB) *SettingsHandler {
	return &SettingsHandler{settingsRepo: database.NewSettingsRepo(db), db: db}
}

// SetTelemetryHandler allows the settings handler to sync capture toggle changes.
func (h *SettingsHandler) SetTelemetryHandler(th *TelemetryHandler) {
	h.telemetryHandler = th
}

func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	s, err := h.settingsRepo.Get(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get settings")
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var s models.Settings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate allowed values
	validUnitsLen := map[string]bool{"km": true, "mi": true}
	validUnitsTemp := map[string]bool{"C": true, "F": true}
	validUnitsPressure := map[string]bool{"bar": true, "psi": true}
	validRange := map[string]bool{"ideal": true, "rated": true}

	if s.UnitOfLength != "" && !validUnitsLen[s.UnitOfLength] {
		writeError(w, http.StatusBadRequest, "unit_of_length must be 'km' or 'mi'")
		return
	}
	if s.UnitOfTemp != "" && !validUnitsTemp[s.UnitOfTemp] {
		writeError(w, http.StatusBadRequest, "unit_of_temp must be 'C' or 'F'")
		return
	}
	if s.UnitOfPressure != "" && !validUnitsPressure[s.UnitOfPressure] {
		writeError(w, http.StatusBadRequest, "unit_of_pressure must be 'bar' or 'psi'")
		return
	}
	if s.PreferredRange != "" && !validRange[s.PreferredRange] {
		writeError(w, http.StatusBadRequest, "preferred_range must be 'ideal' or 'rated'")
		return
	}
	if s.BaseCostPerKWh < 0 || s.BaseCostPerKWh > 10 {
		writeError(w, http.StatusBadRequest, "base_cost_per_kwh must be between 0 and 10")
		return
	}
	if len(s.Language) > 10 {
		writeError(w, http.StatusBadRequest, "language must be 10 characters or less")
		return
	}

	// Record gas price change in history if price or unit changed
	if s.GasPricePerUnit > 0 {
		oldSettings, _ := h.settingsRepo.Get(r.Context())
		if oldSettings == nil || oldSettings.GasPricePerUnit != s.GasPricePerUnit ||
			oldSettings.GasUnit != s.GasUnit || oldSettings.GasEfficiencyMPG != s.GasEfficiencyMPG {
			// Close previous period
			h.db.Pool.Exec(r.Context(),
				`UPDATE gas_price_history SET effective_to = NOW() WHERE effective_to IS NULL`)
			// Insert new period
			h.db.Pool.Exec(r.Context(),
				`INSERT INTO gas_price_history (price_per_unit, unit, efficiency_mpg, effective_from) VALUES ($1, $2, $3, NOW())`,
				s.GasPricePerUnit, s.GasUnit, s.GasEfficiencyMPG)
		}
	}

	if err := h.settingsRepo.Upsert(r.Context(), &s); err != nil {
		log.Error().Err(err).Msg("failed to update settings")
		writeError(w, http.StatusInternalServerError, "failed to update settings")
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// ToggleAPISuspend toggles the api_suspended flag. POST /api/v1/settings/suspend-api
func (h *SettingsHandler) ToggleAPISuspend(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Suspended bool `json:"suspended"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	s, err := h.settingsRepo.Get(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get settings for suspend toggle")
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	s.APISuspended = body.Suspended

	if err := h.settingsRepo.Upsert(r.Context(), s); err != nil {
		log.Error().Err(err).Msg("failed to toggle api_suspended")
		writeError(w, http.StatusInternalServerError, "failed to update api_suspended")
		return
	}

	log.Info().Bool("api_suspended", body.Suspended).Msg("Tesla API suspension toggled")
	writeJSON(w, http.StatusOK, map[string]bool{"api_suspended": body.Suspended})
}

// GetPollingConfig returns the current polling endpoint configuration.
// Per-vehicle polling tuning now lives in the `polling_config` table;
// this endpoint returns a backward-compatible LegacyPollingConfig with
// all endpoints enabled (default safe state).
func (h *SettingsHandler) GetPollingConfig(w http.ResponseWriter, r *http.Request) {
	pc := models.DefaultPollingConfig()
	writeJSON(w, http.StatusOK, pc)
}

// UpdatePollingConfig accepts a polling configuration update.
// Per-vehicle polling tuning now lives in the `polling_config` table;
// this is a no-op that returns the default config.
func (h *SettingsHandler) UpdatePollingConfig(w http.ResponseWriter, r *http.Request) {
	var pc models.LegacyPollingConfig
	if err := json.NewDecoder(r.Body).Decode(&pc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	log.Info().Interface("polling_config", pc).Msg("polling config updated (legacy no-op)")

	writeJSON(w, http.StatusOK, pc)
}
