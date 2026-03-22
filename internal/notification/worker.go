package notification

import (
	"context"
	"encoding/json"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Worker subscribes to the internal MQTT notification topic and delivers
// notifications asynchronously with retry logic and metrics tracking.
type Worker struct {
	repo       *database.NotificationRepo
	metricRepo *database.NotificationMetricRepo
}

// NewWorker creates a notification worker.
func NewWorker(db *database.DB) *Worker {
	return &Worker{
		repo:       database.NewNotificationRepo(db),
		metricRepo: database.NewNotificationMetricRepo(db),
	}
}

// Start subscribes to the internal notification topic and processes messages.
// It blocks until ctx is cancelled.
func (w *Worker) Start(ctx context.Context, mqttClient pahomqtt.Client) {
	if mqttClient == nil || !mqttClient.IsConnected() {
		log.Warn().Msg("notification worker: MQTT not available, running in direct mode")
		return
	}

	token := mqttClient.Subscribe(InternalTopic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
		var req Request
		if err := json.Unmarshal(msg.Payload(), &req); err != nil {
			log.Error().Err(err).Msg("notification worker: invalid message")
			return
		}
		w.processNotification(ctx, &req)
	})

	if token.WaitTimeout(10 * time.Second) && token.Error() != nil {
		log.Error().Err(token.Error()).Msg("notification worker: failed to subscribe")
		return
	}

	log.Info().Str("topic", InternalTopic).Msg("notification worker started")
	<-ctx.Done()
	mqttClient.Unsubscribe(InternalTopic)
	log.Info().Msg("notification worker stopped")
}

func (w *Worker) processNotification(ctx context.Context, req *Request) {
	startTime := time.Now()
	var lastErr error

	// Retry up to 3 times with backoff
	for attempt := 0; attempt < 3; attempt++ {
		if err := Send(req); err != nil {
			lastErr = err
			log.Warn().Err(err).
				Str("channel", req.ChannelType).
				Int("attempt", attempt+1).
				Msg("notification delivery failed, retrying")
			time.Sleep(time.Duration(1<<uint(attempt)) * time.Second)
			continue
		}

		latencyMs := int(time.Since(startTime).Milliseconds())

		// Success — log it
		if req.ChannelID > 0 {
			if err := w.repo.CreateLog(ctx, &models.NotificationLog{
				ChannelID: req.ChannelID,
				Title:     req.Title,
				Message:   req.Message,
				Status:    "sent",
			}); err != nil {
				log.Warn().Err(err).Msg("notification: failed to create success log")
			}
			// Record delivery metric
			if err := w.metricRepo.Record(ctx, req.ChannelID, true, latencyMs); err != nil {
				log.Warn().Err(err).Msg("notification: failed to record metric")
			}
		}
		log.Info().Str("channel", req.ChannelType).Str("title", req.Title).Int("latency_ms", latencyMs).Msg("notification delivered")
		return
	}

	latencyMs := int(time.Since(startTime).Milliseconds())

	// All retries exhausted
	if req.ChannelID > 0 {
		errStr := ""
		if lastErr != nil {
			errStr = lastErr.Error()
		}
		if err := w.repo.CreateLog(ctx, &models.NotificationLog{
			ChannelID: req.ChannelID,
			Title:     req.Title,
			Message:   req.Message,
			Status:    "failed",
			Error:     errStr,
		}); err != nil {
			log.Warn().Err(err).Msg("notification: failed to create failure log")
		}
		// Record failure metric
		if err := w.metricRepo.Record(ctx, req.ChannelID, false, latencyMs); err != nil {
			log.Warn().Err(err).Msg("notification: failed to record failure metric")
		}
	}
	log.Error().Err(lastErr).Str("channel", req.ChannelType).Msg("notification delivery failed after retries")
}

// Publish sends a notification request to the MQTT topic for async delivery.
// If MQTT is not available, it falls back to synchronous delivery.
func Publish(mqttClient pahomqtt.Client, req *Request) error {
	if mqttClient == nil || !mqttClient.IsConnected() {
		// Fallback to direct send
		return Send(req)
	}

	data, err := json.Marshal(req)
	if err != nil {
		return err
	}

	token := mqttClient.Publish(InternalTopic, 1, false, data)
	if !token.WaitTimeout(5 * time.Second) {
		// Fallback to direct send on timeout
		log.Warn().Msg("notification: MQTT publish timeout, falling back to direct send")
		return Send(req)
	}
	return token.Error()
}
