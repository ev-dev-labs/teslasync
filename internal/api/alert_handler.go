package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/models"
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

	rule, _ := h.alertRuleRepo.GetByID(r.Context(), id)
	writeJSON(w, http.StatusOK, rule)
}
