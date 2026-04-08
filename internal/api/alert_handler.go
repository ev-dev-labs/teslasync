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
	eventHub      *EventHub
}

func NewAlertHandler(db *database.DB, hub *EventHub) *AlertHandler {
	return &AlertHandler{
		alertRepo:     database.NewAlertRepo(db),
		alertRuleRepo: database.NewAlertRuleRepo(db),
		eventHub:      hub,
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
		Name           string          `json:"name"`
		Type           string          `json:"type"`
		Enabled        bool            `json:"enabled"`
		Threshold      float64         `json:"threshold"`
		Severity       string          `json:"severity"`
		VehicleID      *int64          `json:"vehicle_id"`
		Conditions     json.RawMessage `json:"conditions"`
		CooldownMin    int             `json:"cooldown_min"`
		MsgTemplate    string          `json:"msg_template"`
		NotifyChannels []int64         `json:"notify_channels"`
		Tags           []string        `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.Type == "" {
		body.Type = "custom"
	}
	if body.Severity == "" {
		body.Severity = "warning"
	}
	if body.CooldownMin <= 0 {
		body.CooldownMin = 15
	}
	if len(body.Name) > 200 {
		writeError(w, http.StatusBadRequest, "name must be 200 characters or less")
		return
	}

	rule := &models.AlertRule{
		Name:           body.Name,
		Type:           body.Type,
		Enabled:        body.Enabled,
		Threshold:      body.Threshold,
		Conditions:     body.Conditions,
		CooldownMin:    body.CooldownMin,
		Severity:       body.Severity,
		MsgTemplate:    body.MsgTemplate,
		NotifyChannels: body.NotifyChannels,
		Tags:           body.Tags,
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

// TestRule fires a test alert for a rule — creates a test alert in DB and broadcasts via SSE.
func (h *AlertHandler) TestRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Severity    string `json:"severity"`
		MsgTemplate string `json:"msg_template"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		body.Name = "Test Rule"
	}
	if body.Severity == "" {
		body.Severity = "info"
	}
	message := body.MsgTemplate
	if message == "" {
		message = "This is a test notification from Alert Studio"
	}

	// Create test alert in DB
	alert := &models.Alert{
		Type:     "test",
		Severity: body.Severity,
		Title:    "[TEST] " + body.Name,
		Message:  message,
	}
	if err := h.alertRepo.Create(r.Context(), alert); err != nil {
		log.Error().Err(err).Msg("failed to create test alert")
		writeError(w, http.StatusInternalServerError, "failed to create test alert")
		return
	}

	// Broadcast via SSE
	if h.eventHub != nil {
		h.eventHub.Broadcast("alert", map[string]interface{}{
			"id":        alert.ID,
			"type":      "test",
			"severity":  body.Severity,
			"title":     "[TEST] " + body.Name,
			"message":   message,
			"timestamp": alert.CreatedAt,
			"is_test":   true,
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "sent",
		"alert":   alert,
		"message": "Test notification sent — check your browser toast and notification channels",
	})
}
