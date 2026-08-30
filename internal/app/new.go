package app

import (
	"context"
	"errors"
	"fmt"
	"net/http/cookiejar"
	"os"
	"strings"
	"sync/atomic"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api"
	apidatarepair "github.com/ev-dev-labs/teslasync/internal/api/datarepair"
	apiopenapi "github.com/ev-dev-labs/teslasync/internal/api/openapi"
	apisystem "github.com/ev-dev-labs/teslasync/internal/api/system"
	apitelem "github.com/ev-dev-labs/teslasync/internal/api/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/ev-dev-labs/teslasync/internal/audit"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
	dbgdpr "github.com/ev-dev-labs/teslasync/internal/database/gdpr"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	telemetrydb "github.com/ev-dev-labs/teslasync/internal/database/telemetry"
	teslabudgetdb "github.com/ev-dev-labs/teslasync/internal/database/teslabudget"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/dataquality"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/flags"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	hadiscovery "github.com/ev-dev-labs/teslasync/internal/integrations/homeassistant"
	embeddingsjobs "github.com/ev-dev-labs/teslasync/internal/jobs/embeddings"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/rotation"
	"github.com/ev-dev-labs/teslasync/internal/schemacheck"
	sigsvc "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/slo"
	"github.com/ev-dev-labs/teslasync/internal/synthetic"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router/writers"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	teslapipeline "github.com/ev-dev-labs/teslasync/internal/tesla_pipeline"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/ev-dev-labs/teslasync/internal/webpush"
	"github.com/ev-dev-labs/teslasync/internal/worker"

	"github.com/ev-dev-labs/teslasync/internal/adapter/gasprices"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// appBackgroundTracerName scopes spans for in-API background ticker loops
// owned by App (signal-history TTL, trip generator, AI background jobs,
// health watchdog). Each loop's per-iteration span lets dashboards
// distinguish a slow tick from a stuck tick.
const appBackgroundTracerName = "internal/app/background"

func appBackgroundTracer() oteltrace.Tracer { return otel.Tracer(appBackgroundTracerName) }

// New constructs the App in startup order. Closers are registered
// immediately after each resource is constructed so the LIFO unwind in
// [App.Close] matches the original defer ordering.
//
// Returns (a, ErrMigrateOnly) when MIGRATE_ONLY=true so that
// callers can run a.Close on already-opened resources (database,
// tracer) before exiting.
func New(ctx context.Context, cfg *config.Config, build BuildInfo) (*App, error) {
	a := &App{
		Cfg:           cfg,
		Build:         build,
		Health:        resilience.NewHealthMonitor(),
		startupStart:  time.Now(),
		healthTracker: newComponentHealthTracker(componentNotifyCooldown),
	}
	a.Health.Register("database")
	a.Health.Register("mqtt")
	a.Health.Register("tesla_api")
	a.Health.Register("worker")
	// redis: only meaningfully checked when REDIS_ENABLED=true (see
	// runHealthWatchdogTick) — registered unconditionally so it always
	// shows up in /system/status, staying "unknown" (never "healthy")
	// when Redis isn't configured, per the "don't pretend a component
	// is healthy" rule.
	a.Health.Register("redis")
	// telemetry: pipeline/global Fleet Telemetry ingest freshness (NOT
	// per-vehicle sleep-aware) — see runHealthWatchdogTick for the exact
	// conservative semantics documented there.
	a.Health.Register("telemetry")

	a.initTracing(ctx)

	if err := a.initDatabase(ctx); err != nil {
		return a, err
	}

	if os.Getenv("MIGRATE_ONLY") == "true" {
		return a, ErrMigrateOnly
	}

	a.initMQTT(ctx)
	a.initCache()
	a.initFlagStore(ctx)
	a.initObservabilityPhase45(ctx)
	a.initObservabilityPhase46()
	a.initHomeAssistantPublisher(ctx)
	a.initEventBus()
	a.initEncryptor()
	a.initTeslaClient()
	a.initAPILogging()
	a.initOutboundSinks()
	a.initWebPush()
	a.initStateReader()

	if err := a.initTelemetryHandler(ctx); err != nil {
		return a, err
	}
	a.initChargingPlaceHistoryBackfill(ctx)

	a.initWorker(ctx)
	a.initNotificationWorker(ctx)
	a.initMaintenanceWorker(ctx)
	a.initSignalHistoryCleanup(ctx)
	a.initTripGenerator(ctx)
	a.initGasPriceWorker(ctx)
	a.initUnitDriftValidator(ctx)
	a.initAIBackgroundJobs(ctx)
	a.initDataRepairScanner(ctx)
	a.initHealthWatchdog(ctx)
	a.loadOpenAPISpec()

	return a, nil
}

func (a *App) initTracing(ctx context.Context) {
	shutdownTracer, err := tracing.Init(ctx, a.Cfg)
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize tracing, continuing without it")
		return
	}
	if a.Cfg.OpenTelemetry.Enabled {
		log.Info().
			Str("endpoint", a.Cfg.OTLPEndpoint).
			Str("service", a.Cfg.OpenTelemetry.ServiceName).
			Msg("OpenTelemetry tracing enabled")
		a.addCloser("tracer", func(ctx context.Context) error {
			shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			return shutdownTracer(shutdownCtx)
		})
	}

	shutdownProfiler, err := tracing.StartProfiler(ctx, a.Cfg, a.Cfg.OpenTelemetry.ServiceName)
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize pyroscope profiler, continuing without it")
		return
	}
	if a.Cfg.Profiling.Enabled && a.Cfg.Profiling.ServerAddress != "" {
		log.Info().
			Str("server", a.Cfg.Profiling.ServerAddress).
			Str("service", a.Cfg.OpenTelemetry.ServiceName).
			Dur("upload_rate", a.Cfg.Profiling.UploadRate).
			Msg("Pyroscope continuous profiling enabled")
		a.addCloser("profiler", func(ctx context.Context) error {
			shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			return shutdownProfiler(shutdownCtx)
		})
	}
}

func (a *App) initDatabase(ctx context.Context) error {
	err := resilience.ConnectWithRetry(ctx, "database", 10, func(ctx context.Context) error {
		var connErr error
		a.DB, connErr = database.New(ctx, a.Cfg.Database)
		return connErr
	})
	if err != nil {
		return fmt.Errorf("database: failed to connect after retries: %w", err)
	}
	a.addCloser("database", func(_ context.Context) error {
		a.DB.Close()
		return nil
	})
	a.Health.RecordSuccess("database")

	if err := a.DB.Migrate(a.Cfg.Database.MigrationsPath, a.Cfg.Database); err != nil {
		return fmt.Errorf("database: migrations failed: %w", err)
	}
	log.Info().Msg("database migrations applied")

	var migVer int
	if err := a.DB.Pool.QueryRow(ctx, "SELECT version FROM schema_migrations LIMIT 1").Scan(&migVer); err == nil {
		metrics.MigrationVersion.Set(float64(migVer))
	}
	return nil
}

func (a *App) initMQTT(ctx context.Context) {
	if !a.Cfg.MQTT.Enabled {
		return
	}
	mqttErr := resilience.ConnectWithRetry(ctx, "mqtt", 5, func(ctx context.Context) error {
		var connErr error
		a.MQTT, connErr = mqtt.NewClient(a.Cfg.MQTT)
		return connErr
	})
	if mqttErr != nil {
		log.Warn().Err(mqttErr).Msg("MQTT unavailable — running in degraded mode without real-time MQTT publishing")
		a.Health.RecordFailure("mqtt", mqttErr)
		metrics.MQTTConnected.Set(0)
		a.MQTT = nil
		return
	}
	a.addCloser("mqtt", func(_ context.Context) error {
		a.MQTT.Disconnect()
		return nil
	})
	a.Health.RecordSuccess("mqtt")
	metrics.MQTTConnected.Set(1)
	log.Info().Msg("connected to MQTT broker")
}

func (a *App) initCache() {
	a.Cache = cache.New(a.Cfg.Redis)
	a.addCloser("cache", func(_ context.Context) error {
		a.Cache.Close()
		return nil
	})
}

// initFlagStore wires the dynamic feature-flag store and change audit repo.
//
// The store gracefully degrades to in-process cache + defaults when
// Redis is disabled (a.Cache.Underlying() returns nil). The audit repo
// is wired only when a.DB is initialised — read-only handlers degrade
// to 503 when nil. Pub/Sub invalidation runs in a background goroutine
// shut down via a.addCloser.
func (a *App) initFlagStore(ctx context.Context) {
	var rdb = a.Cache.Underlying() // may be nil — store handles that
	a.FlagStore = flags.NewStore(rdb)
	shutdown := a.FlagStore.Start(ctx)
	a.addCloser("flag-store", func(_ context.Context) error {
		shutdown()
		return nil
	})
	if a.DB != nil {
		a.FeatureFlagChangesRepo = auditdb.NewFeatureFlagChangesRepo(a.DB)
	}
	log.Info().
		Bool("redis_backed", rdb != nil).
		Bool("audit_repo", a.FeatureFlagChangesRepo != nil).
		Msg("dynamic feature flag store initialised")
}

func (a *App) initEventBus() {
	if a.MQTT != nil {
		a.EventBus = events.NewBus(a.MQTT.Underlying())
	} else {
		a.EventBus = events.NewBus(nil)
	}
}

// initObservabilityPhase45 wires the operator-confidence subsystems:
// hash-chained audit recorder, schema-fingerprint seed,
// slow-query / disk-forecast / per-vehicle-cost / GDPR-artifact repos,
// and secret rotation tracker. All are best-effort — when a backing
// dependency is missing (DB not up, pg_stat_statements absent,
// timescaledb absent), the corresponding handler returns 503 instead
// of crashing on a nil pointer.
//
// The schema-fingerprint seed is computed on first call and persisted
// in schema_fingerprint so subsequent boots compare against the
// original deploy snapshot rather than the live schema (the diff
// against live always reads zero).
//
// APP_SECRET_PEPPER is required for HMAC-based secret rotation
// fingerprinting; when missing, the rotation tracker is disabled and
// the admin handler returns 503 for the rotation route.
func (a *App) initObservabilityPhase45(ctx context.Context) {
	if a.DB == nil {
		log.Warn().Msg("phase-45: database not initialised — observability surface unavailable")
		return
	}
	a.AuditLogQueryRepo = auditdb.NewAuditLogQueryRepo(a.DB)
	a.SlowQueriesRepo = dbobs.NewSlowQueriesRepo(a.DB)
	a.HypertableMetricsRepo = dbobs.NewHypertableMetricsRepo(a.DB)
	a.IngestXRayRepo = dbobs.NewIngestXRayRepo(a.DB.Pool)
	a.GDPRArtifactRepo = dbgdpr.NewArtifactRepo(a.DB)

	// Audit recorder is the unified hash-chained writer. Falls back
	// to deny-all redactor; callers pass an explicit redactor when
	// recording fields that may contain PII.
	a.AuditRecorder = audit.New(a.DB.Pool, audit.DenyAllRedactor{})
	if err := a.AuditRecorder.Hydrate(ctx); err != nil {
		log.Warn().Err(err).Msg("phase-45: audit recorder hydrate failed — chain may restart")
	}

	// Schema fingerprint seed — load from schema_fingerprint or
	// compute + persist on first boot.
	if seed, err := loadOrComputeSchemaSeed(ctx, a); err != nil {
		log.Warn().Err(err).Msg("phase-45: schema seed unavailable — drift report degraded")
	} else {
		a.SchemaSeed = seed
	}

	// Secret rotation tracker — requires APP_SECRET_PEPPER.
	if pepper := envValue("APP_SECRET_PEPPER"); pepper != "" {
		a.RotationTracker = rotation.New(a.DB.Pool, pepper)
	} else {
		log.Warn().Msg("phase-45: APP_SECRET_PEPPER not set — secret rotation tracker disabled")
	}

	log.Info().
		Bool("audit_recorder", a.AuditRecorder != nil).
		Bool("rotation_tracker", a.RotationTracker != nil).
		Bool("schema_seed", a.SchemaSeed.SHA256 != "").
		Msg("phase-45 operator confidence initialised")
}

// initObservabilityPhase46 wires observability subsystems:
//
//	SLO catalog + tracker — slo/catalog.yaml + Prometheus-backed
//	  live tier evaluation. Catalog load failure surfaces 503 on
//	  /admin/observability/slo; PROMETHEUS_BASE_URL empty disables
//	  live tier evaluation but still serves catalog metadata.
//
//	Data-quality scorer — pgxpool-backed per-field freshness / gap /
//	  duplicate scoring over signal_log. DATA_QUALITY_ENABLED=false
//	  flips /admin/observability/data-quality to 503.
//
//	Synthetic runner — outside-in HTTP canary probes. Reads
//	  SYNTHETIC_PROBE_URLS (comma-separated). Disabled by default
//	  to keep test + dev quiet; opt in via SYNTHETIC_ENABLED=true.
//
// Lineage (/admin/observability/lineage) is always-on because it
// reads the embedded routing.yaml — no runtime dependency.
//
// Each subsystem is independent: SLO load failure does NOT block
// data-quality or synthetic; synthetic disabled does NOT block SLO.
func (a *App) initObservabilityPhase46() {
	// SLO catalog + tracker.
	if path := a.Cfg.SLO.CatalogPath; path != "" {
		if cat, err := slo.LoadCatalog(path); err != nil {
			log.Warn().Err(err).Str("path", path).Msg("phase-46: SLO catalog load failed — slo board degraded")
		} else {
			a.SLOCatalog = cat
		}
	}
	if a.SLOCatalog != nil {
		tracker, err := slo.NewTracker(a.Cfg.SLO.PromBaseURL)
		if err != nil {
			log.Warn().Err(err).Msg("phase-46: SLO tracker init failed — live tier evaluation disabled")
		} else {
			a.SLOTracker = tracker
		}
	}

	// Data-quality scorer.
	if a.Cfg.DataQuality.Enabled && a.DB != nil {
		a.DataQualityScorer = dataquality.NewScorerFromPool(a.DB.Pool, a.Cfg.DataQuality.WindowMins)
	}

	// Synthetic runner — built only when enabled; a nil runner makes the
	// admin observability endpoint report that synthetic monitoring is not
	// configured. Startup is deferred until the public listener is bound.
	if a.Cfg.Synthetic.Enabled {
		probes := buildSyntheticProbes(a.Cfg.Synthetic.ProbeURLs)
		if baseURL := strings.TrimSpace(a.Cfg.Synthetic.JourneyBaseURL); baseURL != "" {
			journey, err := buildOperatorChainJourneyProbe(
				baseURL,
				time.Duration(a.Cfg.Synthetic.TimeoutSeconds)*time.Second,
				a.Cfg.Auth.ForwardAuthHeader,
			)
			if err != nil {
				log.Error().Err(err).Msg("synthetic operator journey initialization failed")
			} else {
				probes = append(probes, journey)
			}
		}
		interval := time.Duration(a.Cfg.Synthetic.IntervalSeconds) * time.Second
		timeout := time.Duration(a.Cfg.Synthetic.TimeoutSeconds) * time.Second
		runner := synthetic.NewRunner(probes, interval, timeout)
		a.SyntheticRunner = runner
		a.addCloser("synthetic-runner", func(_ context.Context) error {
			runner.Stop()
			return nil
		})
	}

	log.Info().
		Bool("slo_catalog", a.SLOCatalog != nil).
		Bool("slo_tracker", a.SLOTracker != nil).
		Bool("dq_scorer", a.DataQualityScorer != nil).
		Bool("synthetic_runner", a.SyntheticRunner != nil).
		Msg("phase-46 observability batch initialised")
}

// buildSyntheticProbes parses the comma-separated SYNTHETIC_PROBE_URLS
// list into a set of HTTP probes. Each url becomes a probe named
// "http_<index>". Operators that want stable identifiers across URL
// reordering should run one probe per deployment.
func buildSyntheticProbes(raw string) []synthetic.Probe {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	probes := make([]synthetic.Probe, 0, len(parts))
	for i, p := range parts {
		url := strings.TrimSpace(p)
		if url == "" {
			continue
		}
		probes = append(probes, synthetic.NewHTTPProbe(fmt.Sprintf("http_%d", i), url))
	}
	return probes
}

// buildOperatorChainJourneyProbe wires the canonical critical-operator
// journey (dashboard/fleet state -> vehicle inspect -> battery health
// -> charging history) against baseURL. Step observations are exported
// as bounded-cardinality Prometheus metrics via
// metrics.ObserveSyntheticJourneyStep (labels: fixed journey + step
// names only — never vehicle IDs or VINs).
func buildOperatorChainJourneyProbe(baseURL string, timeout time.Duration, forwardAuthHeader string) (synthetic.Probe, error) {
	const journeyName = "operator_chain"
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, fmt.Errorf("create synthetic journey cookie jar: %w", err)
	}
	client := httputil.NewClient(httputil.ClientConfig{
		Name:    "synthetic-operator-chain",
		Timeout: timeout,
	})
	client.Jar = jar
	probe := synthetic.NewJourneyProbe(journeyName, baseURL, synthetic.OperatorChainJourneySteps(), client).
		WithObserver(func(journey string, step synthetic.JourneyStepResult) {
			metrics.ObserveSyntheticJourneyStep(journey, step.Name, step.OK, step.Skipped, step.DurationMs)
		})
	if forwardAuthHeader != "" {
		probe.WithHeader(forwardAuthHeader, "teslasync-synthetic")
	}
	return probe, nil
}

// initHomeAssistantPublisher wires the HomeAssistant MQTT discovery
// publisher when HOMEASSISTANT_ENABLED=true and the MQTT
// client is available. The publisher reasserts the full per-vehicle
// entity catalog on PublishInterval (default 1h); HA's discovery
// listener caches retained config topics so the interval primarily
// guards against display-name / model / sw_version drift.
//
// Failure modes are non-fatal: missing MQTT client logs + skips; the
// per-tick publish error is logged but doesn't kill the ticker.
func (a *App) initHomeAssistantPublisher(ctx context.Context) {
	if !a.Cfg.HomeAssistant.Enabled {
		return
	}
	if a.MQTT == nil {
		log.Warn().Msg("phase-47: homeassistant publisher requires MQTT — disabled")
		return
	}
	if a.DB == nil {
		log.Warn().Msg("phase-47: homeassistant publisher requires DB — disabled")
		return
	}
	publisher := hadiscovery.NewPublisher(
		a.MQTT.Underlying(),
		a.Cfg.HomeAssistant.DiscoveryPrefix,
		a.MQTT.Prefix(),
	)
	vehicleRepo := vehicledb.NewVehicleRepo(a.DB)
	interval := a.Cfg.HomeAssistant.PublishInterval
	if interval <= 0 {
		interval = time.Hour
	}
	publishOnce := func() {
		vehicles, err := vehicleRepo.GetAll(ctx)
		if err != nil {
			log.Warn().Err(err).Msg("phase-47: homeassistant publisher could not list vehicles")
			return
		}
		entities := hadiscovery.DefaultEntities()
		for _, v := range vehicles {
			if v == nil || v.VIN == "" {
				continue
			}
			model := ""
			if v.Model != nil {
				model = *v.Model
			}
			ha := hadiscovery.Vehicle{
				VIN:         v.VIN,
				DisplayName: v.DisplayName,
				Model:       model,
			}
			if err := publisher.PublishVehicle(ctx, ha, entities); err != nil {
				log.Warn().Err(err).Str("vin_prefix", redactVINPrefix(v.VIN)).
					Msg("phase-47: homeassistant publish failed")
			}
		}
	}
	go func() {
		// First publish right after boot so HA sees entities immediately.
		publishOnce()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				publishOnce()
			}
		}
	}()
	log.Info().
		Str("discovery_prefix", a.Cfg.HomeAssistant.DiscoveryPrefix).
		Dur("interval", interval).
		Msg("phase-47 homeassistant discovery publisher started")
}

// redactVINPrefix preserves the manufacturer WMI (first 3 chars) but
// strips the rest so VIN doesn't leak into log files.
func redactVINPrefix(vin string) string {
	if len(vin) < 3 {
		return "***"
	}
	return vin[:3] + "***"
}

// loadOrComputeSchemaSeed reads the most-recent schema_fingerprint
// row; if absent, computes one and inserts it.
func loadOrComputeSchemaSeed(ctx context.Context, a *App) (schemacheck.Fingerprint, error) {
	var seed schemacheck.Fingerprint
	err := a.DB.Pool.QueryRow(ctx,
		`SELECT sha256_hash, column_count, index_count, table_count
		   FROM schema_fingerprint ORDER BY generated_at DESC LIMIT 1`).
		Scan(&seed.SHA256, &seed.ColumnCount, &seed.IndexCount, &seed.TableCount)
	if err == nil && seed.SHA256 != "" {
		return seed, nil
	}
	// No seed row — compute + persist.
	seed, err = schemacheck.Compute(ctx, a.DB.Pool, []string{"schema_migrations"})
	if err != nil {
		return schemacheck.Fingerprint{}, err
	}
	_, _ = a.DB.Pool.Exec(ctx,
		`INSERT INTO schema_fingerprint (sha256_hash, column_count, index_count, table_count, git_sha, generated_at)
		 VALUES ($1, $2, $3, $4, $5, now())`,
		seed.SHA256, seed.ColumnCount, seed.IndexCount, seed.TableCount, envValue("GIT_SHA"))
	return seed, nil
}

// envValue is a tiny wrapper so callers don't need an os import here
// — keeps the new.go import list minimal.
func envValue(key string) string { return os.Getenv(key) }

func (a *App) initEncryptor() {
	a.Encryptor = crypto.NewFromEnv()
	if a.Encryptor != nil {
		log.Info().Msg("encryption enabled for sensitive data")
	}
}

func (a *App) initTeslaClient() {
	a.TeslaClient = tesla.NewClient(a.Cfg.Tesla)
	policy := tesla.NewBudgetPolicy(
		a.Cfg.Tesla.DailyBudgetUSD,
		a.Cfg.Tesla.CommandReserveUSD,
	)
	if policy.Enabled() {
		a.TeslaClient.SetRequestBudget(teslabudgetdb.New(a.DB.Pool, policy))
		log.Info().
			Float64("daily_limit_usd", a.Cfg.Tesla.DailyBudgetUSD).
			Float64("command_reserve_usd", a.Cfg.Tesla.CommandReserveUSD).
			Msg("shared Tesla Fleet API request budget enabled")
	} else {
		log.Warn().Msg("Tesla Fleet API request budget disabled; outbound spend is unbounded")
	}
}

func (a *App) initAPILogging() {
	a.APILogRepo = systemdb.NewAPICallLogRepo(a.DB)

	if a.Cfg.APILogs.Enabled {
		a.InboundAPILogger = apilog.NewAsync(a.APILogRepo, apilog.AsyncOptions{
			QueueCapacity: a.Cfg.APILogs.QueueCapacity,
			BatchSize:     a.Cfg.APILogs.BatchSize,
			FlushInterval: a.Cfg.APILogs.FlushInterval,
		})
		api.SetAPICallLogger(a.InboundAPILogger)
		log.Info().
			Bool("capture_bodies", a.Cfg.APILogs.CaptureBodies).
			Int("queue_capacity", a.Cfg.APILogs.QueueCapacity).
			Int("batch_size", a.Cfg.APILogs.BatchSize).
			Dur("flush_interval", a.Cfg.APILogs.FlushInterval).
			Msg("inbound api_call_logs middleware enabled")
	} else {
		log.Info().Msg("inbound api_call_logs middleware disabled (API_LOGS_INBOUND_ENABLED=false)")
	}

	a.TeslaClient.SetLogCallback(func(method, url string, statusCode int, reqBody, respBody []byte, durationMs int, callErr error) {
		logEntry := &teslamodel.APICallLog{
			HTTPMethod: method,
			Endpoint:   url,
			DurationMs: int32(durationMs),
			Service:    "tesla-api",
		}
		if statusCode > 0 {
			sc := int16(statusCode)
			logEntry.StatusCode = sc
		}
		if callErr != nil {
			s := callErr.Error()
			logEntry.ErrorMessage = &s
		}
		const maxBodyBytes = 10 * 1024
		if len(reqBody) > 0 {
			s := string(reqBody)
			if len(s) > maxBodyBytes {
				s = s[:maxBodyBytes] + "... [truncated]"
			}
			logEntry.RequestBody = &s
		}
		if len(respBody) > 0 {
			s := string(respBody)
			if len(s) > maxBodyBytes {
				s = s[:maxBodyBytes] + "... [truncated]"
			}
			logEntry.ResponseBody = &s
		}
		logCtx, logCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := a.APILogRepo.Create(logCtx, logEntry); err != nil {
			log.Error().Err(err).Msg("failed to log API call")
		}
		logCancel()
	})
}

// initOutboundSinks wires the shared outbound api_call_logs sink into
// every non-Tesla outbound HTTP adapter. See cmd/teslasync/main.go
// (legacy) lines 232-272 for the original commentary; the Tesla
// Fleet API client is intentionally excluded — it persists outbound
// rows via the SetLogCallback path above so wiring it through this
// sink would double-record every call.
func (a *App) initOutboundSinks() {
	a.OutboundAPILogSink = apilog.SinkAdapter(a.InboundAPILogger, a.Cfg.APILogs.CaptureBodies)
	log.Info().
		Bool("capture_bodies", a.Cfg.APILogs.CaptureBodies).
		Bool("logger_enabled", a.InboundAPILogger != nil).
		Msg("outbound api_call_logs sink ready")
	var _ httputil.APICallSink = a.OutboundAPILogSink

	apisystem.SetOutboundSink(a.OutboundAPILogSink)
	notification.SetSink(a.OutboundAPILogSink)
	geocoding.SetSink(a.OutboundAPILogSink)
	tesla.SetAuthSink(a.OutboundAPILogSink, a.Cfg.Tesla.Timeout)
}

func (a *App) initWebPush() {
	pushSubsRepo := dbnotif.NewPushSubscriptionsRepo(a.DB)
	webpushSvc := webpush.NewService(pushSubsRepo, a.Cfg.WebPush.PublicKey, a.Cfg.WebPush.PrivateKey, a.Cfg.WebPush.Subject)
	webpush.SetDefault(webpushSvc)
	if !webpushSvc.IsEnabled() {
		log.Warn().Msg("Web Push disabled — set TESLASYNC_VAPID_PUBLIC_KEY / TESLASYNC_VAPID_PRIVATE_KEY / TESLASYNC_VAPID_SUBJECT to enable")
	} else {
		log.Info().Msg("Web Push enabled (VAPID configured)")
	}
	notification.SetWebPushDispatcher(func(req *notification.Request) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, err := webpushSvc.Send(ctx, webpush.Payload{
			Title:    req.Title,
			Body:     req.Message,
			URL:      req.Config["url"],
			Tag:      req.Config["alert_tag"],
			Severity: req.Config["severity"],
		})
		return err
	})
}

func (a *App) initStateReader() {
	a.StateReader = sigsvc.NewLogStateReader(a.DB.Pool, log.With().Str("component", "state_reader").Logger())
}

// initTelemetryHandler runs only when cfg.FleetTelemetry.Enabled. It
// constructs the SignalStore + LiveSignalStore + warmup, starts the
// signal_history flush + cleanup loops, recovers active sessions,
// hydrates AlertEvaluator prevSignals, starts the FSM reconcile loop,
// optionally wires the MongoDB raw-telemetry capture, and starts the
// MQTT PipelineSubscriber, its writers, and side-effects observer.
// Returns an error for fatal misconfigurations or when the required MQTT
// ingest path cannot be established
// (invalid LIVE_SIGNAL_STORE_MODE, unavailable MQTT while Fleet Telemetry is
// enabled, or router/pipeline construction failure).
func (a *App) initTelemetryHandler(ctx context.Context) error {
	if !a.Cfg.FleetTelemetry.Enabled {
		return nil
	}
	if a.MQTT == nil {
		return errors.New("fleet telemetry is enabled but MQTT is unavailable")
	}
	if strings.TrimSpace(a.Cfg.FleetTelemetry.TopicBase) == "" {
		return errors.New("fleet telemetry is enabled but FLEET_TELEMETRY_TOPIC_BASE is empty")
	}

	a.TelemetryHandler = apitelem.NewHandler(
		a.DB,
		a.MQTT,
		nil,
		a.Cfg.FleetTelemetry.StaleTimeout,
		geocoding.NewGeocoder(a.Cfg.GoogleMaps.APIKey, a.Cfg.AzureMaps.APIKey),
	)
	a.TelemetryHandler.SetTimings(
		a.Cfg.FleetTelemetry.SnapshotWriteInterval,
		a.Cfg.FleetTelemetry.CleanupInterval,
		a.Cfg.FleetTelemetry.StaleSessionTimeout,
	)

	a.SignalStore = sigsvc.New()
	a.TelemetryHandler.SetSignalStore(a.SignalStore)
	a.TelemetryHandler.FSMHandler().SetSignalStore(a.SignalStore)

	var redisSignalCache *sigsvc.RedisSignalCache
	if rdb := a.Cache.Underlying(); rdb != nil {
		redisSignalCache = sigsvc.NewRedisSignalCache(rdb)
		a.TelemetryHandler.SetRedisCache(redisSignalCache)
		log.Info().Msg("redis signal cache enabled")
	}

	liveSignalStore, err := sigsvc.NewLiveSignalStore(a.SignalStore, redisSignalCache, a.Cfg.FleetTelemetry.LiveSignalStoreMode)
	if err != nil {
		return fmt.Errorf("invalid LIVE_SIGNAL_STORE_MODE %q: %w", a.Cfg.FleetTelemetry.LiveSignalStoreMode, err)
	}
	a.LiveSignalStore = liveSignalStore
	a.TelemetryHandler.SetLiveSignalStore(liveSignalStore)
	log.Info().
		Str("mode", a.Cfg.FleetTelemetry.LiveSignalStoreMode).
		Bool("redis_l2", redisSignalCache != nil).
		Msg("live signal store initialized")

	vehicleRepo := vehicledb.NewVehicleRepo(a.DB)
	vehicles, err := vehicleRepo.GetAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("live signal store: vehicle list unavailable during warmup")
	}

	for _, v := range vehicles {
		warmCtx, warmCancel := context.WithTimeout(ctx, 5*time.Second)
		if err := liveSignalStore.Warm(warmCtx, v.ID); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", v.ID).Msg("live signal store: Redis warmup failed")
		}
		warmCancel()
	}
	if len(vehicles) > 0 {
		log.Info().Int("vehicles", len(vehicles)).Msg("live signal store warmed from Redis")
	}

	a.SignalHistoryWriter = signaldb.NewSignalHistoryWriter(a.DB)
	a.TelemetryHandler.SetSignalHistoryWriter(a.SignalHistoryWriter)

	for _, v := range vehicles {
		warmupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		latest, err := a.StateReader.State(warmupCtx, v.ID, time.Now())
		cancel()
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", v.ID).Msg("warmup state read failed; vehicle will hydrate from live telemetry")
			continue
		}
		extra := make(map[string]interface{}, len(latest))
		for k, val := range latest {
			extra[k] = val
		}
		a.SignalStore.Hydrate(v.ID, extra)
	}
	if len(vehicles) > 0 {
		log.Info().Int("vehicles", len(vehicles)).Msg("signal store hydrated from signal_log via stateReader")
	}

	log.Info().Msg("signal store initialized")

	sessionTracker := a.TelemetryHandler.SessionTracker()
	signalLogReader := signaldb.NewSignalLogReader(a.DB)
	if sessionTracker != nil {
		sessionTracker.SetSignalLogReader(signalLogReader)
		sessionTracker.RecoverSessions(ctx)
		sessionTracker.ValidateRecoveredSessions(ctx)
		sessionTracker.RecoverIncompleteSessions(ctx)
		sessionTracker.StartBufferDrains(ctx)
	}

	alertEvaluator := a.TelemetryHandler.AlertEvaluator()
	if alertEvaluator != nil {
		// Rebuild the in-memory latch cache from alert_rule_state so
		// once-mode rules don't re-fire on pod restart
		// while their condition is still true. Idempotent + best-effort —
		// repo errors are logged inside HydrateFromDB and do not abort boot.
		alertEvaluator.RuleEngine().HydrateFromDB(ctx)
		for _, vid := range a.SignalStore.VehicleIDs() {
			raw := a.SignalStore.GetRawMap(vid)
			if raw != nil {
				alertEvaluator.RuleEngine().LoadPrevSignalsFromStore(vid, raw)
			}
		}
		log.Info().Msg("alert prevSignals populated from signal store")
	}

	log.Info().Msg("FSM vehicle state engine active — declarative transition table with 20 transitions")

	a.TelemetryHandler.FSMHandler().StartReconcileLoop()

	if a.Cfg.MongoDB.Enabled {
		mongoClient, err := database.NewMongoClient(a.Cfg.MongoDB)
		if err != nil {
			log.Warn().Err(err).Msg("MongoDB connection failed — raw telemetry capture disabled")
		} else {
			a.addCloser("mongodb", func(_ context.Context) error {
				mongoClient.Close()
				return nil
			})
			rawRepo := telemetrydb.NewRawTelemetryRepo(mongoClient)
			a.TelemetryHandler.SetRawTelemetryRepo(rawRepo)

			signalLogRepo := signaldb.NewSignalLogRepo(mongoClient)
			a.TelemetryHandler.SetSignalLogRepo(signalLogRepo)

			log.Info().Str("database", a.Cfg.MongoDB.Database).Int("ttl_days", a.Cfg.MongoDB.TTLDays).Msg("MongoDB raw telemetry capture + signal log available")

			settingsRepo := settingsdb.NewSettingsRepo(a.DB)
			if _, err := settingsRepo.GetPollingConfig(ctx); err == nil {
				log.Debug().Msg("polling config loaded (telemetry capture toggle removed)")
			}
		}
	}

	a.TelemetryHandler.StartCleanup(ctx)

	if sessionTracker != nil {
		go sessionTracker.BackfillAddresses(ctx)
	}

	if err := a.initPipelineSubscriber(ctx, vehicleRepo); err != nil {
		return err
	}
	return nil
}

// initChargingPlaceHistoryBackfill runs independently of Fleet Telemetry.
// Polling-only installations still have historical charging sessions that
// need place attribution and current-rate estimates.
func (a *App) initChargingPlaceHistoryBackfill(ctx context.Context) {
	var sessionTracker *apitelem.TelemetrySessionTracker
	if a.TelemetryHandler != nil {
		sessionTracker = a.TelemetryHandler.SessionTracker()
	} else {
		sessionTracker = apitelem.NewTelemetrySessionTracker(a.DB, a.EventBus, nil, nil)
	}
	sessionTracker.StartChargingPlaceHistoryBackfill(ctx)
}

// initPipelineSubscriber wires the telemetry ingest stack:
// 12 writers → router.New → unit-history cache+repo → SideEffectsObserver
// + SoftwareUpdateObserver → normalize.Pipeline → MQTT PipelineSubscriber.
// Any missing writer or invalid routing rule fails the process at startup;
// per ADR-004 #12 there is no feature flag and no parallel pipeline.
func (a *App) initPipelineSubscriber(ctx context.Context, vehicleRepo *vehicledb.VehicleRepo) error {
	pipelineLogger := log.With().Str("component", "tesla_pipeline").Logger()

	pipelineWriters := map[router.Destination]router.Writer{
		router.DestPositions:         writers.NewPositionsWriter(a.DB.Pool),
		router.DestClimateSnapshot:   writers.NewClimateWriter(a.DB.Pool),
		router.DestMotorSnapshot:     writers.NewMotorWriter(a.DB.Pool),
		router.DestTirePressure:      writers.NewTirePressureWriter(a.DB.Pool),
		router.DestMediaSnapshot:     writers.NewMediaWriter(a.DB.Pool),
		router.DestSafetySnapshot:    writers.NewSafetyWriter(a.DB.Pool),
		router.DestLocationSnapshot:  writers.NewLocationWriter(a.DB.Pool),
		router.DestSecurityEvent:     writers.NewSecurityEventWriter(a.DB.Pool),
		router.DestChargingTelemetry: writers.NewChargingTelemetryWriter(a.DB.Pool),
		router.DestDriveTelemetry:    writers.NewDriveTelemetryWriter(a.DB.Pool),
		router.DestSignalLog:         writers.NewSignalLogWriter(a.DB.Pool),
		router.DestUnitHistory:       writers.NewUnitHistoryWriter(),
	}

	pipelineRouter, err := router.New(pipelineWriters)
	if err != nil {
		return fmt.Errorf("phase-42a: router.New failed; cannot start fleet-telemetry pipeline: %w", err)
	}

	unitCache := unithistory.NewCache(a.Cache.Underlying())
	unitRepo := unithistory.NewRepo(a.DB.Pool, unitCache)

	liveStoreAdapter := &liveSignalStoreAdapter{store: a.LiveSignalStore}
	vinByID := &vinByIDResolver{repo: vehicleRepo}
	sideEffects := teslapipeline.New(teslapipeline.Config{
		Live:        liveStoreAdapter,
		FSM:         a.TelemetryHandler.FSMHandler(),
		Sessions:    a.TelemetryHandler.SessionTracker(),
		Alerts:      a.TelemetryHandler.AlertEvaluator(),
		VINResolver: vinByID,
		BroadcastSSE: func(ctx context.Context, payload map[string]any) {
			a.TelemetryHandler.BroadcastSSE(ctx, payload)
		},
		Logger: pipelineLogger,
	})

	// Restore the firmware-version write path deleted with the legacy
	// trackVehicleConfig helper. The observer captures every payload that
	// carries a SoftwareUpdateVersion / Version atomic and forwards it to
	// software_updates via InsertIfChanged (ON CONFLICT DO NOTHING).
	// Without this, the Software Updates page goes stale the moment the
	// vehicle installs a new firmware after the deploy that ripped out
	// the legacy ingest path.
	swUpdateRepo := systemdb.NewSoftwareUpdateRepo(a.DB)
	swUpdateObserver := teslapipeline.NewSoftwareUpdateObserver(swUpdateRepo, pipelineLogger)

	normPipeline := normalize.New(unitRepo, pipelineRouter, pipelineLogger, sideEffects, swUpdateObserver)

	a.TelemetryHandler.SetPipeline(normPipeline)

	// Backfill the current firmware version per vehicle from the
	// already-hydrated SignalStore. Fleet Telemetry is a change feed —
	// fields that have not re-emitted since the legacy write path was
	// deleted (commit fa7440a0, May 18) would otherwise wait for the
	// next emission before the observer above caught them. The
	// in-memory SignalStore was populated from signal_log a few lines
	// above (see "signal store hydrated from signal_log via stateReader"),
	// so this loop touches no DB beyond the cheap InsertIfChanged
	// upsert. PickFirmwareVersionFromSignals shares its precedence rule
	// with the observer so a startup-vs-runtime mismatch is
	// impossible. Errors are logged and do not abort boot.
	for _, vid := range a.SignalStore.VehicleIDs() {
		raw := a.SignalStore.GetRawMap(vid)
		version := teslapipeline.PickFirmwareVersionFromSignals(raw)
		if version == "" {
			continue
		}
		backfillCtx, backfillCancel := context.WithTimeout(ctx, 5*time.Second)
		inserted, err := swUpdateRepo.InsertIfChanged(backfillCtx, vid, version, "installed")
		backfillCancel()
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vid).Str("version", version).Msg("software updates backfill: InsertIfChanged failed; will retry on next telemetry payload")
			continue
		}
		if inserted {
			log.Info().Int64("vehicle_id", vid).Str("version", version).Msg("software updates backfill: recorded current firmware version from hydrated signal store")
		}
	}

	dlqTopic := strings.TrimSuffix(a.Cfg.FleetTelemetry.TopicBase, "/") + "/dlq"

	// subRef bridges the chicken-and-egg between the paho client (which
	// must register an OnConnect handler BEFORE Connect) and the
	// PipelineSubscriber (which owns the topic + Subscribe call but cannot
	// be constructed until we have a connected client). On every
	// post-Start reconnect, paho fires OnConnect → callback derefs subRef
	// → PipelineSubscriber.OnBrokerReconnect re-issues SUBSCRIBE.
	//
	// Without this, paho v1.5.0's default ResumeSubs=false leaves a
	// reconnected client with no subscriptions whenever the broker drops
	// the persistent session (EMQX session_expiry_interval elapsed,
	// node restart on a non-replicated cluster, etc), silently halting
	// the entire fleet-telemetry stream — observed in production as
	// `subscriptions=0, delivered_msgs=0` with `connected=true` for days.
	var subRef atomic.Pointer[mqtt.PipelineSubscriber]
	pipelineOnConnect := func(c pahomqtt.Client) {
		if sub := subRef.Load(); sub != nil {
			sub.OnBrokerReconnect(c)
		}
	}
	pipelineOnConnectionLost := func(_ error) {
		if sub := subRef.Load(); sub != nil {
			sub.OnBrokerConnectionLost()
		}
	}

	pahoClient, dlq, err := mqtt.NewProductionPipelineMQTT(
		ctx,
		a.Cfg.MQTT.BrokerURL(),
		a.Cfg.MQTT.ClientID+"-pipeline",
		a.Cfg.MQTT.Username,
		a.Cfg.MQTT.Password,
		dlqTopic,
		pipelineLogger,
		pipelineOnConnect,
		pipelineOnConnectionLost,
	)
	if err != nil {
		return fmt.Errorf("phase-42a: NewProductionPipelineMQTT failed; broker=%s dlq_topic=%s: %w",
			a.Cfg.MQTT.BrokerURL(), dlqTopic, err)
	}
	a.addCloser("paho-pipeline", func(_ context.Context) error {
		pahoClient.Disconnect(500)
		return nil
	})

	subscriberVINResolver := func(ctx context.Context, vin string) (int64, error) {
		v, lookupErr := vehicleRepo.GetByVIN(ctx, vin)
		if lookupErr != nil {
			return 0, fmt.Errorf("phase-42a vinResolver: lookup vin: %w", lookupErr)
		}
		if v == nil {
			return 0, mqtt.ErrUnknownVIN
		}
		return v.ID, nil
	}

	// Per-field MQTT amplifies traffic 50-200x relative to the proto-batch
	// shape, so a DB lookup per message is no longer affordable. The VIN
	// cache preloads the full snapshot on startup and refreshes every
	// 5 minutes; the on-miss path falls back to the DB resolver above and
	// memoises the result. See internal/mqtt/vin_cache.go for the contract.
	vinCacheLoader := func(ctx context.Context) (map[string]int64, error) {
		all, listErr := vehicleRepo.GetAll(ctx)
		if listErr != nil {
			return nil, listErr
		}
		out := make(map[string]int64, len(all))
		for _, v := range all {
			if v == nil || v.VIN == "" {
				continue
			}
			out[v.VIN] = v.ID
		}
		return out, nil
	}
	vinCache := mqtt.NewVINCache(
		ctx,
		vinCacheLoader,
		subscriberVINResolver,
		mqtt.VINCacheConfig{},
		pipelineLogger,
	)
	a.addCloser("pipeline-vin-cache", func(_ context.Context) error {
		vinCache.Close()
		return nil
	})

	pipelineSubscriber := mqtt.NewPipelineSubscriber(
		pahoClient,
		normPipeline,
		dlq,
		vinCache.Resolve,
		mqtt.PipelineSubscriberConfig{
			TopicBase:         a.Cfg.FleetTelemetry.TopicBase,
			StreamingRecorder: a.TelemetryHandler,
		},
		pipelineLogger,
	)
	// Publish subRef BEFORE Start so any post-Start reconnect (or even a
	// pathological mid-Start reconnect that fires the goroutine-scheduled
	// OnConnect after subRef is published) routes through
	// PipelineSubscriber.OnBrokerReconnect, which guards itself against
	// pre-start invocations via the started/stopped flags.
	subRef.Store(pipelineSubscriber)
	if err := pipelineSubscriber.Start(); err != nil {
		pipelineSubscriber.Stop()
		return fmt.Errorf("phase-42a: PipelineSubscriber failed to start for topic base %q: %w",
			a.Cfg.FleetTelemetry.TopicBase, err)
	}
	a.pipelineSubscriber = pipelineSubscriber
	a.addCloser("pipeline-subscriber", func(_ context.Context) error {
		pipelineSubscriber.Stop()
		return nil
	})
	log.Info().
		Str("topic_base", a.Cfg.FleetTelemetry.TopicBase).
		Str("dlq_topic", dlqTopic).
		Int("writer_count", len(pipelineWriters)).
		Dur("stale_timeout", a.Cfg.FleetTelemetry.StaleTimeout).
		Msg("phase-42a: fleet-telemetry PipelineSubscriber active")

	// Subscribes the DLQ inspector to {dlqTopic}/# on the SAME paho client
	// the pipeline
	// already uses, keeping connection count + DLQ topic semantics
	// single-sourced. Inspector failures degrade /system/dlq* to 503
	// but MUST NOT halt the pipeline — best-effort observability.
	dlqInspector, err := mqtt.NewDLQInspector(pahoClient, dlqTopic, mqtt.DLQInspectorConfig{
		Capacity:      a.Cfg.Features.DLQRingCapacity,
		ReplayEnabled: a.Cfg.Features.DLQReplayEnabled,
		ReplayQoS:     0,
	}, pipelineLogger)
	if err != nil {
		log.Warn().Err(err).Msg("phase-44: DLQInspector construction failed; /system/dlq endpoints will be 503")
	} else if startErr := dlqInspector.Start(); startErr != nil {
		log.Warn().Err(startErr).Str("dlq_topic", dlqTopic).
			Msg("phase-44: DLQInspector subscribe failed; /system/dlq endpoints will be 503")
	} else {
		a.DLQInspector = dlqInspector
		a.DLQReplayAuditRepo = auditdb.NewDLQReplayAuditRepo(a.DB)
		a.addCloser("dlq-inspector", func(_ context.Context) error {
			dlqInspector.Stop()
			return nil
		})
		log.Info().
			Str("dlq_topic", dlqTopic).
			Int("ring_capacity", a.Cfg.Features.DLQRingCapacity).
			Bool("replay_enabled", a.Cfg.Features.DLQReplayEnabled).
			Msg("phase-44: DLQ Inspector active")
	}

	return nil
}

func (a *App) initWorker(ctx context.Context) {
	a.Worker = worker.New(a.DB, a.TeslaClient, a.MQTT, a.Cfg.Worker, a.EventBus, a.Encryptor)

	pollEngineCfg := polling.DefaultEngineConfig()
	pollEngineCfg.FleetTelemetryEnabled = a.Cfg.FleetTelemetry.Enabled
	a.PollEngine = polling.NewPollEngine(pollEngineCfg)

	if a.DB != nil && a.DB.Pool != nil {
		predictor := polling.NewPredictor(a.DB.Pool)
		predictor.RefreshIfNeeded(ctx)
		a.PollEngine.SetPredictor(predictor)
	}

	a.Worker.PollEngine = a.PollEngine

	if a.TelemetryHandler != nil {
		a.Worker.IsVehicleStreaming = a.TelemetryHandler.IsVehicleStreaming
		a.Worker.FleetTelemetryEnabled = true
		a.Worker.SetFallbackPollInterval(a.Cfg.FleetTelemetry.FallbackPollInterval)
		log.Info().
			Dur("fallback_poll_interval", a.Cfg.FleetTelemetry.FallbackPollInterval).
			Dur("stale_timeout", a.Cfg.FleetTelemetry.StaleTimeout).
			Msg("fleet telemetry primary mode — worker will only poll non-streaming vehicles as fallback")
	}

	log.Info().
		Bool("fleet_telemetry", pollEngineCfg.FleetTelemetryEnabled).
		Bool("predictor", a.PollEngine != nil).
		Msg("adaptive polling engine initialised")

	resilience.SafeGoLoop(ctx, "vehicle-poller", func(loopCtx context.Context) {
		a.Worker.Start(loopCtx)
	})
	log.Info().Msg("vehicle poller started (resilient mode)")
	a.Health.RecordSuccess("worker")
}

func (a *App) initNotificationWorker(ctx context.Context) {
	if a.MQTT == nil {
		return
	}
	notifWorker := notification.NewWorker(a.DB)
	resilience.SafeGoLoop(ctx, "notification-worker", func(loopCtx context.Context) {
		notifWorker.Start(loopCtx, a.MQTT.Underlying())
	})
}

func (a *App) initMaintenanceWorker(ctx context.Context) {
	resilience.SafeGoLoop(ctx, "maintenance-worker", func(loopCtx context.Context) {
		worker.StartMaintenanceWorker(loopCtx, a.DB, a.Cfg)
	})
	log.Info().Msg("maintenance worker started")
}

func (a *App) initSignalHistoryCleanup(ctx context.Context) {
	if a.SignalHistoryWriter == nil {
		return
	}
	if a.Cfg.Retention.SignalHistoryRetentionDays <= 0 {
		log.Warn().Msg("signal_log retention cleanup disabled; storage growth is unbounded")
		return
	}
	if !a.Cfg.Retention.SignalHistoryRetentionAcknowledged {
		log.Warn().
			Int("retention_days", a.Cfg.Retention.SignalHistoryRetentionDays).
			Msg("signal_log retention cleanup awaiting explicit backup acknowledgement")
		return
	}
	go func() {
		runSignalHistoryCleanupTick(ctx, a.SignalHistoryWriter, a.Cfg.Retention.SignalHistoryRetentionDays)

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runSignalHistoryCleanupTick(ctx, a.SignalHistoryWriter, a.Cfg.Retention.SignalHistoryRetentionDays)
			}
		}
	}()
	log.Info().Int("retention_days", a.Cfg.Retention.SignalHistoryRetentionDays).Msg("signal_log retention cleanup scheduled")
}

// signalHistoryCleaner is the minimal contract runSignalHistoryCleanupTick
// needs from *SignalHistoryWriter. The interface lets us swap the
// concrete type for a fake in unit tests.
type signalHistoryCleaner interface {
	Cleanup(ctx context.Context, retentionDays int)
}

func runSignalHistoryCleanupTick(ctx context.Context, writer signalHistoryCleaner, retentionDays int) {
	tickCtx, span := appBackgroundTracer().Start(ctx, "signal_log.cleanup_tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(attribute.Int("signal_log.retention_days", retentionDays)),
	)
	defer span.End()
	writer.Cleanup(tickCtx, retentionDays)
}

func (a *App) initTripGenerator(ctx context.Context) {
	tripRepo := tripdb.NewTripRepo(a.DB)
	go func() {
		runTripGeneratorTick(ctx, tripRepo, "backfill")

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runTripGeneratorTick(ctx, tripRepo, "periodic")
			}
		}
	}()
}

// tripGenerator is the minimal contract runTripGeneratorTick needs.
type tripGenerator interface {
	GenerateMonthlyTrips(ctx context.Context) (int, error)
}

func runTripGeneratorTick(ctx context.Context, gen tripGenerator, reason string) {
	tickCtx, span := appBackgroundTracer().Start(ctx, "trip_generator.tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(attribute.String("trip_generator.reason", reason)),
	)
	defer span.End()
	count, err := gen.GenerateMonthlyTrips(tickCtx)
	span.SetAttributes(attribute.Int("trip_generator.created", count))
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "generate monthly trips failed")
		log.Warn().Err(err).Str("reason", reason).Msg("trip generator: run failed")
		return
	}
	if count > 0 {
		log.Info().Int("created", count).Str("reason", reason).Msg("trip generator: created monthly summaries")
	}
}

func (a *App) initGasPriceWorker(ctx context.Context) {
	if a.Cfg.GasPrice.APIKey == "" {
		return
	}
	eiaAdapter := gasprices.NewEIAAdapter(
		a.Cfg.GasPrice.APIKey,
		gasprices.WithHTTPClient(httputil.NewClient(httputil.ClientConfig{
			Name:          "eia",
			Timeout:       config.HTTPClientTimeout,
			Sink:          a.OutboundAPILogSink,
			EnableLogging: true,
		})),
	)
	a.GasPriceWorker = worker.NewGasPriceWorker(a.DB, a.Cfg.GasPrice, eiaAdapter)
	resilience.SafeGoLoop(ctx, "gas-price-worker", func(loopCtx context.Context) {
		a.GasPriceWorker.Start(loopCtx)
	})
	log.Info().
		Bool("enabled", a.Cfg.GasPrice.Enabled).
		Str("poll_interval", a.Cfg.GasPrice.PollInterval).
		Msg("gas price worker started")
}

func (a *App) initUnitDriftValidator(ctx context.Context) {
	driftVehicleRepo := vehicledb.NewVehicleRepo(a.DB)
	driftValidator := worker.NewUnitDriftValidator(a.DB, driftVehicleRepo)
	resilience.SafeGoLoop(ctx, "unit-drift-validator", func(loopCtx context.Context) {
		driftValidator.Start(loopCtx, worker.Options{})
	})
	log.Info().Msg("unit-drift validator started")
}

// initAIBackgroundJobs schedules cross-cutting AI maintenance jobs.
// Currently only embeddings TTL — re-runs every hour to delete
// expired rows from both embeddings tables (see internal/jobs/
// embeddings/ttl.go).
//
// ADR-015 §I12 contract: the cron is started UNCONDITIONALLY. Each
// tick re-checks ai_mode via [embeddingsjobs.RunTTL]; when mode='off'
// the function returns immediately without touching the DB. The
// rationale for unconditional start (vs gating here on AIMode):
//
//   - When the admin flips ai_mode='local'|'cloud' at runtime we must
//     pick up the new mode without a process restart. Gating start
//     here on the boot-time mode would force a restart to enable
//     background TTL after a runtime opt-in.
//   - The cron's per-tick cost in off-mode is one settings read +
//     one log line — measured at < 100µs, well below the noise
//     floor of the hourly tick.
//   - The §I12 invariant test (factory + jobs unit tests) proves
//     zero embeddings rows are written or deleted in off-mode, which
//     is the user-visible contract.
func (a *App) initAIBackgroundJobs(ctx context.Context) {
	settingsRepo := settingsdb.NewSettingsRepo(a.DB)

	// Run once at boot so a long-running tick interval doesn't leave
	// expired rows visible immediately after a restart.
	go func() {
		runEmbeddingsTTLTick(ctx, a.DB, settingsRepo, "initial")
	}()

	resilience.SafeGoLoop(ctx, "embeddings-ttl-cron", func(loopCtx context.Context) {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-loopCtx.Done():
				return
			case <-ticker.C:
				runEmbeddingsTTLTick(loopCtx, a.DB, settingsRepo, "periodic")
			}
		}
	})
	log.Info().Msg("ai background jobs scheduled (embeddings_ttl re-checks ai_mode per ADR-015 §I12)")
}

func runEmbeddingsTTLTick(ctx context.Context, db *database.DB, settingsRepo *settingsdb.SettingsRepo, reason string) {
	tickCtx, span := appBackgroundTracer().Start(ctx, "ai.background_tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(
			attribute.String("ai.job", "embeddings_ttl"),
			attribute.String("ai.reason", reason),
		),
	)
	defer span.End()
	result, err := embeddingsjobs.RunTTL(tickCtx, db, settingsRepo)
	span.SetAttributes(
		attribute.Int64("ai.embeddings_ttl.deleted_768", result.Deleted768),
		attribute.Int64("ai.embeddings_ttl.deleted_1536", result.Deleted1536),
	)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "embeddings TTL failed")
		log.Warn().Err(err).Str("reason", reason).Msg("ai background jobs: embeddings TTL run failed")
	}
}

const dataRepairScanInterval = 15 * time.Minute

type dataRepairScanner interface {
	Scan(context.Context, apidatarepair.ScanOptions) (apidatarepair.ScanResult, error)
}

func (a *App) initDataRepairScanner(ctx context.Context) {
	if a.DB == nil {
		return
	}
	a.DataRepairScanner = apidatarepair.NewScanner(a.DB)
	resilience.SafeGoLoop(ctx, "data-repair-scanner", func(loopCtx context.Context) {
		runDataRepairScanTick(loopCtx, a.DataRepairScanner, "initial")

		ticker := time.NewTicker(dataRepairScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-loopCtx.Done():
				return
			case <-ticker.C:
				runDataRepairScanTick(loopCtx, a.DataRepairScanner, "periodic")
			}
		}
	})
	log.Info().Dur("interval", dataRepairScanInterval).Msg("data-repair integrity scanner scheduled")
}

func runDataRepairScanTick(ctx context.Context, scanner dataRepairScanner, reason string) {
	tickCtx, span := appBackgroundTracer().Start(ctx, "data_repair.scan_tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(attribute.String("data_repair.reason", reason)),
	)
	defer span.End()

	result, err := scanner.Scan(tickCtx, apidatarepair.ScanOptions{
		Trigger:     systemmodel.RepairScanTriggerScheduled,
		InitiatedBy: "system",
	})
	span.SetAttributes(
		attribute.Int("data_repair.discovered", result.Discovered),
		attribute.Int("data_repair.refreshed", result.Refreshed),
		attribute.Bool("data_repair.truncated", result.Truncated),
		attribute.String("data_repair.status", string(result.Status)),
	)
	if errors.Is(err, apidatarepair.ErrScanAlreadyRunning) {
		log.Debug().Str("reason", reason).Msg("data-repair scan skipped because another scan is running")
		return
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "data-repair scan failed")
		log.Warn().
			Err(err).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Str("reason", reason).
			Msg("data-repair integrity scan failed")
		return
	}
	log.Info().
		Int("discovered", result.Discovered).
		Int("refreshed", result.Refreshed).
		Bool("truncated", result.Truncated).
		Str("reason", reason).
		Msg("data-repair integrity scan completed")
}

func (a *App) initHealthWatchdog(ctx context.Context) {
	a.notifRepo = dbnotif.NewNotificationRepo(a.DB)
	a.prefRepo = dbnotif.NewNotificationPreferenceRepo(a.DB)
	a.onboardingRepo = dbuser.NewOnboardingRepo(a.DB)
	a.onboardingStateRepo = dbuser.NewOnboardingStateRepo(a.DB)
	a.healthNotifications = newComponentNotificationCache(a.notifRepo, a.prefRepo)
	if err := a.healthNotifications.Refresh(ctx); err != nil {
		log.Warn().Err(err).Msg("health watchdog: initial notification target cache load failed")
	}
	resilience.SafeGo("health-watchdog", func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				a.runHealthWatchdogTick(ctx)
			}
		}
	})
}

// workerDegradedThreshold mirrors resilience.HealthMonitor's own
// consecutive-failure bar for StatusDegraded so the "worker" component
// probe (Worker.HealthSnapshot) and the generic HealthMonitor agree on
// what "degraded" means for a single vehicle.
const workerDegradedThreshold = 3

// telemetryPipelineStaleAfter is the conservative, GLOBAL (fleet-wide)
// Fleet Telemetry ingest freshness threshold used by the "telemetry"
// health component. It is intentionally NOT the same as
// OnboardingRepo.Get's 24h onboarding-gate window.
//
// Semantics: this checks whether ANY vehicle in the fleet has written a
// signal_log row within the window — not any single vehicle's expected
// online/driving/charging state. A single sleeping vehicle in a
// multi-vehicle fleet never trips this (any other vehicle reporting
// resets it), and normal single-vehicle overnight sleep does not either
// as long as it's under this window. A TOTAL, sustained fleet-wide
// silence beyond this window is treated as a pipeline/ingest problem
// (MQTT/Fleet Telemetry connectivity) rather than "the car is asleep".
//
// This is deliberately conservative per the explicit requirement to
// avoid false alerts for sleeping vehicles — per-vehicle expected-
// reporting state (online/driving/charging) is NOT implemented in this
// slice; see .github/ARCHITECTURE.md and the task notes for why a
// pipeline/global check is used instead.
const telemetryPipelineStaleAfter = 6 * time.Hour

func (a *App) runHealthWatchdogTick(ctx context.Context) {
	tickCtx, span := appBackgroundTracer().Start(ctx, "health_watchdog.tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
	defer span.End()

	databaseHealthy := a.checkDatabaseHealth(tickCtx, span)
	if databaseHealthy && a.healthNotifications != nil {
		if err := a.healthNotifications.Refresh(tickCtx); err != nil {
			log.Warn().Err(err).Msg("health watchdog: notification target cache refresh failed")
		}
	}
	a.checkMQTTHealth(span)
	a.checkRedisHealth(tickCtx)
	a.checkTeslaAuthHealth()
	a.checkWorkerHealth()
	a.checkTelemetryHealth(tickCtx)

	components := a.Health.GetStatus()
	setupComplete := a.onboardingCompleteForHealthNotifications(tickCtx)
	degradedCount := 0
	for name, comp := range components {
		initialOutageEligible := name != "tesla_api" || setupComplete
		if evt, fire := a.healthTracker.Observe(name, *comp, initialOutageEligible); fire {
			icon := "⚠️"
			if evt.Severity == "info" {
				icon = "✅"
			}
			dispatchComponentNotification(tickCtx, a.healthNotifications, a.healthNotifications, mqttTransport(a.MQTT),
				notification.PublishCtx, componentTransitionEvent{
					Component: evt.Component,
					EventType: evt.EventType,
					Severity:  evt.Severity,
					Title:     icon + " " + evt.Title,
					Message:   evt.Message,
				})
			logEvt := log.Warn()
			if evt.Severity == "info" {
				logEvt = log.Info()
			}
			logEvt.Str("component", name).Str("status", comp.Status.String()).
				Str("event_type", evt.EventType).Str("severity", evt.Severity).
				Msg("system alert: component health transition")
		}
		if comp.Status != resilience.StatusHealthy {
			degradedCount++
		}
	}

	overall := a.Health.OverallStatus()
	span.SetAttributes(
		attribute.String("health.overall", overall.String()),
		attribute.Int("health.component_count", len(components)),
		attribute.Int("health.degraded_count", degradedCount),
	)
	if overall != resilience.StatusHealthy {
		span.SetStatus(codes.Error, "one or more components degraded")
		for name, comp := range components {
			if comp.Status != resilience.StatusHealthy {
				log.Warn().Str("component", name).Str("status", comp.Status.String()).Int("consec_fails", comp.ConsecFails).Msg("degraded component")
			}
		}
	}
}

// mqttTransport returns the underlying paho client for the direct-
// dispatch fallback path, or nil (a valid, nil-safe value for
// notification.PublishCtx) when MQTT was never constructed.
func mqttTransport(c *mqtt.Client) pahomqtt.Client {
	if c == nil {
		return nil
	}
	return c.Underlying()
}

// checkDatabaseHealth is unchanged from the pre-existing watchdog: a
// bounded ping against the shared pgx pool.
func (a *App) checkDatabaseHealth(tickCtx context.Context, span oteltrace.Span) bool {
	checkCtx, cancel := context.WithTimeout(tickCtx, 5*time.Second)
	defer cancel()
	if dbErr := a.DB.Health(checkCtx); dbErr != nil {
		a.Health.RecordFailure("database", dbErr)
		span.RecordError(dbErr)
		log.Warn().Err(dbErr).Msg("database health check failed")
		return false
	}
	a.Health.RecordSuccess("database")
	return true
}

// checkMQTTHealth records a failure every tick that MQTT is either
// disconnected OR was never constructed at all (a.MQTT == nil, e.g. the
// broker was unreachable through all of initMQTT's startup retries).
// The pre-existing watchdog only checked `a.MQTT != nil`, so a
// startup-time MQTT failure recorded exactly one failure and then never
// got re-observed — ConsecFails could never cross the Degraded/
// Unhealthy bar and no outage notification would ever fire for the
// most common "MQTT down" case. Recording a failure every tick when nil
// fixes that; the direct-dispatch fallback in dispatchComponentNotification
// (via notification.PublishCtx) is exactly what makes the resulting
// "MQTT is down" notification deliverable in that state.
func (a *App) checkMQTTHealth(span oteltrace.Span) {
	baseConnected := a.MQTT != nil && a.MQTT.IsConnected()
	pipelineRequired := a.Cfg != nil && a.Cfg.FleetTelemetry.Enabled
	pipelineHealthy := a.pipelineSubscriber != nil && a.pipelineSubscriber.IsHealthy()
	if err := mqttHealthError(baseConnected, pipelineRequired, pipelineHealthy); err != nil {
		a.Health.RecordFailure("mqtt", err)
		span.RecordError(err)
		return
	}
	a.Health.RecordSuccess("mqtt")
}

func mqttHealthError(baseConnected, pipelineRequired, pipelineHealthy bool) error {
	if !baseConnected {
		return fmt.Errorf("MQTT broker not connected")
	}
	if pipelineRequired && !pipelineHealthy {
		return fmt.Errorf("Fleet Telemetry MQTT subscriber is not connected and subscribed")
	}
	return nil
}

func (a *App) onboardingCompleteForHealthNotifications(ctx context.Context) bool {
	if a.onboardingStateRepo == nil {
		return false
	}
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	state, err := a.onboardingStateRepo.Get(checkCtx)
	if err != nil {
		log.Warn().Err(err).Msg("health watchdog: durable onboarding state query failed")
		return false
	}
	return state.Completed
}

// checkRedisHealth only feeds the "redis" component when Redis is
// actually configured (REDIS_ENABLED=true) — an install that never
// enabled Redis must see "redis" stay unknown forever, never
// "healthy" (there's nothing to be healthy about) and never "degraded"
// (nothing broke). When Redis IS enabled but internal/cache.Store
// never connected (Underlying() == nil — Store falls back to in-memory
// permanently after a failed startup Ping), that is a real, ongoing
// failure and is reported as such every tick.
func (a *App) checkRedisHealth(tickCtx context.Context) {
	if a.Cfg == nil || !a.Cfg.Redis.Enabled {
		return
	}
	rdb := a.Cache.Underlying()
	if rdb == nil {
		a.Health.RecordFailure("redis", fmt.Errorf("redis enabled but not connected"))
		return
	}
	pingCtx, cancel := context.WithTimeout(tickCtx, 3*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		a.Health.RecordFailure("redis", err)
		return
	}
	a.Health.RecordSuccess("redis")
}

// checkTeslaAuthHealth is the fixed version of the pre-existing check:
// the original watchdog only ever called RecordSuccess, never
// RecordFailure, so an expired/missing Tesla token could never surface
// as a degraded/unhealthy "tesla_api" component or trigger an outage
// notification.
func (a *App) checkTeslaAuthHealth() {
	if a.TeslaClient == nil {
		return
	}
	if a.TeslaClient.HasValidToken() {
		a.Health.RecordSuccess("tesla_api")
		return
	}
	a.Health.RecordFailure("tesla_api", fmt.Errorf("Tesla API token missing or expired"))
}

// checkWorkerHealth replaces the pre-existing unconditional
// RecordSuccess("worker") with a real probe: Worker.HealthSnapshot
// reports how many vehicles the worker has ever recorded a polling
// outcome for and how many of those are currently degraded. tracked==0
// (fresh install, or every known vehicle is fully covered by Fleet
// Telemetry streaming so the worker never polls it) means "no signal
// yet" — the check is skipped entirely rather than lying that the
// worker is healthy. Failure requires EVERY tracked vehicle to be
// degraded, so one flaky vehicle can't flip the whole component.
func (a *App) checkWorkerHealth() {
	if a.Worker == nil {
		return
	}
	tracked, degraded := a.Worker.HealthSnapshot(workerDegradedThreshold)
	if tracked == 0 {
		return
	}
	if degraded == tracked {
		a.Health.RecordFailure("worker", fmt.Errorf("%d/%d polled vehicles have %d+ consecutive failures", degraded, tracked, workerDegradedThreshold))
		return
	}
	a.Health.RecordSuccess("worker")
}

// checkTelemetryHealth implements the conservative pipeline/global
// Fleet Telemetry freshness check documented on
// telemetryPipelineStaleAfter. It is skipped (no Record* call at all)
// when Fleet Telemetry ingestion is disabled in config — signal_log is
// populated ONLY by the Fleet Telemetry MQTT ingest path (see
// .github/instructions/telemetry-pipeline.instructions.md); a
// REST-polling-only deployment would otherwise see a permanent false
// "telemetry down" alert since signal_log would never receive rows at
// all — and when there are zero vehicles registered yet (an onboarding
// concern, not a runtime health concern; see GET /onboarding/status).
func (a *App) checkTelemetryHealth(tickCtx context.Context) {
	if a.Cfg == nil || !a.Cfg.FleetTelemetry.Enabled || a.onboardingRepo == nil {
		return
	}
	checkCtx, cancel := context.WithTimeout(tickCtx, 5*time.Second)
	defer cancel()
	status, err := a.onboardingRepo.Get(checkCtx)
	if err != nil {
		log.Warn().Err(err).Msg("telemetry health check: onboarding repo query failed")
		return
	}
	if status.VehicleCount == 0 {
		return
	}
	if status.LastSignalAt == nil {
		// No signal has EVER been recorded for any vehicle yet even
		// though vehicles exist and Fleet Telemetry is enabled — this is
		// still "no signal yet" rather than "outage": a freshly synced
		// vehicle may not have connected to Fleet Telemetry for the
		// first time. Skip until the first signal ever lands.
		return
	}
	if time.Since(*status.LastSignalAt) > telemetryPipelineStaleAfter {
		a.Health.RecordFailure("telemetry", fmt.Errorf("no signal_log activity across %d vehicle(s) in over %s (last seen %s)",
			status.VehicleCount, telemetryPipelineStaleAfter, status.LastSignalAt.Format(time.RFC3339)))
		return
	}
	a.Health.RecordSuccess("telemetry")
}

func (a *App) loadOpenAPISpec() {
	specPaths := []string{"/docs/public/openapi.yaml", "docs/public/openapi.yaml"}
	for _, p := range specPaths {
		if specBytes, err := os.ReadFile(p); err == nil {
			a.openAPISpec = specBytes
			apiopenapi.SetOpenAPISpec(specBytes)
			break
		}
	}
}
