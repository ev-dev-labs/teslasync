package embedding

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Worker periodically backfills embeddings for new drives, charges, and
// alerts. It runs as a single goroutine and is safe to launch under
// resilience.SafeGoLoop — Run will exit cleanly when ctx is canceled.
type Worker struct {
	svc        *Service
	driveRepo  *database.DriveRepo
	chargeRepo *database.ChargingRepo
	alertRepo  *database.AlertRepo
	interval   time.Duration
	batchSize  int
}

// NewWorker constructs a backfill worker.
func NewWorker(svc *Service, db *database.DB, interval time.Duration, batchSize int) *Worker {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	if batchSize <= 0 {
		batchSize = 50
	}
	return &Worker{
		svc:        svc,
		driveRepo:  database.NewDriveRepo(db),
		chargeRepo: database.NewChargingRepo(db),
		alertRepo:  database.NewAlertRepo(db),
		interval:   interval,
		batchSize:  batchSize,
	}
}

// Run blocks until ctx is canceled, processing batches every interval.
func (w *Worker) Run(ctx context.Context) {
	if !w.svc.Enabled() {
		log.Info().Msg("embedding worker: disabled, exiting")
		return
	}
	log.Info().
		Dur("interval", w.interval).
		Int("batch", w.batchSize).
		Msg("embedding worker started")

	// Run once at startup so freshly enabled installs catch up quickly.
	w.tick(ctx)

	t := time.NewTicker(w.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.tick(ctx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	w.processDrives(ctx)
	w.processCharges(ctx)
	w.processAlerts(ctx)
}

func (w *Worker) processDrives(ctx context.Context) {
	ids, err := w.svc.FindMissingDrives(ctx, w.batchSize)
	if err != nil {
		log.Warn().Err(err).Msg("embedding worker: find missing drives")
		return
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		d, err := w.driveRepo.GetByID(ctx, id)
		if err != nil || d == nil {
			continue
		}
		if err := w.svc.GenerateDriveEmbedding(ctx, d); err != nil {
			log.Warn().Err(err).Int64("drive_id", id).Msg("embedding worker: drive failed")
		}
	}
	if len(ids) > 0 {
		log.Info().Int("count", len(ids)).Msg("embedding worker: drives processed")
	}
}

func (w *Worker) processCharges(ctx context.Context) {
	ids, err := w.svc.FindMissingCharges(ctx, w.batchSize)
	if err != nil {
		log.Warn().Err(err).Msg("embedding worker: find missing charges")
		return
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		c, err := w.chargeRepo.GetByID(ctx, id)
		if err != nil || c == nil {
			continue
		}
		if err := w.svc.GenerateChargeEmbedding(ctx, c); err != nil {
			log.Warn().Err(err).Int64("charge_id", id).Msg("embedding worker: charge failed")
		}
	}
	if len(ids) > 0 {
		log.Info().Int("count", len(ids)).Msg("embedding worker: charges processed")
	}
}

func (w *Worker) processAlerts(ctx context.Context) {
	ids, err := w.svc.FindMissingAlerts(ctx, w.batchSize)
	if err != nil {
		log.Warn().Err(err).Msg("embedding worker: find missing alerts")
		return
	}
	if len(ids) == 0 {
		return
	}
	// AlertRepo doesn't expose a GetByID; fetch the recent batch and filter.
	alerts, err := w.alertRepo.GetAll(ctx, len(ids)*4, 0)
	if err != nil {
		log.Warn().Err(err).Msg("embedding worker: list alerts")
		return
	}
	wanted := make(map[int64]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	processed := 0
	for _, a := range alerts {
		if ctx.Err() != nil {
			return
		}
		if !wanted[a.ID] {
			continue
		}
		if err := w.svc.GenerateAlertEmbedding(ctx, a); err != nil {
			log.Warn().Err(err).Int64("alert_id", a.ID).Msg("embedding worker: alert failed")
			continue
		}
		processed++
	}
	if processed > 0 {
		log.Info().Int("count", processed).Msg("embedding worker: alerts processed")
	}
}
