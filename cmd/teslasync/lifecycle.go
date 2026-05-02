package main

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/rs/zerolog/log"
)

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
