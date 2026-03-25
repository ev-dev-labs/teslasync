package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/rs/zerolog/log"
	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// WebPushSender sends push notifications to all registered browser subscriptions.
type WebPushSender struct {
	repo *database.PushSubscriptionRepo
}

// NewWebPushSender creates a new WebPushSender.
func NewWebPushSender(db *database.DB) *WebPushSender {
	return &WebPushSender{repo: database.NewPushSubscriptionRepo(db)}
}

// Send delivers a web push notification to every stored subscription.
func (s *WebPushSender) Send(ctx context.Context, title, message string, metadata map[string]string) error {
	vapidPrivate := os.Getenv("VAPID_PRIVATE_KEY")
	vapidPublic := os.Getenv("VAPID_PUBLIC_KEY")
	if vapidPrivate == "" || vapidPublic == "" {
		return fmt.Errorf("VAPID keys not configured (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)")
	}

	subs, err := s.repo.GetAll(ctx)
	if err != nil {
		return fmt.Errorf("querying push subscriptions: %w", err)
	}
	if len(subs) == 0 {
		log.Debug().Msg("webpush: no subscriptions to notify")
		return nil
	}

	payload, err := json.Marshal(map[string]string{
		"title":   title,
		"message": message,
		"source":  "teslasync",
	})
	if err != nil {
		return fmt.Errorf("marshalling payload: %w", err)
	}

	var lastErr error
	sent := 0
	for _, sub := range subs {
		wp := &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys: webpush.Keys{
				P256dh: sub.P256dh,
				Auth:   sub.Auth,
			},
		}

		resp, err := webpush.SendNotification(payload, wp, &webpush.Options{
			VAPIDPublicKey:  vapidPublic,
			VAPIDPrivateKey: vapidPrivate,
			Subscriber:      "mailto:teslasync@localhost",
			TTL:             60,
		})
		if err != nil {
			log.Warn().Err(err).Str("endpoint", sub.Endpoint).Msg("webpush: delivery failed")
			lastErr = err
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == 410 {
			// 410 Gone — subscription expired, clean it up
			if delErr := s.repo.DeleteByEndpoint(ctx, sub.Endpoint); delErr != nil {
				log.Warn().Err(delErr).Str("endpoint", sub.Endpoint).Msg("webpush: failed to remove expired subscription")
			} else {
				log.Info().Str("endpoint", sub.Endpoint).Msg("webpush: removed expired subscription")
			}
			continue
		}

		if resp.StatusCode >= 400 {
			log.Warn().Int("status", resp.StatusCode).Str("endpoint", sub.Endpoint).Msg("webpush: push endpoint returned error")
			lastErr = fmt.Errorf("push endpoint returned %d", resp.StatusCode)
			continue
		}

		sent++
	}

	log.Info().Int("sent", sent).Int("total", len(subs)).Msg("webpush: notifications dispatched")
	return lastErr
}
