package notification

import (
	"context"
	"encoding/json"
	"sync"
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
	decider    QuietHoursDecider
	wg         sync.WaitGroup
}

// NewWorker creates a notification worker.
func NewWorker(db *database.DB) *Worker {
	return &Worker{
		repo:       database.NewNotificationRepo(db),
		metricRepo: database.NewNotificationMetricRepo(db),
	}
}

// WithQuietHoursDecider wires a Do-Not-Disturb decider that is consulted
// before every delivery (Phase-46 / Prompt 19). Passing nil disables the
// check, which is the historical behaviour. Returns the worker for
// fluent setup so cmd/notification-worker can chain construction.
func (w *Worker) WithQuietHoursDecider(d QuietHoursDecider) *Worker {
	w.decider = d
	return w
}

// Start subscribes to the internal notification topic and processes messages.
// It blocks until ctx is cancelled.
func (w *Worker) Start(ctx context.Context, mqttClient pahomqtt.Client) {
	if mqttClient == nil {
		log.Warn().Msg("notification worker: MQTT not available, running in direct mode")
		return
	}

	// Retry subscription with backoff — connection may not be stable immediately
	var subscribed bool
	for attempt := 1; attempt <= 10; attempt++ {
		if ctx.Err() != nil {
			return
		}
		if !mqttClient.IsConnected() {
			log.Warn().Int("attempt", attempt).Msg("notification worker: waiting for MQTT connection")
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
			continue
		}

		token := mqttClient.Subscribe(InternalTopic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
			var req Request
			if err := json.Unmarshal(msg.Payload(), &req); err != nil {
				log.Error().Err(err).Msg("notification worker: invalid message")
				return
			}
			w.wg.Add(1)
			go func() {
				defer w.wg.Done()
				w.processNotification(ctx, &req)
			}()
		})

		if token.WaitTimeout(10*time.Second) && token.Error() != nil {
			log.Warn().Err(token.Error()).Int("attempt", attempt).Msg("notification worker: subscribe failed, retrying")
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
			continue
		}

		subscribed = true
		break
	}

	if !subscribed {
		log.Error().Msg("notification worker: failed to subscribe after 10 attempts")
		return
	}

	log.Info().Str("topic", InternalTopic).Msg("notification worker started")
	<-ctx.Done()
	mqttClient.Unsubscribe(InternalTopic)
	log.Info().Msg("notification worker stopped")
}

func (w *Worker) processNotification(ctx context.Context, req *Request) {
	// Phase-46 / Prompt 19 — Do-Not-Disturb gate. When a quiet-hours
	// window is active and the request severity is not on its bypass
	// list, skip delivery and persist a deferred row so the replay loop
	// in cmd/notification-worker can dispatch it later.
	if w.decider != nil && req.ChannelID > 0 {
		shouldDefer, win, err := w.decider.ShouldDefer(ctx, req.Severity, time.Now())
		if err != nil {
			// Don't block delivery on a transient lookup failure;
			// fall through to the normal Send path so the user still
			// gets the notification.
			log.Warn().Err(err).Str("channel", req.ChannelType).Msg("notification: quiet-hours decider failed, delivering anyway")
		} else if shouldDefer {
			w.persistDeferred(ctx, req, win)
			return
		}
	}

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
			logEntry := &models.NotificationLog{
				ChannelID: req.ChannelID,
				Title:     req.Title,
				Message:   req.Message,
				Status:    "sent",
			}
			if req.AlertID > 0 {
				alertID := req.AlertID
				logEntry.AlertID = &alertID
			}
			if err := w.repo.CreateLog(ctx, logEntry); err != nil {
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
		logEntry := &models.NotificationLog{
			ChannelID: req.ChannelID,
			Title:     req.Title,
			Message:   req.Message,
			Status:    "failed",
			Error:     errStr,
		}
		if req.AlertID > 0 {
			alertID := req.AlertID
			logEntry.AlertID = &alertID
		}
		if err := w.repo.CreateLog(ctx, logEntry); err != nil {
			log.Warn().Err(err).Msg("notification: failed to create failure log")
		}
		// Record failure metric
		if err := w.metricRepo.Record(ctx, req.ChannelID, false, latencyMs); err != nil {
			log.Warn().Err(err).Msg("notification: failed to record failure metric")
		}
	}
	log.Error().Err(lastErr).Str("channel", req.ChannelType).Msg("notification delivery failed after retries")
}

// Shutdown waits for all in-flight notification deliveries to complete,
// with a bounded 30-second timeout to prevent hanging indefinitely.
func (w *Worker) Shutdown() {
	log.Info().Msg("shutting down: waiting for in-flight notifications...")
	done := make(chan struct{})
	go func() {
		w.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		log.Info().Msg("all notifications completed, exiting cleanly")
	case <-time.After(30 * time.Second):
		log.Warn().Msg("shutdown timeout exceeded (30s), forcing exit with in-flight work abandoned")
	}
}

// persistDeferred writes a notification_logs row in the deferred_dnd
// state. The replay loop in cmd/notification-worker promotes the row to
// 'sent' once the matching window ends. (Phase-46 / Prompt 19.)
func (w *Worker) persistDeferred(ctx context.Context, req *Request, win *models.QuietHoursWindow) {
	logEntry := &models.NotificationLog{
		ChannelID: req.ChannelID,
		Title:     req.Title,
		Message:   req.Message,
		Status:    StatusDeferredDND,
		Severity:  req.Severity,
	}
	if req.AlertID > 0 {
		alertID := req.AlertID
		logEntry.AlertID = &alertID
	}
	if err := w.repo.CreateLog(ctx, logEntry); err != nil {
		log.Warn().Err(err).Msg("notification: failed to create deferred_dnd log row")
	}
	ev := log.Info().
		Str("channel", req.ChannelType).
		Str("title", req.Title).
		Str("severity", req.Severity)
	if win != nil {
		ev = ev.
			Int64("quiet_hours_window_id", win.ID).
			Str("quiet_hours_user", win.UserID).
			Str("quiet_hours_tz", win.Timezone)
	}
	ev.Msg("notification deferred (DND active)")
}

// ReplayDeferred examines every deferred_dnd row and re-dispatches the
// ones whose window has ended. Each row is sent through the supplied
// dispatch function (typically `notification.Send`) and marked sent on
// success. Returns the number of rows replayed and the number that
// failed; non-fatal so the caller's outer loop can keep ticking.
//
// Channels are looked up at replay time so disabled / deleted channels
// short-circuit cleanly (the row is marked failed with a descriptive
// error message rather than blocking the replay queue forever).
//
// Phase-46 / Prompt 19.
func (w *Worker) ReplayDeferred(ctx context.Context) (replayed, failed int, err error) {
	if w == nil || w.repo == nil {
		return 0, 0, nil
	}
	deferred, err := w.repo.ListDeferred(ctx, 200)
	if err != nil {
		return 0, 0, err
	}
	if len(deferred) == 0 {
		return 0, 0, nil
	}
	now := time.Now()
	for _, row := range deferred {
		if row == nil {
			continue
		}
		// Re-evaluate against current windows. If still deferred, skip.
		if w.decider != nil {
			stillDefer, _, evalErr := w.decider.ShouldDefer(ctx, row.Severity, now)
			if evalErr != nil {
				log.Warn().Err(evalErr).Int64("log_id", row.ID).Msg("notification replay: decider failed")
				continue
			}
			if stillDefer {
				continue
			}
		}
		ch, chErr := w.repo.GetChannel(ctx, row.ChannelID)
		if chErr != nil || ch == nil {
			msg := "channel not found at replay time"
			if chErr != nil {
				msg = "channel lookup failed: " + chErr.Error()
			}
			if mErr := w.repo.MarkLogFailed(ctx, row.ID, msg, 0); mErr != nil {
				log.Warn().Err(mErr).Int64("log_id", row.ID).Msg("notification replay: mark_failed failed")
			}
			failed++
			continue
		}
		if !ch.Enabled {
			if mErr := w.repo.MarkLogFailed(ctx, row.ID, "channel disabled at replay time", 0); mErr != nil {
				log.Warn().Err(mErr).Int64("log_id", row.ID).Msg("notification replay: mark_failed failed")
			}
			failed++
			continue
		}
		req := &Request{
			ChannelType: ch.Type,
			Config:      ch.Config,
			Title:       row.Title,
			Message:     row.Message,
			ChannelID:   ch.ID,
			Severity:    row.Severity,
		}
		if row.AlertID != nil {
			req.AlertID = *row.AlertID
		}
		started := time.Now()
		if sendErr := Send(req); sendErr != nil {
			latency := int(time.Since(started).Milliseconds())
			if mErr := w.repo.MarkLogFailed(ctx, row.ID, sendErr.Error(), latency); mErr != nil {
				log.Warn().Err(mErr).Int64("log_id", row.ID).Msg("notification replay: mark_failed failed")
			}
			failed++
			continue
		}
		latency := int(time.Since(started).Milliseconds())
		if mErr := w.repo.MarkLogSent(ctx, row.ID, time.Now(), latency); mErr != nil {
			log.Warn().Err(mErr).Int64("log_id", row.ID).Msg("notification replay: mark_sent failed")
		}
		if mErr := w.metricRepo.Record(ctx, ch.ID, true, latency); mErr != nil {
			log.Warn().Err(mErr).Msg("notification replay: failed to record metric")
		}
		replayed++
		log.Info().Int64("log_id", row.ID).Str("channel", ch.Type).Msg("notification replayed after DND window ended")
	}
	return replayed, failed, nil
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
