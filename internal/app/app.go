package app

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api"
	apidatarepair "github.com/ev-dev-labs/teslasync/internal/api/datarepair"
	apitelem "github.com/ev-dev-labs/teslasync/internal/api/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/audit"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
	dbgdpr "github.com/ev-dev-labs/teslasync/internal/database/gdpr"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
	"github.com/ev-dev-labs/teslasync/internal/dataquality"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/flags"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/rotation"
	"github.com/ev-dev-labs/teslasync/internal/schemacheck"
	sigsvc "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/slo"
	"github.com/ev-dev-labs/teslasync/internal/synthetic"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/worker"
)

// BuildInfo carries the ldflags-set version metadata. The cmd/teslasync
// package owns the actual `var Version` / `var Commit` declarations
// (kept there so the existing Dockerfile -X flags still bind) and
// passes them through to [New].
type BuildInfo struct {
	Version string
	Commit  string
}

// ErrMigrateOnly is returned by [New] when MIGRATE_ONLY=true; the
// caller should still invoke [App.Close] on the returned non-nil App
// so the partially-initialised resources (database, tracer) shut
// down cleanly.
var ErrMigrateOnly = errors.New("app: MIGRATE_ONLY=true; migrations applied, exit requested")

// App is the assembled TeslaSync API server. Construct it via [New];
// release resources via [App.Close]; serve HTTP via [App.Run].
//
// Field exposure intentionally mirrors what the legacy main.go shared
// across its function-scope local variables — internal/api.NewRouter
// reads many of them and several startup goroutines hold references
// to others. New fields should be added only with a clear consumer.
type App struct {
	Cfg    *config.Config
	Build  BuildInfo
	Health *resilience.HealthMonitor

	startupStart time.Time

	// Storage + cache
	DB    *database.DB
	Cache *cache.Store

	// Messaging
	MQTT     *mqtt.Client
	EventBus *events.Bus

	// Crypto + external clients
	Encryptor   *crypto.Encryptor
	TeslaClient *tesla.Client

	// API call logging
	APILogRepo         *systemdb.APICallLogRepo
	InboundAPILogger   api.APICallLogger
	OutboundAPILogSink httputil.APICallSink

	// Telemetry pipeline (set only when cfg.FleetTelemetry.Enabled)
	TelemetryHandler    *apitelem.Handler
	SignalStore         *sigsvc.Store
	SignalHistoryWriter *signaldb.SignalHistoryWriter
	StateReader         *sigsvc.LogStateReader
	LiveSignalStore     sigsvc.LiveSignalStore

	// Fleet telemetry pipeline subscriber resources
	pipelineSubscriber *mqtt.PipelineSubscriber

	// DLQ inspector subscribes to {TopicBase}/dlq/# and serves /system/dlq/*.
	DLQInspector       *mqtt.DLQInspector
	DLQReplayAuditRepo *auditdb.DLQReplayAuditRepo

	// Redis-backed feature-flag store and change audit repo.
	FlagStore              *flags.Store
	FeatureFlagChangesRepo *auditdb.FeatureFlagChangesRepo

	// Operator observability dependencies are constructed after DB startup
	// and passed through RouterOptions to handler/v1.
	AuditRecorder         *audit.Recorder
	AuditLogQueryRepo     *auditdb.AuditLogQueryRepo
	SlowQueriesRepo       *dbobs.SlowQueriesRepo
	HypertableMetricsRepo *dbobs.HypertableMetricsRepo
	IngestXRayRepo        *dbobs.IngestXRayRepo
	GDPRArtifactRepo      *dbgdpr.ArtifactRepo
	RotationTracker       *rotation.Tracker
	SchemaSeed            schemacheck.Fingerprint

	// SLO, data-quality, and synthetic-check services.
	SLOCatalog        *slo.Catalog
	SLOTracker        *slo.Tracker
	DataQualityScorer *dataquality.Scorer
	SyntheticRunner   *synthetic.Runner
	DataRepairScanner *apidatarepair.Scanner

	// Workers
	Worker         *worker.Worker
	PollEngine     *polling.PollEngine
	GasPriceWorker *worker.GasPriceWorker

	// Health watchdog state — kept on App so the watchdog goroutine
	// can mutate it without an unbounded closure capture. healthTracker
	// converts raw HealthMonitor snapshots into edge-triggered,
	// cooldown-debounced outage/recovery notification events (see
	// health_notify.go); notifRepo/prefRepo are reused to fan those
	// events out to enabled, preference-matching channels.
	healthTracker       *componentHealthTracker
	notifRepo           *dbnotif.NotificationRepo
	prefRepo            *dbnotif.NotificationPreferenceRepo
	onboardingRepo      *dbuser.OnboardingRepo
	onboardingStateRepo *dbuser.OnboardingStateRepo
	healthNotifications *componentNotificationCache

	// OpenAPI spec (best-effort; nil if not found at startup)
	openAPISpec []byte

	// Lifecycle
	closersMu sync.Mutex
	closers   []namedCloser

	// HTTP server (assigned in Run)
	server *http.Server
}

// namedCloser pairs a closer fn with a label so shutdown logging is
// useful when something stalls.
type namedCloser struct {
	name string
	fn   func(context.Context) error
}

// addCloser registers a LIFO cleanup hook. Each init* method calls
// this immediately after a long-lived resource is constructed so
// Close() unwinds in the inverse order, preserving the legacy
// `defer x.Close()` semantics from the old main.go.
func (a *App) addCloser(name string, fn func(context.Context) error) {
	a.closersMu.Lock()
	defer a.closersMu.Unlock()
	a.closers = append(a.closers, namedCloser{name: name, fn: fn})
}

// Close runs the registered shutdown hooks in LIFO order. Each hook
// gets at most 10s of the supplied context's remaining time. Errors
// from individual closers are logged but do not abort the unwind —
// every resource gets its turn to release. Safe to call exactly once
// per App; subsequent calls are no-ops.
func (a *App) Close(ctx context.Context) {
	a.closersMu.Lock()
	closers := a.closers
	a.closers = nil
	a.closersMu.Unlock()

	for i := len(closers) - 1; i >= 0; i-- {
		c := closers[i]
		hookCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := c.fn(hookCtx); err != nil {
			log.Warn().Err(err).Str("closer", c.name).Msg("shutdown hook returned error")
		}
		cancel()
	}
}
