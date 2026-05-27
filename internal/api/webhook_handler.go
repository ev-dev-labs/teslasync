package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
)

// WebhookHandler handles inbound webhook requests from external systems
// such as Home Assistant, IFTTT, and Node-RED.
type WebhookHandler struct{}

func NewWebhookHandler() *WebhookHandler {
	return &WebhookHandler{}
}

// InboundWebhook accepts external events and creates alerts or triggers actions.
func (h *WebhookHandler) InboundWebhook(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Event    string                 `json:"event"` // "alert", "command", "note"
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
		log.Warn().
			Str("title", payload.Title).
			Str("severity", payload.Severity).
			Str("message", payload.Message).
			Str("vehicle", payload.Vehicle).
			Msg("webhook: external alert received")
		writeJSON(w, http.StatusCreated, map[string]interface{}{"status": "alert_logged"})

	case "note":
		log.Info().Str("title", payload.Title).Str("message", payload.Message).Msg("webhook: note received")
		writeJSON(w, http.StatusOK, map[string]string{"status": "noted"})

	default:
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "received", "event": payload.Event})
	}
}
