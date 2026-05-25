package export

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/database"
	tsmqtt "github.com/ev-dev-labs/teslasync/internal/mqtt"
)

const tracerName = "internal/export"

// Worker subscribes to the internal MQTT export topic and processes
// export jobs asynchronously with retry logic.
type Worker struct {
	repo       *database.ExportJobRepo
	processor  *Processor
	mqttClient pahomqtt.Client
	wg         sync.WaitGroup
}

// NewWorker creates an export worker.
func NewWorker(db *database.DB) *Worker {
	return &Worker{
		repo:      database.NewExportJobRepo(db),
		processor: NewProcessor(db),
	}
}

// Start subscribes to the internal export topic and processes messages.
// It blocks until ctx is cancelled.
func (w *Worker) Start(ctx context.Context, mqttClient pahomqtt.Client) {
	if mqttClient == nil {
		log.Warn().Msg("export worker: MQTT not available")
		return
	}
	w.mqttClient = mqttClient

	var subscribed bool
	for attempt := 1; attempt <= 10; attempt++ {
		if ctx.Err() != nil {
			return
		}
		if !mqttClient.IsConnected() {
			log.Warn().Int("attempt", attempt).Msg("export worker: waiting for MQTT connection")
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
			continue
		}

		token := mqttClient.Subscribe(InternalTopic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
			msgCtx, payload := tsmqtt.ExtractTraceContext(ctx, msg.Payload())
			tracer := otel.Tracer(tracerName)
			msgCtx, span := tracer.Start(msgCtx, "export.consume_mqtt",
				oteltrace.WithSpanKind(oteltrace.SpanKindConsumer),
				oteltrace.WithAttributes(
					semconv.MessagingSystemKey.String("mqtt"),
					semconv.MessagingDestinationName(InternalTopic),
					semconv.MessagingOperationTypeKey.String("process"),
					attribute.Int("messaging.message.payload_size_bytes", len(msg.Payload())),
				),
			)

			var req JobRequest
			if err := json.Unmarshal(payload, &req); err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, "invalid message")
				span.End()
				log.Error().Err(err).Msg("export worker: invalid message")
				return
			}
			span.SetAttributes(
				attribute.String("export.job_id", req.JobID),
				attribute.String("export.type", req.Type),
				attribute.String("export.format", req.Format),
			)
			w.wg.Add(1)
			go func() {
				defer w.wg.Done()
				defer span.End()
				w.processJob(msgCtx, &req)
			}()
		})

		if token.WaitTimeout(10*time.Second) && token.Error() != nil {
			log.Warn().Err(token.Error()).Int("attempt", attempt).Msg("export worker: subscribe failed, retrying")
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
			continue
		}

		subscribed = true
		break
	}

	if !subscribed {
		log.Error().Msg("export worker: failed to subscribe after 10 attempts")
		return
	}

	log.Info().Str("topic", InternalTopic).Msg("export worker started")
	<-ctx.Done()
	mqttClient.Unsubscribe(InternalTopic)
	log.Info().Msg("export worker stopped")
}

func (w *Worker) processJob(ctx context.Context, req *JobRequest) {
	startTime := time.Now()
	log.Info().Str("job_id", req.JobID).Str("type", req.Type).Str("format", req.Format).Msg("export worker: processing job")

	// Atomically claim the job — prevents duplicate processing with multiple workers
	claimed, err := w.repo.UpdateStatusAtomic(ctx, req.JobID, string(StatusQueued), string(StatusProcessing))
	if err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: failed to claim job")
		return
	}
	if !claimed {
		log.Debug().Str("job_id", req.JobID).Msg("export worker: job already claimed by another worker")
		return
	}
	w.publishStatusEvent(ctx, req.JobID, string(StatusProcessing), req.Type, "", 0)

	// Process the export
	result, err := w.processor.Process(ctx, req)
	if err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: processing failed")
		if failErr := w.repo.Fail(ctx, req.JobID, err.Error()); failErr != nil {
			log.Error().Err(failErr).Str("job_id", req.JobID).Msg("export worker: failed to mark as failed")
		}
		w.publishStatusEvent(ctx, req.JobID, string(StatusFailed), req.Type, err.Error(), 0)
		return
	}

	// Store the result
	if err := w.repo.Complete(ctx, req.JobID, result.FileName, result.Data, result.RecordCount); err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: failed to store result")
		if failErr := w.repo.Fail(ctx, req.JobID, "failed to store result: "+err.Error()); failErr != nil {
			log.Error().Err(failErr).Str("job_id", req.JobID).Msg("export worker: failed to mark as failed")
		}
		w.publishStatusEvent(ctx, req.JobID, string(StatusFailed), req.Type, "failed to store result", 0)
		return
	}

	elapsed := time.Since(startTime)
	log.Info().
		Str("job_id", req.JobID).
		Str("type", req.Type).
		Str("file", result.FileName).
		Int("records", result.RecordCount).
		Int64("size_bytes", int64(len(result.Data))).
		Dur("elapsed", elapsed).
		Msg("export worker: job completed")

	w.publishStatusEvent(ctx, req.JobID, string(StatusReady), req.Type, "", result.RecordCount)
}

// Shutdown waits for all in-flight export jobs to complete,
// with a bounded 30-second timeout to prevent hanging indefinitely.
func (w *Worker) Shutdown() {
	log.Info().Msg("shutting down: waiting for in-flight export jobs...")
	done := make(chan struct{})
	go func() {
		w.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		log.Info().Msg("all export jobs completed, exiting cleanly")
	case <-time.After(30 * time.Second):
		log.Warn().Msg("shutdown timeout exceeded (30s), forcing exit with in-flight work abandoned")
	}
}

// StatusEvent is published to MQTT when an export job changes status.
// The API server subscribes to this topic and broadcasts via SSE.
const StatusTopic = "teslasync/events/export.status"

// publishStatusEvent sends a status change event via MQTT for SSE relay.
// The trace context from ctx is injected into the MQTT envelope so the
// SSE-relay span in the API server's subscriber callback (router.go)
// can chain under this worker's job-processing span.
func (w *Worker) publishStatusEvent(ctx context.Context, jobID, status, jobType, errMsg string, recordCount int) {
	if w.mqttClient == nil || !w.mqttClient.IsConnected() {
		return
	}
	evt := map[string]interface{}{
		"job_id":       jobID,
		"status":       status,
		"type":         jobType,
		"record_count": recordCount,
		"timestamp":    time.Now().UTC(),
	}
	if errMsg != "" {
		evt["error"] = errMsg
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	wrapped, err := tsmqtt.InjectTraceContext(ctx, data)
	if err != nil {
		log.Warn().Err(err).Str("job_id", jobID).Msg("export worker: failed to inject trace context into status event")
		wrapped = data
	}
	token := w.mqttClient.Publish(StatusTopic, 1, false, wrapped)
	token.WaitTimeout(2 * time.Second)
}

// Publish sends an export job request to the MQTT topic for async processing.
//
// Deprecated: prefer PublishCtx. This shim exists only for back-compat
// with non-ctx call sites.
func Publish(mqttClient pahomqtt.Client, req *JobRequest) error {
	return PublishCtx(context.Background(), mqttClient, req)
}

// PublishCtx injects W3C trace context from ctx into the MQTT envelope
// so the consumer-side export.consume_mqtt span nests under the
// caller's request span.
func PublishCtx(ctx context.Context, mqttClient pahomqtt.Client, req *JobRequest) error {
	if mqttClient == nil || !mqttClient.IsConnected() {
		return fmt.Errorf("MQTT not available")
	}

	data, err := json.Marshal(req)
	if err != nil {
		return err
	}

	tracer := otel.Tracer(tracerName)
	ctx, span := tracer.Start(ctx, "export.publish_mqtt",
		oteltrace.WithSpanKind(oteltrace.SpanKindProducer),
		oteltrace.WithAttributes(
			semconv.MessagingSystemKey.String("mqtt"),
			semconv.MessagingDestinationName(InternalTopic),
			semconv.MessagingOperationTypePublish,
			attribute.String("export.job_id", req.JobID),
			attribute.String("export.type", req.Type),
			attribute.String("export.format", req.Format),
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
		err := fmt.Errorf("MQTT publish timeout")
		span.RecordError(err)
		span.SetStatus(codes.Error, "mqtt publish timeout")
		return err
	}
	if err := token.Error(); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "mqtt publish error")
		return err
	}
	return nil
}
