package app

import (
	"context"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/notification"
)

// componentDisplayName maps internal health-monitor IDs to
// user-facing component names used in system notification titles.
// Mirrors the legacy cmd/teslasync/lifecycle.go helper.
func componentDisplayName(name string) string {
	switch name {
	case "database":
		return "PostgreSQL"
	case "mqtt":
		return "MQTT Broker"
	case "tesla_api":
		return "Tesla Fleet API"
	case "worker":
		return "Vehicle Poller"
	case "redis":
		return "Redis Cache"
	default:
		return name
	}
}

// sendSystemNotification fans a status-change message out to every
// enabled notification channel via MQTT. Best-effort: a missing MQTT
// client or a per-channel publish failure does not propagate.
// Mirrors the legacy cmd/teslasync/lifecycle.go helper.
func sendSystemNotification(ctx context.Context, notifRepo *database.NotificationRepo, mqttClient *mqtt.Client, title, message string) {
	if mqttClient == nil {
		return
	}
	channels, err := notifRepo.GetAllChannels(ctx)
	if err != nil {
		return
	}
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
		if err := notification.Publish(mqttClient.Underlying(), req); err != nil {
			log.Warn().Err(err).Int64("channel_id", ch.ID).Msg("failed to send system notification")
		}
	}
}
