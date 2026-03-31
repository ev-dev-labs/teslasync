package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AlertHandler handles alert and alert rule HTTP requests.
type AlertHandler struct {
	alertRepo     *database.AlertRepo
	alertRuleRepo *database.AlertRuleRepo
}

func NewAlertHandler(db *database.DB) *AlertHandler {
	return &AlertHandler{
		alertRepo:     database.NewAlertRepo(db),
		alertRuleRepo: database.NewAlertRuleRepo(db),
	}
}

func (h *AlertHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	alerts, err := h.alertRepo.GetAll(r.Context(), limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list alerts")
		writeError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	if alerts == nil {
		alerts = []*models.Alert{}
	}
	writeJSON(w, http.StatusOK, alerts)
}

func (h *AlertHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "alertID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	if err := h.alertRepo.MarkRead(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to mark alert read")
		writeError(w, http.StatusInternalServerError, "failed to mark alert read")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *AlertHandler) ListRules(w http.ResponseWriter, r *http.Request) {
	rules, err := h.alertRuleRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list alert rules")
		writeError(w, http.StatusInternalServerError, "failed to list alert rules")
		return
	}
	if rules == nil {
		rules = []*models.AlertRule{}
	}
	writeJSON(w, http.StatusOK, rules)
}

func (h *AlertHandler) UpdateRule(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "ruleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid rule ID")
		return
	}

	var body struct {
		Enabled   bool    `json:"enabled"`
		Threshold float64 `json:"threshold"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.alertRuleRepo.Update(r.Context(), id, body.Enabled, body.Threshold); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update alert rule")
		writeError(w, http.StatusInternalServerError, "failed to update alert rule")
		return
	}

	rule, err := h.alertRuleRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to fetch updated alert rule")
		writeError(w, http.StatusInternalServerError, "rule updated but failed to retrieve")
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (h *AlertHandler) CreateRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string  `json:"name"`
		Type      string  `json:"type"`
		Enabled   bool    `json:"enabled"`
		Threshold float64 `json:"threshold"`
		Severity  string  `json:"severity"`
		VehicleID *int64  `json:"vehicle_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" || body.Type == "" {
		writeError(w, http.StatusBadRequest, "name and type are required")
		return
	}

	validTypes := map[string]bool{
		"battery_low": true, "battery_high": true, "speed_limit": true,
		"geofence_exit": true, "geofence_enter": true,
		"charge_complete": true, "charge_started": true,
		"drive_started": true, "drive_ended": true,
		"sentry_event": true, "vehicle_offline": true,
		"vampire_drain": true, "tire_pressure_low": true,
		// System component alerts
		"system_database": true, "system_mqtt": true, "system_redis": true,
		"system_tesla_api": true, "system_worker": true,
	}
	if !validTypes[body.Type] {
		writeError(w, http.StatusBadRequest, "invalid alert type")
		return
	}
	validSeverity := map[string]bool{"low": true, "medium": true, "high": true, "critical": true}
	if body.Severity != "" && !validSeverity[body.Severity] {
		writeError(w, http.StatusBadRequest, "severity must be low, medium, high, or critical")
		return
	}
	if body.Threshold < 0 || body.Threshold > 100000 {
		writeError(w, http.StatusBadRequest, "threshold must be between 0 and 100000")
		return
	}
	if len(body.Name) > 200 {
		writeError(w, http.StatusBadRequest, "name must be 200 characters or less")
		return
	}

	rule := &models.AlertRule{
		Name:      body.Name,
		Type:      body.Type,
		Enabled:   body.Enabled,
		Threshold: body.Threshold,
	}
	if body.VehicleID != nil {
		rule.VehicleID = body.VehicleID
	}

	if err := h.alertRuleRepo.Create(r.Context(), rule); err != nil {
		log.Error().Err(err).Msg("failed to create alert rule")
		writeError(w, http.StatusInternalServerError, "failed to create alert rule")
		return
	}

	writeJSON(w, http.StatusCreated, rule)
}

func (h *AlertHandler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "ruleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid rule ID")
		return
	}

	if err := h.alertRuleRepo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete alert rule")
		writeError(w, http.StatusInternalServerError, "failed to delete alert rule")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
