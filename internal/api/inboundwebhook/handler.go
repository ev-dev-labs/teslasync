package inboundwebhook

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/rs/zerolog/log"
)

const (
	// maxWebhookBodyBytes caps the inbound webhook body. The Data field is a
	// free-form map, so an unauthenticated caller could otherwise stream an
	// unbounded payload straight into the JSON decoder. 64 KiB is generous
	// for alert/note metadata while bounding per-request memory.
	maxWebhookBodyBytes = 64 * 1024

	eventAlert = "alert"
	eventNote  = "note"

	defaultAlertTitle    = "External Alert"
	defaultAlertSeverity = "info"
)

// WebhookHandler handles inbound webhook requests from external systems
// such as Home Assistant, IFTTT, and Node-RED.
type WebhookHandler struct{}

func NewWebhookHandler() *WebhookHandler {
	return &WebhookHandler{}
}

// inboundPayload is the decoded body of an inbound webhook request. The Data
// map intentionally captures arbitrary extra keys so integrations can attach
// vendor-specific fields without a schema change.
type inboundPayload struct {
	Event    string                 `json:"event"`    // "alert", "command", "note"
	Title    string                 `json:"title"`    //
	Message  string                 `json:"message"`  //
	Severity string                 `json:"severity"` // info, warning, critical
	Vehicle  string                 `json:"vehicle"`  // VIN or display name (optional)
	Data     map[string]interface{} `json:"data"`     // arbitrary extra data
}

// webhookResult is the HTTP outcome of classifying a payload. It is produced
// by the pure classify function so the branch/default logic is unit-testable
// without spinning up an HTTP request.
type webhookResult struct {
	status int
	body   map[string]interface{}
}

// classify applies event-specific defaults (mutating p for the alert case so
// callers can log the defaulted title/severity) and returns the response the
// handler should write. It never returns a zero status. The empty-event
// validation is the caller's responsibility and happens before classify.
func classify(p *inboundPayload) webhookResult {
	switch p.Event {
	case eventAlert:
		if p.Title == "" {
			p.Title = defaultAlertTitle
		}
		if p.Severity == "" {
			p.Severity = defaultAlertSeverity
		}
		return webhookResult{
			status: http.StatusCreated,
			body:   map[string]interface{}{"status": "alert_logged"},
		}
	case eventNote:
		return webhookResult{
			status: http.StatusOK,
			body:   map[string]interface{}{"status": "noted"},
		}
	default:
		return webhookResult{
			status: http.StatusOK,
			body:   map[string]interface{}{"status": "received", "event": p.Event},
		}
	}
}

// InboundWebhook accepts external events and creates alerts or triggers actions.
func (h *WebhookHandler) InboundWebhook(w http.ResponseWriter, r *http.Request) {
	// A server request always carries a non-nil body, but guard so a
	// hand-built request (or a test) can never nil-deref inside the decoder.
	if r.Body == nil {
		r.Body = http.NoBody
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, maxWebhookBodyBytes)

	var payload inboundPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		if isMaxBytesError(err) {
			log.Debug().Err(err).Int("limit_bytes", maxWebhookBodyBytes).
				Msg("webhook: inbound payload exceeds size limit")
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		log.Debug().Err(err).Msg("webhook: invalid inbound payload")
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if payload.Event == "" {
		httpx.WriteError(w, http.StatusBadRequest, "event field is required")
		return
	}

	result := classify(&payload)

	switch payload.Event {
	case eventAlert:
		log.Warn().
			Str("title", payload.Title).
			Str("severity", payload.Severity).
			Str("message", payload.Message).
			Str("vehicle", payload.Vehicle).
			Msg("webhook: external alert received")
	case eventNote:
		log.Info().
			Str("title", payload.Title).
			Str("message", payload.Message).
			Msg("webhook: note received")
	default:
		log.Debug().
			Str("event", payload.Event).
			Msg("webhook: unclassified event received")
	}

	httpx.WriteJSON(w, result.status, result.body)
}

// isMaxBytesError reports whether err was produced by http.MaxBytesReader
// rejecting an over-limit body, so it can be mapped to 413 instead of 400.
func isMaxBytesError(err error) bool {
	var maxErr *http.MaxBytesError
	return errors.As(err, &maxErr)
}
