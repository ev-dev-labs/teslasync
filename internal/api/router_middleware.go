package api

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	signal "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/worker"
)

// RouterOptions holds optional parameters for NewRouter.
type RouterOptions struct {
	AppVersion       string
	Encryptor        *crypto.Encryptor
	TelemetryHandler *TelemetryHandler      // If set, reuses existing handler (for hybrid mode wiring)
	GasPriceWorker   *worker.GasPriceWorker // If set, enables gas price management endpoints
	PollEngine       *polling.PollEngine    // If set, enables polling engine dashboard endpoints
	SignalStore      *signal.Store          // If set, enables /internal/flush endpoint
	WebhookTrigger   WebhookProcessor       // If set, enables public webhook receiver endpoint
	CacheStore       *cache.Store           // If set, enables cached endpoints (trip planner, etc.)
}

// settingsCheckerAdapter wraps *database.SettingsRepo to satisfy action.SettingsChecker.
// GetPollingConfig returns a default PollingConfig since per-vehicle polling tuning
// now lives in the `polling_config` table (ADR-011), not on the global settings repo.
type settingsCheckerAdapter struct {
	*database.SettingsRepo
}

func (a *settingsCheckerAdapter) GetPollingConfig(_ context.Context) (*models.PollingConfig, error) {
	return &models.PollingConfig{
		AwakeIntervalSec:   60,
		AsleepIntervalSec:  600,
		DrivingIntervalSec: 10,
		Enabled:            true,
	}, nil
}
