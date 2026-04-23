package api

import (
	"encoding/json"
	"net/http"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// AlertHandler handles alert rule CRUD and test-notification HTTP requests.
// Alert firing/listing moved to the notifications subsystem (ADR-010).
type AlertHandler struct {
	alertRuleRepo *database.AlertRuleRepo
	notifRepo     *database.NotificationRepo
	eventHub      *EventHub
	mqttClient    pahomqtt.Client
	signalStore   *signal.Store
}

func NewAlertHandler(db *database.DB, hub *EventHub, mc pahomqtt.Client, store *signal.Store) *AlertHandler {
	return &AlertHandler{
		alertRuleRepo: database.NewAlertRuleRepo(db),
		notifRepo:     database.NewNotificationRepo(db),
		eventHub:      hub,
		mqttClient:    mc,
		signalStore:   store,
	}
}

// List returns recent notification logs. Alert rows migrated to
// notifications (ADR-010 Option B); this endpoint is kept for backward
// compatibility with the frontend /alerts route.
func (h *AlertHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	logs, err := h.notifRepo.GetLogs(r.Context(), limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list notification logs")
		writeError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	if logs == nil {
		logs = []*models.NotificationLog{}
	}
	writeJSON(w, http.StatusOK, logs)
}

// MarkRead is a no-op kept for backward compatibility. The notifications
// table is append-only (ADR-010); "read" status is tracked client-side.
func (h *AlertHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	if _, err := urlParamInt64(r, "alertID"); err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert ID")
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

	// Fetch existing rule so partial updates don't wipe fields
	existing, err := h.alertRuleRepo.GetByID(r.Context(), id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "rule not found")
		return
	}

	var body struct {
		Name        *string  `json:"name"`
		Description *string  `json:"description"`
		Enabled     *bool    `json:"enabled"`
		VehicleID   *int64   `json:"vehicle_id"`
		SignalName  *string  `json:"signal_name"`
		Op          *string  `json:"op"`
		ValueNum    *float64 `json:"value_num"`
		ValueText   *string  `json:"value_text"`
		ValueBool   *bool    `json:"value_bool"`
		ValueMin    *float64 `json:"value_min"`
		ValueMax    *float64 `json:"value_max"`
		Severity    *string  `json:"severity"`
		CooldownMin *int     `json:"cooldown_min"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Merge: only overwrite fields that were sent
	if body.Name != nil {
		existing.Name = *body.Name
	}
	if body.Description != nil {
		existing.Description = body.Description
	}
	if body.Enabled != nil {
		existing.Enabled = *body.Enabled
	}
	if body.VehicleID != nil {
		existing.VehicleID = body.VehicleID
	}
	if body.SignalName != nil {
		existing.SignalName = *body.SignalName
	}
	if body.Op != nil {
		existing.Op = *body.Op
	}
	if body.ValueNum != nil {
		existing.ValueNum = body.ValueNum
	}
	if body.ValueText != nil {
		existing.ValueText = body.ValueText
	}
	if body.ValueBool != nil {
		existing.ValueBool = body.ValueBool
	}
	if body.ValueMin != nil {
		existing.ValueMin = body.ValueMin
	}
	if body.ValueMax != nil {
		existing.ValueMax = body.ValueMax
	}
	if body.Severity != nil {
		existing.Severity = *body.Severity
	}
	if body.CooldownMin != nil {
		existing.CooldownMin = *body.CooldownMin
	}

	if err := h.alertRuleRepo.Update(r.Context(), id, existing); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update alert rule")
		writeError(w, http.StatusInternalServerError, "failed to update alert rule")
		return
	}

	updated, err := h.alertRuleRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to fetch updated alert rule")
		writeError(w, http.StatusInternalServerError, "rule updated but failed to retrieve")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *AlertHandler) CreateRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string   `json:"name"`
		Description *string  `json:"description"`
		Enabled     bool     `json:"enabled"`
		VehicleID   *int64   `json:"vehicle_id"`
		SignalName  string   `json:"signal_name"`
		Op          string   `json:"op"`
		ValueNum    *float64 `json:"value_num"`
		ValueText   *string  `json:"value_text"`
		ValueBool   *bool    `json:"value_bool"`
		ValueMin    *float64 `json:"value_min"`
		ValueMax    *float64 `json:"value_max"`
		Severity    string   `json:"severity"`
		CooldownMin int      `json:"cooldown_min"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.SignalName == "" {
		writeError(w, http.StatusBadRequest, "signal_name is required")
		return
	}
	if body.Op == "" {
		writeError(w, http.StatusBadRequest, "op is required")
		return
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
		Name:        body.Name,
		Description: body.Description,
		Enabled:     body.Enabled,
		VehicleID:   body.VehicleID,
		SignalName:  body.SignalName,
		Op:          body.Op,
		ValueNum:    body.ValueNum,
		ValueText:   body.ValueText,
		ValueBool:   body.ValueBool,
		ValueMin:    body.ValueMin,
		ValueMax:    body.ValueMax,
		Severity:    body.Severity,
		CooldownMin: body.CooldownMin,
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

// TestRule fires a test notification for a rule — creates a notification log
// entry and broadcasts via SSE.
func (h *AlertHandler) TestRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name           string  `json:"name"`
		Severity       string  `json:"severity"`
		Message        string  `json:"message"`
		NotifyChannels []int64 `json:"notify_channels"`
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
	message := body.Message
	if message == "" {
		message = "This is a test notification from Alert Studio"
	}

	// Render template with current signal values from SignalStore
	if h.signalStore != nil {
		for _, vid := range h.signalStore.VehicleIDs() {
			raw := h.signalStore.GetRawMap(vid)
			if raw != nil {
				message = renderTemplate(message, raw)
				break
			}
		}
	}

	title := "[TEST] " + body.Name

	// Create a notification log entry
	nlog := &models.NotificationLog{
		Title:   title,
		Message: message,
		Status:  "sent",
	}
	if err := h.notifRepo.CreateLog(r.Context(), nlog); err != nil {
		log.Error().Err(err).Msg("failed to create test notification log")
		writeError(w, http.StatusInternalServerError, "failed to create test notification")
		return
	}

	// Broadcast via SSE
	if h.eventHub != nil {
		h.eventHub.Broadcast("alert", map[string]interface{}{
			"id":        nlog.ID,
			"type":      "test",
			"severity":  body.Severity,
			"title":     title,
			"message":   message,
			"timestamp": nlog.CreatedAt,
			"is_test":   true,
		})
	}

	// Dispatch to selected notification channels (or all if none specified)
	dispatched := 0
	if len(body.NotifyChannels) > 0 {
		for _, chID := range body.NotifyChannels {
			ch, err := h.notifRepo.GetChannel(r.Context(), chID)
			if err != nil || ch == nil {
				continue
			}
			req := &notification.Request{
				ChannelType: ch.Type,
				Config:      ch.Config,
				Title:       title,
				Message:     message,
				ChannelID:   ch.ID,
			}
			if pubErr := notification.Publish(h.mqttClient, req); pubErr == nil {
				dispatched++
			}
		}
	} else {
		// No channels selected — dispatch to all enabled channels
		channels, err := h.notifRepo.GetAllChannels(r.Context())
		if err == nil {
			for _, ch := range channels {
				if !ch.Enabled {
					continue
				}
				req := &notification.Request{
					ChannelType: ch.Type,
					Config:      ch.Config,
					Title:       title,
					Message:     message,
					ChannelID:   ch.ID,
				}
				if pubErr := notification.Publish(h.mqttClient, req); pubErr == nil {
					dispatched++
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":     "sent",
		"dispatched": dispatched,
		"message":    "Test notification sent — check your browser toast and notification channels",
	})
}
