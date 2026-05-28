package notification

import (
	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/notifier"
)

// notificationChannelWebhookConfigStore is the slice of
// [dbnotif.NotificationChannelRepo] used by the webhook test/preview
// handlers. Defined as an interface so the handler tests can stub the
// DB without standing up Postgres.
type notificationChannelWebhookConfigStore interface {
	GetWebhookConfig(ctx context.Context, channelID int64) (*dbnotif.WebhookConfig, error)
}

// webhookSender is the function signature exposed to the handler so
// tests can inject a recorder instead of a real outbound HTTP call. In
// production this is bound to [notifier.Send].
type webhookSender func(ctx context.Context, opts notifier.Options) (notifier.Result, error)

// ChannelHandler hosts the webhook-channel-specific
// endpoints introduced by Phase-46 / Prompt 37.
//
// It deliberately does NOT cover generic channel CRUD — that path is
// owned by [NotificationHandler] and reused via the existing
// /api/v1/notifications routes. The handlers here add:
//
//   - POST /notifications/{channelID}/webhook-test:
//     fires a structured test event using the new HMAC-aware
//     [notifier.Send] path (NOT the legacy [sendWebhook] which never
//     learned to sign).
//
//   - POST /notifications/webhooks/preview-signature:
//     pure utility — given a secret + body, returns the value the
//     server WOULD send in the X-TeslaSync-Signature header. The
//     Settings UI uses it to render a copy-paste-ready signature
//     preview before the user has even saved the channel, so they can
//     verify the receiver-side validator works.
type ChannelHandler struct {
	store  notificationChannelWebhookConfigStore
	sender webhookSender
}

// NewChannelHandler wires the handler against a real
// *database.DB. Tests build the handler directly so they can swap the
// store and sender.
func NewChannelHandler(db *database.DB) *ChannelHandler {
	return &ChannelHandler{
		store:  dbnotif.NewNotificationChannelRepo(db),
		sender: notifier.Send,
	}
}

// MaxWebhookSignaturePreviewBodyBytes caps the size of the body the
// preview endpoint will hash. The signature operation itself is O(n)
// in the body length and the endpoint is meant for short test
// payloads, so 64 KiB is plenty and prevents DoS via huge bodies.
const MaxWebhookSignaturePreviewBodyBytes = 64 * 1024

// MaxWebhookTestRequestBodyBytes caps the request body the
// /webhook-test endpoint accepts (overrides for title/message). Generous
// enough for ad-hoc text without enabling abuse.
const MaxWebhookTestRequestBodyBytes = 16 * 1024

// webhookTestRequest is the optional JSON body the test endpoint
// accepts; both fields fall back to deterministic defaults so the UI
// can fire a test with an empty body.
type webhookTestRequest struct {
	Title   string `json:"title,omitempty"`
	Message string `json:"message,omitempty"`
}

// webhookTestResponse is the JSON shape returned by the test endpoint.
// It is consumed by the WebhookChannelsSection UI to render the result
// pill (success / status code / latency / signature header / response
// body preview).
type webhookTestResponse struct {
	Success     bool   `json:"success"`
	StatusCode  int    `json:"status_code"`
	LatencyMs   int64  `json:"latency_ms"`
	BodyPreview string `json:"body_preview,omitempty"`
	Truncated   bool   `json:"truncated,omitempty"`
	Signature   string `json:"signature,omitempty"`
	Error       string `json:"error,omitempty"`
}

// WebhookTest fires a single test webhook request through the new
// HMAC-aware delivery path and returns the structured result.
//
// The test event is a fixed JSON envelope (per the Blocked Path on
// Phase-46 / Prompt 37 — body templating is intentionally out of
// scope). When the channel has a secret configured, the request is
// signed with HMAC SHA-256 and the digest is echoed back in the
// response so the user can confirm the receiver validated against the
// same input.
func (h *ChannelHandler) WebhookTest(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "channelID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}

	// Body is optional — the UI typically POSTs an empty body and lets
	// the server pick the defaults, but power users can override
	// title/message to exercise unicode / length-edge cases.
	req := webhookTestRequest{}
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, MaxWebhookTestRequestBodyBytes)
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			// Empty body returns io.EOF from Decode; treat that as "use
			// defaults" rather than a 400. Any other decode error is a
			// real client mistake.
			switch {
			case errors.Is(err, io.EOF):
				// keep defaults
			case isMaxBytesError(err):
				httpx.WriteError(w, http.StatusBadRequest, "request body too large")
				return
			default:
				httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
				return
			}
		}
	}

	cfg, err := h.store.GetWebhookConfig(r.Context(), id)
	if err != nil {
		if errors.Is(err, dbnotif.ErrChannelNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "webhook channel not found")
			return
		}
		log.Error().Err(err).Int64("channel_id", id).Msg("load webhook config")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load channel")
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "TeslaSync Test"
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		message = "Test webhook delivery from TeslaSync. If you can read this, your endpoint is reachable."
	}

	// Fixed JSON envelope. The `test` flag lets receivers route test
	// payloads to a debug pipeline so they don't pollute production
	// notification streams.
	body, err := json.Marshal(map[string]any{
		"title":     title,
		"message":   message,
		"source":    "teslasync",
		"test":      true,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		// Marshalling a map[string]any with primitive values can't fail
		// in practice; surface as 500 if it ever did so we don't lie
		// to the client about success.
		log.Error().Err(err).Msg("marshal webhook test body")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build test payload")
		return
	}

	res, sendErr := h.sender(r.Context(), notifier.Options{
		URL:    cfg.URL,
		Method: cfg.HTTPMethod,
		Body:   body,
		Secret: cfg.Secret,
	})

	resp := webhookTestResponse{
		Success:     sendErr == nil && res.StatusCode > 0 && res.StatusCode < 400,
		StatusCode:  res.StatusCode,
		LatencyMs:   res.LatencyMs,
		BodyPreview: res.BodyPreview,
		Truncated:   res.Truncated,
		Signature:   res.Signature,
	}
	if sendErr != nil {
		resp.Error = sendErr.Error()
	} else if !resp.Success {
		resp.Error = "receiver returned a non-2xx/3xx status"
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// webhookSignaturePreviewRequest is the JSON body the preview endpoint
// accepts. Both fields are required; an empty secret would return an
// empty signature which is not useful here.
type webhookSignaturePreviewRequest struct {
	Secret string `json:"secret"`
	Body   string `json:"body"`
}

// webhookSignaturePreviewResponse echoes the computed signature so the
// UI can render it for copy-paste before the channel is saved.
type webhookSignaturePreviewResponse struct {
	Signature string `json:"signature"`
}

// WebhookSignaturePreview computes the HMAC SHA-256 signature for a
// caller-supplied (secret, body) pair and returns it as JSON. The
// endpoint is pure: it never touches the database and never makes an
// outbound call. It is rate-limited at the route level so a malicious
// client can't grind through HMAC inputs.
func (h *ChannelHandler) WebhookSignaturePreview(w http.ResponseWriter, r *http.Request) {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "request body required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxWebhookSignaturePreviewBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req webhookSignaturePreviewRequest
	if err := dec.Decode(&req); err != nil {
		if isMaxBytesError(err) {
			httpx.WriteError(w, http.StatusBadRequest, "request body too large")
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Secret) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "secret is required")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, webhookSignaturePreviewResponse{
		Signature: notifier.Sign(req.Secret, []byte(req.Body)),
	})
}

// (isMaxBytesError lives in webhook_receiver_handler.go and is shared
// across handlers in the api package — no need to redeclare here.)
