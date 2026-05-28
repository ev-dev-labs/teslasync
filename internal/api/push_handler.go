package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/webpush"
)

// pushSubscriptionsRepo is the slice of *dbnotif.PushSubscriptionsRepo
// the handler depends on. Defined as an interface so unit tests can drop
// in an in-memory fake (mirrors the SavedViewsHandler / PinnedHandler
// pattern from earlier Phase 40 prompts).
type pushSubscriptionsRepo interface {
	Upsert(ctx context.Context, s *models.PushSubscription) error
	ListAll(ctx context.Context) ([]*models.PushSubscription, error)
	ListForUser(ctx context.Context, userID *int64) ([]*models.PushSubscription, error)
	DeleteByEndpoint(ctx context.Context, userID *int64, endpoint string) error
}

// pushKeySource is the slice of webpush.Service the handler needs. It
// just exposes the public key + enabled flag — the handler never calls
// Send directly (that's the notification worker's job).
type pushKeySource interface {
	IsEnabled() bool
	PublicKey() string
}

// PushHandler exposes the Web Push (VAPID) subscription endpoints
// (Phase 40 / Prompt 52):
//
//	GET    /api/v1/push/public-key   — VAPID public key (or 404 when disabled)
//	GET    /api/v1/push/subscribe    — list this user's subscriptions
//	POST   /api/v1/push/subscribe    — register / refresh a subscription
//	DELETE /api/v1/push/subscribe    — remove one subscription
type PushHandler struct {
	repo              pushSubscriptionsRepo
	svc               pushKeySource
	auditDB           *database.DB
	forwardAuthHeader string
}

// NewPushHandler wires the production push_subscriptions repo and the
// process-wide webpush.Service singleton. forwardAuthHeader matches the
// header injected by the reverse-proxy auth provider; when empty, the
// audit log records an empty actor (dev-mode behaviour).
func NewPushHandler(db *database.DB, svc *webpush.Service, forwardAuthHeader string) *PushHandler {
	return &PushHandler{
		repo:              dbnotif.NewPushSubscriptionsRepo(db),
		svc:               svc,
		auditDB:           db,
		forwardAuthHeader: forwardAuthHeader,
	}
}

// maxPushBodyBytes caps each request body. Endpoints + keys are well
// under 2 KB in practice; 4 KB is comfortable headroom that still rejects
// any abuse attempt.
const maxPushBodyBytes = 4 << 10

// pushSubscribeRequest mirrors PushSubscription.toJSON() in the browser:
//
//	{ "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
type pushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256DH string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// pushDeleteRequest is the body for DELETE /push/subscribe.
type pushDeleteRequest struct {
	Endpoint string `json:"endpoint"`
}

// PublicKey returns the VAPID application server key the browser needs
// to call PushManager.subscribe().
//
//	GET /api/v1/push/public-key
//
// Public read — the VAPID public key is not a secret. Returns 404 when
// the operator has not configured TESLASYNC_VAPID_*; the frontend treats
// 404 as "browser push unavailable for this install" and hides the
// Enable button.
func (h *PushHandler) PublicKey(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil || !h.svc.IsEnabled() {
		writeError(w, http.StatusNotFound, "web push is not configured on this install")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"publicKey": h.svc.PublicKey(),
	})
}

// Subscribe registers a new browser subscription, or refreshes the keys
// on an existing one. Idempotent — repeated POSTs from the same browser
// (e.g. after the user grants permission again) update p256dh and auth
// in place rather than duplicating rows.
//
//	POST /api/v1/push/subscribe
//	body: { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
func (h *PushHandler) Subscribe(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil || !h.svc.IsEnabled() {
		writeError(w, http.StatusNotFound, "web push is not configured on this install")
		return
	}

	body, readErr := readPushBody(r)
	if readErr != nil {
		writeError(w, readErr.status, readErr.msg)
		return
	}

	var req pushSubscribeRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	endpoint, vErr := validatePushEndpoint(req.Endpoint)
	if vErr != nil {
		writeError(w, http.StatusBadRequest, vErr.Error())
		return
	}
	if strings.TrimSpace(req.Keys.P256DH) == "" || strings.TrimSpace(req.Keys.Auth) == "" {
		writeError(w, http.StatusBadRequest, "p256dh and auth keys are required")
		return
	}

	ua := captureUserAgent(r)
	row := &models.PushSubscription{
		Endpoint:  endpoint,
		P256DH:    strings.TrimSpace(req.Keys.P256DH),
		Auth:      strings.TrimSpace(req.Keys.Auth),
		UserAgent: ua,
	}
	if err := h.repo.Upsert(r.Context(), row); err != nil {
		log.Error().Err(err).Msg("push subscribe failed")
		writeError(w, http.StatusInternalServerError, "failed to save subscription")
		return
	}

	h.audit(r, "push.subscribe", &row.ID, pushAuditDetail(endpoint, ua))
	writeJSON(w, http.StatusCreated, row)
}

// List returns every subscription registered on this install. In single-
// user mode the list is install-wide; the multi-tenant future scopes it
// by user via repo.ListForUser. The endpoint URL is intentionally NOT
// truncated here — the frontend uses the full string as the React key
// and to compute "this device" by string-equality with the registered
// subscription.
//
//	GET /api/v1/push/subscribe
func (h *PushHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil || !h.svc.IsEnabled() {
		writeJSON(w, http.StatusOK, []*models.PushSubscription{})
		return
	}
	rows, err := h.repo.ListAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("push list failed")
		writeError(w, http.StatusInternalServerError, "failed to list push subscriptions")
		return
	}
	if rows == nil {
		rows = []*models.PushSubscription{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// Unsubscribe removes a single subscription by endpoint. The browser
// also calls subscription.unsubscribe() locally; this endpoint stops the
// server from sending to a dead push channel. Returns 204 on success and
// 404 when the endpoint is not registered.
//
//	DELETE /api/v1/push/subscribe
//	body: { "endpoint": "..." }
func (h *PushHandler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	body, readErr := readPushBody(r)
	if readErr != nil {
		writeError(w, readErr.status, readErr.msg)
		return
	}
	var req pushDeleteRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	endpoint, vErr := validatePushEndpoint(req.Endpoint)
	if vErr != nil {
		writeError(w, http.StatusBadRequest, vErr.Error())
		return
	}
	if err := h.repo.DeleteByEndpoint(r.Context(), nil, endpoint); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "subscription not found")
			return
		}
		log.Error().Err(err).Msg("push unsubscribe failed")
		writeError(w, http.StatusInternalServerError, "failed to remove subscription")
		return
	}
	h.audit(r, "push.unsubscribe", nil, pushAuditDetail(endpoint, nil))
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ─────────────────────────────────────────────────────────────────

type pushBodyError struct {
	status int
	msg    string
}

func readPushBody(r *http.Request) ([]byte, *pushBodyError) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxPushBodyBytes+1))
	if err != nil {
		return nil, &pushBodyError{http.StatusBadRequest, "failed to read request body"}
	}
	if len(body) > maxPushBodyBytes {
		return nil, &pushBodyError{http.StatusRequestEntityTooLarge, "push payload exceeds 4 KB limit"}
	}
	return body, nil
}

// validatePushEndpoint enforces that the endpoint is an absolute https://
// URL with a host (no `javascript:` payloads, no relative paths). Length
// is capped at 2048 chars — every real-world push service stays under
// that, and it stops a malicious client from filling the column with
// junk.
func validatePushEndpoint(raw string) (string, error) {
	endpoint := strings.TrimSpace(raw)
	if endpoint == "" {
		return "", errors.New("endpoint is required")
	}
	if len(endpoint) > 2048 {
		return "", errors.New("endpoint must be 2048 characters or fewer")
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", errors.New("endpoint must be a valid URL")
	}
	if u.Scheme != "https" {
		return "", errors.New("endpoint must use https://")
	}
	if u.Host == "" {
		return "", errors.New("endpoint must include a host")
	}
	return endpoint, nil
}

// captureUserAgent returns the trimmed User-Agent header capped at 512
// chars. Returns nil when the header is empty so the column stays NULL
// rather than persisting an empty string.
func captureUserAgent(r *http.Request) *string {
	ua := strings.TrimSpace(r.Header.Get("User-Agent"))
	if ua == "" {
		return nil
	}
	if len(ua) > 512 {
		ua = ua[:512]
	}
	return &ua
}

// pushAuditDetail returns a privacy-respecting summary of the
// subscription. Endpoints contain per-subscription opaque tokens; the
// audit log records only the host + the SHA-256 fingerprint of the
// endpoint so an operator can correlate logs without exposing the raw
// channel URL.
func pushAuditDetail(endpoint string, ua *string) string {
	parts := []string{"endpoint=" + endpointFingerprint(endpoint)}
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		parts = append(parts, "host="+u.Host)
	}
	if ua != nil && *ua != "" {
		// Truncate user-agent for log readability; full UA still lives
		// in push_subscriptions.user_agent.
		short := *ua
		if len(short) > 60 {
			short = short[:60] + "…"
		}
		parts = append(parts, "ua="+short)
	}
	return strings.Join(parts, " ")
}

// endpointFingerprint returns the first 16 hex chars of the SHA-256 of
// the endpoint URL. Stable enough to correlate before/after audit rows;
// short enough to keep the audit detail column readable.
func endpointFingerprint(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:8])
}

// audit forwards the mutation to the shared audit logger. No-op when
// auditDB is nil (handler-only unit tests).
func (h *PushHandler) audit(r *http.Request, action string, entityID *int64, detail string) {
	if h.auditDB == nil {
		return
	}
	logAuditFromRequest(h.auditDB, r, h.forwardAuthHeader, action, "push_subscription", entityID, detail)
}
