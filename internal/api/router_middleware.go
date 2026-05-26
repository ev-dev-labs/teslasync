package api

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/audit"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/flags"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/rotation"
	"github.com/ev-dev-labs/teslasync/internal/schemacheck"
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

	// Phase-44 / observability-batch / Prompt F4. DLQInspector + replay
	// audit repo enable /system/dlq{,/{id},/{id}/replay} when set.
	// Constructed by internal/app once the production paho client is
	// connected (see internal/app/new.go::initFleetTelemetryPipeline).
	DLQInspector       *mqtt.DLQInspector
	DLQReplayAuditRepo *database.DLQReplayAuditRepo

	// Phase-44 / observability-batch / Prompt F8. FlagStore +
	// changes-audit repo enable /system/flags{,/{key},/changes} when set.
	FlagStore              *flags.Store
	FeatureFlagChangesRepo *database.FeatureFlagChangesRepo

	// Phase-45 — Operator confidence subsystems. Each pointer is
	// optional; when nil the corresponding admin handler returns 503
	// with the SUBSYSTEM_NOT_CONFIGURED code so the SPA can render
	// a clean "not available on this deployment" panel.
	AuditRecorder         *audit.Recorder
	AuditLogQueryRepo     *database.AuditLogQueryRepo
	SlowQueriesRepo       *database.SlowQueriesRepo
	HypertableMetricsRepo *database.HypertableMetricsRepo
	IngestXRayRepo        *database.IngestXRayRepo
	GDPRArtifactRepo      *database.GDPRArtifactRepo
	RotationTracker       *rotation.Tracker
	SchemaSeed            schemacheck.Fingerprint
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
