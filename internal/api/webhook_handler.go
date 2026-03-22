package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// WebhookHandler handles inbound webhook requests from external systems
// such as Home Assistant, IFTTT, and Node-RED.
type WebhookHandler struct {
	alertRepo *database.AlertRepo
	db        *database.DB
}

func NewWebhookHandler(db *database.DB) *WebhookHandler {
	return &WebhookHandler{
		alertRepo: database.NewAlertRepo(db),
		db:        db,
	}
}

// InboundWebhook accepts external events and creates alerts or triggers actions.
func (h *WebhookHandler) InboundWebhook(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Event    string                 `json:"event"`    // "alert", "command", "note"
		Title    string                 `json:"title"`
		Message  string                 `json:"message"`
		Severity string                 `json:"severity"` // info, warning, critical
		Vehicle  string                 `json:"vehicle"`  // VIN or display name (optional)
		Data     map[string]interface{} `json:"data"`     // arbitrary extra data
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if payload.Event == "" {
		writeError(w, http.StatusBadRequest, "event field is required")
		return
	}

	switch payload.Event {
	case "alert":
		if payload.Title == "" {
			payload.Title = "External Alert"
		}
		if payload.Severity == "" {
			payload.Severity = "info"
		}
		alert := &models.Alert{
			Type:     "external_webhook",
			Severity: payload.Severity,
			Title:    payload.Title,
			Message:  payload.Message,
		}
		if err := h.alertRepo.Create(r.Context(), alert); err != nil {
			log.Error().Err(err).Msg("webhook: failed to create alert")
			writeError(w, http.StatusInternalServerError, "failed to create alert")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]interface{}{"status": "alert_created", "id": alert.ID})

	case "note":
		log.Info().Str("title", payload.Title).Str("message", payload.Message).Msg("webhook: note received")
		writeJSON(w, http.StatusOK, map[string]string{"status": "noted"})

	default:
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "received", "event": payload.Event})
	}
}
