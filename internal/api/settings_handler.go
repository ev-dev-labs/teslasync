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
	settingsRepo *database.SettingsRepo
}

func NewSettingsHandler(db *database.DB) *SettingsHandler {
	return &SettingsHandler{settingsRepo: database.NewSettingsRepo(db)}
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
	validRange := map[string]bool{"ideal": true, "rated": true}

	if s.UnitOfLength != "" && !validUnitsLen[s.UnitOfLength] {
		writeError(w, http.StatusBadRequest, "unit_of_length must be 'km' or 'mi'")
		return
	}
	if s.UnitOfTemp != "" && !validUnitsTemp[s.UnitOfTemp] {
		writeError(w, http.StatusBadRequest, "unit_of_temp must be 'C' or 'F'")
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

	if err := h.settingsRepo.Upsert(r.Context(), &s); err != nil {
		log.Error().Err(err).Msg("failed to update settings")
		writeError(w, http.StatusInternalServerError, "failed to update settings")
		return
	}
	writeJSON(w, http.StatusOK, s)
}
