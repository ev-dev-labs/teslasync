package notification

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/models"
	tsmqtt "github.com/ev-dev-labs/teslasync/internal/mqtt"
)

// tracerName for the package-level otel.Tracer. Stable so dashboards can
// filter by instrumentation scope.
const tracerName = "internal/notification"

// Worker subscribes to the internal MQTT notification topic and delivers
// notifications asynchronously with retry logic and metrics tracking.
type Worker struct {
	repo       *dbnotif.NotificationRepo
	metricRepo *dbnotif.NotificationMetricRepo
	decider    QuietHoursDecider
	wg         sync.WaitGroup
}

// NewWorker creates a notification worker.
func NewWorker(db *database.DB) *Worker {
	return &Worker{
		repo:       dbnotif.NewNotificationRepo(db),
		metricRepo: dbnotif.NewNotificationMetricRepo(db),
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
			// Extract upstream trace context (set by the API server or
			// in-API worker that called PublishCtx). Legacy passthrough
			// returns the input ctx when the envelope is absent.
			msgCtx, payload := tsmqtt.ExtractTraceContext(ctx, msg.Payload())
			tracer := otel.Tracer(tracerName)
			msgCtx, span := tracer.Start(msgCtx, "notification.consume_mqtt",
				oteltrace.WithSpanKind(oteltrace.SpanKindConsumer),
				oteltrace.WithAttributes(
					semconv.MessagingSystemKey.String("mqtt"),
					semconv.MessagingDestinationName(InternalTopic),
					semconv.MessagingOperationTypeKey.String("process"),
					attribute.Int("messaging.message.payload_size_bytes", len(msg.Payload())),
				),
			)

			var req Request
			if err := json.Unmarshal(payload, &req); err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, "invalid message")
				span.End()
				log.Error().Err(err).Msg("notification worker: invalid message")
				return
			}
			span.SetAttributes(
				attribute.String("notification.severity", req.Severity),
				attribute.Int64("notification.channel_id", req.ChannelID),
			)
			w.wg.Add(1)
			go func() {
				defer w.wg.Done()
				defer span.End()
				w.processNotification(msgCtx, &req)
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
	tracer := otel.Tracer(tracerName)
	procCtx, procSpan := tracer.Start(ctx, "notification.process",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(
			attribute.String("notification.channel_type", req.ChannelType),
			attribute.Int64("notification.channel_id", req.ChannelID),
			attribute.String("notification.severity", req.Severity),
		),
	)
	defer procSpan.End()

	// Phase-46 / Prompt 19 — Do-Not-Disturb gate. When a quiet-hours
	// window is active and the request severity is not on its bypass
	// list, skip delivery and persist a deferred row so the replay loop
	// in cmd/notification-worker can dispatch it later.
	if w.decider != nil && req.ChannelID > 0 {
		shouldDefer, win, err := w.decider.ShouldDefer(procCtx, req.Severity, time.Now())
		if err != nil {
			// Don't block delivery on a transient lookup failure;
			// fall through to the normal Send path so the user still
			// gets the notification.
			procSpan.RecordError(err)
			log.Warn().Err(err).Str("channel", req.ChannelType).Msg("notification: quiet-hours decider failed, delivering anyway")
		} else if shouldDefer {
			procSpan.SetAttributes(attribute.String("notification.outcome", "deferred_dnd"))
			w.persistDeferred(procCtx, req, win)
			return
		}
	}

	startTime := time.Now()
	var lastErr error

	// Retry up to 3 times with backoff
	for attempt := 0; attempt < 3; attempt++ {
		_, sendSpan := tracer.Start(procCtx, "notification.send",
			oteltrace.WithSpanKind(oteltrace.SpanKindClient),
			oteltrace.WithAttributes(
				attribute.String("notification.channel_type", req.ChannelType),
				attribute.Int("notification.attempt", attempt+1),
			),
		)
		err := Send(req)
		if err != nil {
			sendSpan.RecordError(err)
			sendSpan.SetStatus(codes.Error, "send failed")
			sendSpan.End()
			lastErr = err
			log.Warn().Err(err).
				Str("channel", req.ChannelType).
				Int("attempt", attempt+1).
				Msg("notification delivery failed, retrying")
			time.Sleep(time.Duration(1<<uint(attempt)) * time.Second)
			continue
		}
		sendSpan.End()

		latencyMs := int(time.Since(startTime).Milliseconds())

		// Success — log it
		if req.ChannelID > 0 {
			logEntry := &notificationmodel.NotificationLog{
				ChannelID: req.ChannelID,
				Title:     req.Title,
				Message:   req.Message,
				Status:    "sent",
			}
			if req.AlertID > 0 {
				alertID := req.AlertID
				logEntry.AlertID = &alertID
			}
			if err := w.repo.CreateLog(procCtx, logEntry); err != nil {
				log.Warn().Err(err).Msg("notification: failed to create success log")
			}
			// Record delivery metric
			if err := w.metricRepo.Record(procCtx, req.ChannelID, true, latencyMs); err != nil {
				log.Warn().Err(err).Msg("notification: failed to record metric")
			}
		}
		procSpan.SetAttributes(
			attribute.String("notification.outcome", "delivered"),
			attribute.Int("notification.latency_ms", latencyMs),
			attribute.Int("notification.attempts", attempt+1),
		)
		log.Info().Str("channel", req.ChannelType).Str("title", req.Title).Int("latency_ms", latencyMs).Msg("notification delivered")
		return
	}

	latencyMs := int(time.Since(startTime).Milliseconds())

	// All retries exhausted
	procSpan.SetAttributes(
		attribute.String("notification.outcome", "failed_retries_exhausted"),
		attribute.Int("notification.latency_ms", latencyMs),
	)
	if lastErr != nil {
		procSpan.RecordError(lastErr)
		procSpan.SetStatus(codes.Error, "all retries failed")
	}
	if req.ChannelID > 0 {
		errStr := ""
		if lastErr != nil {
			errStr = lastErr.Error()
		}
		logEntry := &notificationmodel.NotificationLog{
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
		if err := w.repo.CreateLog(procCtx, logEntry); err != nil {
			log.Warn().Err(err).Msg("notification: failed to create failure log")
		}
		// Record failure metric
		if err := w.metricRepo.Record(procCtx, req.ChannelID, false, latencyMs); err != nil {
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
	logEntry := &notificationmodel.NotificationLog{
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
//
// Deprecated: prefer PublishCtx — it injects W3C trace context into the
// MQTT envelope so notification.consume_mqtt spans in the worker nest
// under the caller's span (true end-to-end traces from API request →
// notification dispatch). This shim exists only for back-compat with
// non-ctx call sites.
func Publish(mqttClient pahomqtt.Client, req *Request) error {
	return PublishCtx(context.Background(), mqttClient, req)
}

// PublishCtx is the ctx-aware variant. Trace context from ctx is
// injected into the JSON envelope; consumer-side Worker.Start uses
// tsmqtt.ExtractTraceContext to restore parent-child linkage across
// the process boundary.
func PublishCtx(ctx context.Context, mqttClient pahomqtt.Client, req *Request) error {
	if mqttClient == nil || !mqttClient.IsConnected() {
		// Fallback to direct send. We deliberately don't emit a span
		// here because the caller's span already covers this code
		// path; adding another would just be noise.
		return Send(req)
	}

	data, err := json.Marshal(req)
	if err != nil {
		return err
	}

	tracer := otel.Tracer(tracerName)
	ctx, span := tracer.Start(ctx, "notification.publish_mqtt",
		oteltrace.WithSpanKind(oteltrace.SpanKindProducer),
		oteltrace.WithAttributes(
			semconv.MessagingSystemKey.String("mqtt"),
			semconv.MessagingDestinationName(InternalTopic),
			semconv.MessagingOperationTypePublish,
			attribute.String("notification.severity", req.Severity),
		),
	)
	defer span.End()

	wrapped, err := tsmqtt.InjectTraceContext(ctx, data)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "inject trace context")
		return err
	}

	token := mqttClient.Publish(InternalTopic, 1, false, wrapped)
	if !token.WaitTimeout(5 * time.Second) {
		// Fallback to direct send on timeout. Mark the publish span as
		// errored (the operation we measured failed) — Send below
		// creates its own logging path.
		span.SetStatus(codes.Error, "mqtt publish timeout, falling back to direct send")
		log.Warn().Msg("notification: MQTT publish timeout, falling back to direct send")
		return Send(req)
	}
	if err := token.Error(); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "mqtt publish error")
		return err
	}
	return nil
}
