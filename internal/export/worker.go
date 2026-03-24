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
	repo      *database.ExportJobRepo
	processor *Processor
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

	// Mark as processing
	if err := w.repo.UpdateStatus(ctx, req.JobID, string(StatusProcessing)); err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: failed to update status")
		return
	}

	// Process the export
	result, err := w.processor.Process(ctx, req)
	if err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: processing failed")
		if failErr := w.repo.Fail(ctx, req.JobID, err.Error()); failErr != nil {
			log.Error().Err(failErr).Str("job_id", req.JobID).Msg("export worker: failed to mark as failed")
		}
		return
	}

	// Store the result
	if err := w.repo.Complete(ctx, req.JobID, result.FileName, result.Data, result.RecordCount); err != nil {
		log.Error().Err(err).Str("job_id", req.JobID).Msg("export worker: failed to store result")
		if failErr := w.repo.Fail(ctx, req.JobID, "failed to store result: "+err.Error()); failErr != nil {
			log.Error().Err(failErr).Str("job_id", req.JobID).Msg("export worker: failed to mark as failed")
		}
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
