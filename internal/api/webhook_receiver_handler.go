package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
)

// WebhookProcessor processes incoming webhook payloads.
// Satisfied by *trigger.WebhookTrigger.
type WebhookProcessor interface {
	HandleWebhook(ctx context.Context, token string, payload []byte, signature string, remoteIP string) error
}

// WebhookReceiverHandler handles incoming webhook requests from external systems
// (Home Assistant, IFTTT, Node-RED, etc.) to fire automation triggers.
// The URL token IS the authentication — no ForwardAuth required.
type WebhookReceiverHandler struct {
	processor WebhookProcessor
}

// NewWebhookReceiverHandler creates a handler backed by the given webhook processor.
func NewWebhookReceiverHandler(p WebhookProcessor) *WebhookReceiverHandler {
	return &WebhookReceiverHandler{processor: p}
}

// Receive handles POST /api/v1/automations/webhook/{token}.
func (h *WebhookReceiverHandler) Receive(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "webhook token is required")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		// MaxBytesReader wraps the body globally; a read failure here means
		// either the payload exceeds the 1 MB limit or the client disconnected.
		if isMaxBytesError(err) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	signature := r.Header.Get("X-Webhook-Signature")
	remoteIP := r.RemoteAddr

	err = h.processor.HandleWebhook(r.Context(), token, body, signature, remoteIP)
	if err != nil {
		switch {
		case errors.Is(err, trigger.ErrWebhookNotFound):
			// Return 404 — don't reveal whether the token exists but is disabled
			writeError(w, http.StatusNotFound, "webhook not found")
		case errors.Is(err, trigger.ErrWebhookSignatureInvalid):
			writeError(w, http.StatusForbidden, "invalid webhook signature")
		case isPayloadError(err):
			writeError(w, http.StatusBadRequest, "invalid webhook payload")
		default:
			log.Error().Err(err).
				Str("token_prefix", safeTokenPrefix(token)).
				Msg("webhook processing failed")
			writeError(w, http.StatusInternalServerError, "webhook processing failed")
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"accepted": true})
}

// safeTokenPrefix returns the first 8 characters of a token for safe logging.
func safeTokenPrefix(token string) string {
	if len(token) <= 8 {
		return token[:len(token)/2] + "***"
	}
	return token[:8] + "***"
}

// isMaxBytesError checks if the error is from http.MaxBytesReader.
func isMaxBytesError(err error) bool {
	var maxErr *http.MaxBytesError
	return errors.As(err, &maxErr)
}

// isPayloadError detects errors caused by invalid client input (bad JSON, etc.)
// so they can be mapped to 400 instead of 500.
func isPayloadError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "not valid JSON") ||
		strings.Contains(msg, "invalid webhook config")
}

// webhookTokenKeyFunc extracts the webhook token from the URL for per-token
// rate limiting. Falls back to IP-based limiting if the token is missing.
func webhookTokenKeyFunc(r *http.Request) (string, error) {
	token := chi.URLParam(r, "token")
	if token != "" {
		return "webhook:" + token, nil
	}
	return r.RemoteAddr, nil
}
