package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// PushHandler handles Web Push subscription management.
type PushHandler struct {
	repo *database.PushSubscriptionRepo
}

// NewPushHandler creates a new PushHandler.
func NewPushHandler(db *database.DB) *PushHandler {
	return &PushHandler{repo: database.NewPushSubscriptionRepo(db)}
}

// GetVAPIDKey returns the VAPID public key so the browser can subscribe.
func (h *PushHandler) GetVAPIDKey(w http.ResponseWriter, r *http.Request) {
	key := os.Getenv("VAPID_PUBLIC_KEY")
	if key == "" {
		writeError(w, http.StatusInternalServerError, "VAPID public key not configured")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"public_key": key})
}

// SubscribePush stores or updates a browser push subscription.
func (h *PushHandler) SubscribePush(w http.ResponseWriter, r *http.Request) {
	var body models.PushSubscriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(body.Endpoint) == "" {
		writeError(w, http.StatusBadRequest, "endpoint is required")
		return
	}
	if strings.TrimSpace(body.Keys.P256dh) == "" || strings.TrimSpace(body.Keys.Auth) == "" {
		writeError(w, http.StatusBadRequest, "p256dh and auth keys are required")
		return
	}

	sub := &models.PushSubscription{
		Endpoint: body.Endpoint,
		P256dh:   body.Keys.P256dh,
		Auth:     body.Keys.Auth,
	}

	if err := h.repo.Upsert(r.Context(), sub); err != nil {
		log.Error().Err(err).Msg("failed to upsert push subscription")
		writeError(w, http.StatusInternalServerError, "failed to save subscription")
		return
	}

	log.Info().Str("endpoint", sub.Endpoint).Int("id", sub.ID).Msg("push subscription saved")
	writeJSON(w, http.StatusCreated, sub)
}

// UnsubscribePush removes a push subscription by endpoint.
func (h *PushHandler) UnsubscribePush(w http.ResponseWriter, r *http.Request) {
	var body models.PushUnsubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(body.Endpoint) == "" {
		writeError(w, http.StatusBadRequest, "endpoint is required")
		return
	}

	if err := h.repo.DeleteByEndpoint(r.Context(), body.Endpoint); err != nil {
		log.Error().Err(err).Msg("failed to delete push subscription")
		writeError(w, http.StatusInternalServerError, "failed to remove subscription")
		return
	}

	log.Info().Str("endpoint", body.Endpoint).Msg("push subscription removed")
	writeJSON(w, http.StatusOK, map[string]string{"status": "unsubscribed"})
}
