package api

import (
	"context"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	apidatarepair "github.com/ev-dev-labs/teslasync/internal/api/datarepair"
	apitelem "github.com/ev-dev-labs/teslasync/internal/api/telemetry"
	apiwhrx "github.com/ev-dev-labs/teslasync/internal/api/webhookreceiver"
	"github.com/ev-dev-labs/teslasync/internal/audit"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
	dbgdpr "github.com/ev-dev-labs/teslasync/internal/database/gdpr"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	"github.com/ev-dev-labs/teslasync/internal/dataquality"
	"github.com/ev-dev-labs/teslasync/internal/flags"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/rotation"
	"github.com/ev-dev-labs/teslasync/internal/schemacheck"
	signal "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/slo"
	"github.com/ev-dev-labs/teslasync/internal/synthetic"
	"github.com/ev-dev-labs/teslasync/internal/worker"
)

// RouterOptions holds optional parameters for NewRouter.
type RouterOptions struct {
	AppVersion        string
	Encryptor         *crypto.Encryptor
	TelemetryHandler  *apitelem.Handler        // If set, reuses existing handler (for hybrid mode wiring)
	GasPriceWorker    *worker.GasPriceWorker   // If set, enables gas price management endpoints
	PollEngine        *polling.PollEngine      // If set, enables polling engine dashboard endpoints
	SignalStore       *signal.Store            // If set, enables /internal/flush endpoint
	WebhookTrigger    apiwhrx.WebhookProcessor // If set, enables public webhook receiver endpoint
	CacheStore        *cache.Store             // If set, enables cached endpoints (trip planner, etc.)
	DataRepairScanner *apidatarepair.Scanner   // If set, shared by manual and scheduled integrity scans

	// DLQInspector and the replay audit repo enable
	// /system/dlq{,/{id},/{id}/replay} when set.
	// Constructed by internal/app once the production paho client is
	// connected (see internal/app/new.go::initFleetTelemetryPipeline).
	DLQInspector       *mqtt.DLQInspector
	DLQReplayAuditRepo *auditdb.DLQReplayAuditRepo

	// FlagStore and the changes-audit repo enable
	// /system/flags{,/{key},/changes} when set.
	FlagStore              *flags.Store
	FeatureFlagChangesRepo *auditdb.FeatureFlagChangesRepo

	// Operator confidence subsystems are optional. When nil, the corresponding
	// admin handler returns 503
	// with the SUBSYSTEM_NOT_CONFIGURED code so the SPA can render
	// a clean "not available on this deployment" panel.
	AuditRecorder         *audit.Recorder
	AuditLogQueryRepo     *auditdb.AuditLogQueryRepo
	SlowQueriesRepo       *dbobs.SlowQueriesRepo
	HypertableMetricsRepo *dbobs.HypertableMetricsRepo
	IngestXRayRepo        *dbobs.IngestXRayRepo
	GDPRArtifactRepo      *dbgdpr.ArtifactRepo
	RotationTracker       *rotation.Tracker
	SchemaSeed            schemacheck.Fingerprint

	// Observability subsystems are optional. Nil flips the corresponding admin
	// endpoint to 503
	// SUBSYSTEM_NOT_CONFIGURED so the SPA can render a clean
	// "not enabled on this deployment" panel instead of crashing.
	//
	//   SLOCatalog + SLOTracker:    /admin/observability/slo
	//   DataQualityScorer:          /admin/observability/data-quality
	//   SyntheticRunner:            /admin/observability/synthetic
	//
	// Lineage (/admin/observability/lineage) is always-on because it
	// reads the embedded routing.yaml — no runtime dependency.
	SLOCatalog        *slo.Catalog
	SLOTracker        *slo.Tracker
	DataQualityScorer *dataquality.Scorer
	SyntheticRunner   *synthetic.Runner
}

// settingsCheckerAdapter wraps *settingsdb.SettingsRepo to satisfy action.SettingsChecker.
// GetPollingConfig returns a default PollingConfig since per-vehicle polling tuning
// now lives in the `polling_config` table (ADR-011), not on the global settings repo.
type settingsCheckerAdapter struct {
	*settingsdb.SettingsRepo
}

func (a *settingsCheckerAdapter) GetPollingConfig(_ context.Context) (*systemmodel.PollingConfig, error) {
	return &systemmodel.PollingConfig{
		AwakeIntervalSec:   60,
		AsleepIntervalSec:  600,
		DrivingIntervalSec: 10,
		Enabled:            true,
	}, nil
}
