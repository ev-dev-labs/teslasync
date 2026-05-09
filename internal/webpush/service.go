// Package webpush dispatches Web Push (VAPID) notifications to subscribed
// browser-device-pairings registered via the Push API.
//
// The package owns a process-wide singleton Service that the API server and
// notification worker both initialise at startup with the VAPID config
// (`internal/config.WebPushConfig`) and the push_subscriptions repo
// (`internal/database.PushSubscriptionsRepo`). The notification fan-out
// then calls webpush.Default().Send(...) for the synthetic "webpush"
// channel — one fan-out call delivers one OS-level notification to every
// registered device.
//
// Failures are isolated per-subscription: a 404/410 from the upstream push
// service prunes that subscription only; the rest of the fan-out continues.
package webpush

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	gowebpush "github.com/SherClockHolmes/webpush-go"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Payload is the JSON body sent to the service worker's `push` event.
//
// The schema is intentionally tiny — Web Push payloads are size-capped at
// roughly 4 KB by the spec (and most real-world push services enforce
// closer to 3 KB), so anything beyond a title, body, drill-through URL,
// and a couple of icon hints would be wasted budget.
//
// Phase-49 / Slice 0010 — the legacy `Icon` field is intentionally
// removed. On Android Chrome, populating BOTH the PWA manifest icon
// (which Chrome auto-uses for the notification card's left thumbnail)
// AND the `Notification.icon` slot causes the same image to render on
// both sides of the notification card — the user-reported "duplicate
// icon" bug. The PWA manifest icon owns the left slot; we leave the
// right slot empty (matching Macy's / Yahoo style). Per-event
// contextual icons (charging plug, padlock, etc.) are deliberately
// out of scope for this slice — they'd require an event-kind hint on
// the payload + a SW mapping table + a matched icon asset set.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	URL   string `json:"url,omitempty"`
	Badge string `json:"badge,omitempty"`
	Tag   string `json:"tag,omitempty"`
	// Severity drives `requireInteraction` in the SW (critical sticks
	// until tapped). Allowed values mirror the alert-rule severities:
	// "info", "warn", "critical".
	Severity string `json:"severity,omitempty"`
}

// SubscriptionRepo is the slice of database.PushSubscriptionsRepo the
// Service needs. Defined as an interface so unit tests can plug in an
// in-memory fake without standing up a Postgres pool.
type SubscriptionRepo interface {
	ListAll(ctx context.Context) ([]*models.PushSubscription, error)
	DeleteByEndpointAny(ctx context.Context, endpoint string) error
	Touch(ctx context.Context, endpoint string) error
}

// Service is the dispatcher singleton. Construct via NewService and
// register with SetDefault from the binary's main().
type Service struct {
	repo       SubscriptionRepo
	publicKey  string
	privateKey string
	subject    string

	// httpClient is the *http.Client that gowebpush.SendNotification
	// uses for every push. Override via NewServiceWithClient in tests.
	httpClient gowebpush.HTTPClient

	// ttl is the Web Push TTL header value (seconds). Push services
	// retain undelivered messages for at most this long; we use 1 day
	// so notifications still arrive when a phone wakes up after a
	// long flight. Configurable later if real fleets need shorter.
	ttl int
}

// NewService builds a Service with the production *http.Client (10s timeout
// — push services are usually fast; we never want a single dead endpoint to
// stall the whole fan-out for minutes).
func NewService(repo SubscriptionRepo, publicKey, privateKey, subject string) *Service {
	return NewServiceWithClient(repo, publicKey, privateKey, subject,
		&http.Client{
			Timeout:   10 * time.Second,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		})
}

// NewServiceWithClient is the test seam. The `client` parameter is typed as
// gowebpush.HTTPClient (an interface) so tests can pass a stub that returns
// canned responses.
func NewServiceWithClient(repo SubscriptionRepo, publicKey, privateKey, subject string, client gowebpush.HTTPClient) *Service {
	return &Service{
		repo:       repo,
		publicKey:  publicKey,
		privateKey: privateKey,
		subject:    subject,
		httpClient: client,
		ttl:        24 * 60 * 60,
	}
}

// IsEnabled reports whether the Service has both VAPID keys and a subject.
// When false, Send is a no-op (returns 0, nil). Callers can use this to
// short-circuit before building the payload.
func (s *Service) IsEnabled() bool {
	if s == nil {
		return false
	}
	return s.publicKey != "" && s.privateKey != "" && s.subject != ""
}

// PublicKey returns the base64url-encoded VAPID public key, or "" when
// the Service is disabled.
func (s *Service) PublicKey() string {
	if s == nil {
		return ""
	}
	return s.publicKey
}

// SendResult summarises the outcome of one fan-out.
type SendResult struct {
	// Sent is the count of subscriptions that accepted the push (HTTP 2xx).
	Sent int
	// Pruned is the count of subscriptions removed because the push
	// service returned 404 or 410 (subscription is gone).
	Pruned int
	// Failed is the count of subscriptions that failed for any other
	// reason (network error, 5xx, etc.). Failed subscriptions are
	// retried on the next fan-out — they are NOT pruned automatically
	// because a transient network blip should not throw away a working
	// subscription.
	Failed int
}

// Send fans the payload out to every subscription returned by the repo.
// Returns the per-subscription summary and a non-nil error only when the
// entire fan-out failed before any push attempt (e.g. the repo could not
// list subscriptions). Per-subscription failures are surfaced via
// SendResult.Failed and never cause this method to return a non-nil error
// — the caller has already committed the notification log row.
func (s *Service) Send(ctx context.Context, payload Payload) (SendResult, error) {
	if !s.IsEnabled() {
		return SendResult{}, nil
	}
	if s.repo == nil {
		return SendResult{}, errors.New("webpush: subscription repo not configured")
	}
	if payload.Title == "" {
		return SendResult{}, errors.New("webpush: payload.Title is required")
	}

	subs, err := s.repo.ListAll(ctx)
	if err != nil {
		return SendResult{}, fmt.Errorf("webpush: list subscriptions: %w", err)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return SendResult{}, fmt.Errorf("webpush: marshal payload: %w", err)
	}

	var result SendResult
	for _, sub := range subs {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		s.dispatchOne(ctx, sub, body, &result)
	}
	return result, nil
}

func (s *Service) dispatchOne(ctx context.Context, sub *models.PushSubscription, body []byte, result *SendResult) {
	gosub := &gowebpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: gowebpush.Keys{
			Auth:   sub.Auth,
			P256dh: sub.P256DH,
		},
	}
	resp, err := gowebpush.SendNotificationWithContext(ctx, body, gosub, &gowebpush.Options{
		HTTPClient:      s.httpClient,
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             s.ttl,
		Urgency:         gowebpush.UrgencyNormal,
	})
	if err != nil {
		result.Failed++
		log.Warn().Err(err).Str("endpoint", endpointHash(sub.Endpoint)).
			Msg("webpush: send failed (transient — subscription kept)")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		result.Sent++
		// Best-effort touch — never fail the path on a missed update.
		if err := s.repo.Touch(ctx, sub.Endpoint); err != nil {
			log.Warn().Err(err).Str("endpoint", endpointHash(sub.Endpoint)).
				Msg("webpush: failed to touch last_used_at")
		}
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		result.Pruned++
		log.Info().Int("status", resp.StatusCode).Str("endpoint", endpointHash(sub.Endpoint)).
			Msg("webpush: pruning dead subscription")
		if err := s.repo.DeleteByEndpointAny(ctx, sub.Endpoint); err != nil {
			log.Warn().Err(err).Str("endpoint", endpointHash(sub.Endpoint)).
				Msg("webpush: failed to delete dead subscription")
		}
	default:
		result.Failed++
		log.Warn().Int("status", resp.StatusCode).Str("endpoint", endpointHash(sub.Endpoint)).
			Msg("webpush: push service returned non-2xx (transient — subscription kept)")
	}
}

// endpointHash returns a short fingerprint of the endpoint URL for logs.
// Full endpoints contain per-subscription tokens that must not be logged.
func endpointHash(endpoint string) string {
	if len(endpoint) <= 24 {
		return endpoint
	}
	// First 24 chars covers the host (e.g. https://fcm.googleapis.com/);
	// the rest is the per-subscription opaque token which must not leak.
	return endpoint[:24] + "…"
}

// ── Process-wide singleton ─────────────────────────────────────────────────

var (
	defaultService   *Service
	defaultServiceMu sync.RWMutex
)

// SetDefault registers `s` as the process-wide default Service. Called once
// from each binary's main() after constructing the Service. Safe to call
// concurrently with Default; the swap is guarded by defaultServiceMu.
func SetDefault(s *Service) {
	defaultServiceMu.Lock()
	defaultService = s
	defaultServiceMu.Unlock()
}

// Default returns the process-wide Service, or nil when SetDefault has not
// been called. Callers MUST nil-check before use.
func Default() *Service {
	defaultServiceMu.RLock()
	defer defaultServiceMu.RUnlock()
	return defaultService
}
