package export

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Worker subscribes to the internal MQTT export topic and processes
// export jobs asynchronously with retry logic.
type Worker struct {
	repo       *database.ExportJobRepo
	processor  *Processor
	mqttClient pahomqtt.Client
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
			var req models.ExportJobRequest
			if err := json.Unmarshal(msg.Payload(), &req); err != nil {
				log.Error().Err(err).Msg("export worker: invalid message")
				return
			}
			w.processJob(ctx, &req)
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

func (w *Worker) processJob(ctx context.Context, req *models.ExportJobRequest) {
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
	w.publishStatusEvent(req.JobID, string(StatusProcessing), req.Type, "", 0)

	// Process the export
	result, err := w.processor.Process(ctx, req)
	if err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: processing failed")
		if failErr := w.repo.Fail(ctx, req.JobID, err.Error()); failErr != nil {
			log.Error().Err(failErr).Str("job_id", req.JobID).Msg("export worker: failed to mark as failed")
		}
		w.publishStatusEvent(req.JobID, string(StatusFailed), req.Type, err.Error(), 0)
		return
	}

	// Store the result
	if err := w.repo.Complete(ctx, req.JobID, result.FileName, result.Data, result.RecordCount); err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: failed to store result")
		if failErr := w.repo.Fail(ctx, req.JobID, "failed to store result: "+err.Error()); failErr != nil {
			log.Error().Err(failErr).Str("job_id", req.JobID).Msg("export worker: failed to mark as failed")
		}
		w.publishStatusEvent(req.JobID, string(StatusFailed), req.Type, "failed to store result", 0)
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

	w.publishStatusEvent(req.JobID, string(StatusReady), req.Type, "", result.RecordCount)
}

// StatusEvent is published to MQTT when an export job changes status.
// The API server subscribes to this topic and broadcasts via SSE.
const StatusTopic = "teslasync/events/export.status"

// publishStatusEvent sends a status change event via MQTT for SSE relay.
func (w *Worker) publishStatusEvent(jobID, status, jobType, errMsg string, recordCount int) {
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
	token := w.mqttClient.Publish(StatusTopic, 1, false, data)
	token.WaitTimeout(2 * time.Second)
}

// Publish sends an export job request to the MQTT topic for async processing.
func Publish(mqttClient pahomqtt.Client, req *models.ExportJobRequest) error {
	if mqttClient == nil || !mqttClient.IsConnected() {
		return fmt.Errorf("MQTT not available")
	}

	data, err := json.Marshal(req)
	if err != nil {
		return err
	}

	token := mqttClient.Publish(InternalTopic, 1, false, data)
	if !token.WaitTimeout(5 * time.Second) {
		return fmt.Errorf("MQTT publish timeout")
	}
	return token.Error()
}
