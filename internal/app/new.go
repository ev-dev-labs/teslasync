package app

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/jobs"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	sigsvc "github.com/ev-dev-labs/teslasync/internal/signal"
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
)

// New constructs the App in the SAME order as the legacy
// cmd/teslasync/main.go body (lines 78-889 prior to phase-47/04). Each
// init* method is a verbatim relocation of the corresponding source
// region; no behavioural change. Closers are registered immediately
// after a resource is constructed so the LIFO unwind in [App.Close]
// matches the original `defer` ordering.
//
// Returns (a, ErrMigrateOnly) when MIGRATE_ONLY=true so that
// callers can run a.Close on already-opened resources (database,
// tracer) before exiting.
func New(ctx context.Context, cfg *config.Config, build BuildInfo) (*App, error) {
	a := &App{
		Cfg:             cfg,
		Build:           build,
		Health:          resilience.NewHealthMonitor(),
		startupStart:    time.Now(),
		prevHealthState: make(map[string]resilience.ComponentStatus),
	}
	a.Health.Register("database")
	a.Health.Register("mqtt")
	a.Health.Register("tesla_api")
	a.Health.Register("worker")

	a.initTracing(ctx)

	if err := a.initDatabase(ctx); err != nil {
		return a, err
	}

	if os.Getenv("MIGRATE_ONLY") == "true" {
		return a, ErrMigrateOnly
	}

	a.initMQTT(ctx)
	a.initCache()
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

	a.initWorker(ctx)
	a.initNotificationWorker(ctx)
	a.initMaintenanceWorker(ctx)
	a.initSignalHistoryCleanup(ctx)
	a.initTripGenerator(ctx)
	a.initGasPriceWorker(ctx)
	a.initUnitDriftValidator(ctx)
	a.initAIBackgroundJobs(ctx)
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

func (a *App) initEventBus() {
	if a.MQTT != nil {
		a.EventBus = events.NewBus(a.MQTT.Underlying())
	} else {
		a.EventBus = events.NewBus(nil)
	}
}

func (a *App) initEncryptor() {
	a.Encryptor = crypto.NewFromEnv()
	if a.Encryptor != nil {
		log.Info().Msg("encryption enabled for sensitive data")
	}
}

func (a *App) initTeslaClient() {
	a.TeslaClient = tesla.NewClient(a.Cfg.Tesla)
}

func (a *App) initAPILogging() {
	a.APILogRepo = database.NewAPICallLogRepo(a.DB)

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
		logEntry := &models.APICallLog{
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

	api.SetOutboundSink(a.OutboundAPILogSink)
	notification.SetSink(a.OutboundAPILogSink)
	geocoding.SetSink(a.OutboundAPILogSink)
	tesla.SetAuthSink(a.OutboundAPILogSink, a.Cfg.Tesla.Timeout)
}

func (a *App) initWebPush() {
	pushSubsRepo := database.NewPushSubscriptionsRepo(a.DB)
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
// phase-42a/0050 MQTT PipelineSubscriber + 12 writers + side-effects
// observer. Returns an error only for fatal misconfigurations
// (invalid LIVE_SIGNAL_STORE_MODE, router.New writer-coverage failure,
// MQTT pipeline construction failure when MQTT is configured).
func (a *App) initTelemetryHandler(ctx context.Context) error {
	if !a.Cfg.FleetTelemetry.Enabled {
		return nil
	}

	a.TelemetryHandler = api.NewTelemetryHandler(
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

	vehicleRepo := database.NewVehicleRepo(a.DB)
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

	a.SignalHistoryWriter = database.NewSignalHistoryWriter(a.DB)
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
	signalLogReader := database.NewSignalLogReader(a.DB)
	if sessionTracker != nil {
		sessionTracker.SetSignalLogReader(signalLogReader)
		sessionTracker.RecoverSessions(ctx)
		sessionTracker.ValidateRecoveredSessions(ctx)
		sessionTracker.RecoverIncompleteSessions(ctx)
		sessionTracker.StartBufferDrains(ctx)
	}

	alertEvaluator := a.TelemetryHandler.AlertEvaluator()
	if alertEvaluator != nil {
		// Phase-49 / Slice 0002: rebuild the in-memory latch cache from
		// alert_rule_state so once-mode rules don't re-fire on pod restart
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
			rawRepo := database.NewRawTelemetryRepo(mongoClient)
			a.TelemetryHandler.SetRawTelemetryRepo(rawRepo)

			signalLogRepo := database.NewSignalLogRepo(mongoClient)
			a.TelemetryHandler.SetSignalLogRepo(signalLogRepo)

			log.Info().Str("database", a.Cfg.MongoDB.Database).Int("ttl_days", a.Cfg.MongoDB.TTLDays).Msg("MongoDB raw telemetry capture + signal log available")

			settingsRepo := database.NewSettingsRepo(a.DB)
			if _, err := settingsRepo.GetPollingConfig(ctx); err == nil {
				log.Debug().Msg("polling config loaded (telemetry capture toggle removed)")
			}
		}
	}

	a.TelemetryHandler.StartCleanup(ctx)

	go a.TelemetryHandler.SessionTracker().BackfillAddresses(ctx)

	if a.MQTT != nil && a.Cfg.FleetTelemetry.TopicBase != "" {
		if err := a.initPipelineSubscriber(ctx, vehicleRepo); err != nil {
			return err
		}
	}
	return nil
}

// initPipelineSubscriber wires the phase-42a/0050 hard-cutover stack:
// 12 writers → router.New → unit-history cache+repo → SideEffectsObserver
// → normalize.Pipeline → MQTT PipelineSubscriber. Any missing writer or
// invalid routing rule fails the process at startup; per ADR-004 #12
// there is no feature flag and no parallel pipeline.
func (a *App) initPipelineSubscriber(ctx context.Context, vehicleRepo *database.VehicleRepo) error {
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
		BroadcastSSE: func(payload map[string]any) {
			a.TelemetryHandler.BroadcastSSE(payload)
		},
		Logger: pipelineLogger,
	})

	normPipeline := normalize.New(unitRepo, pipelineRouter, pipelineLogger, sideEffects)

	a.TelemetryHandler.SetPipeline(normPipeline)

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

	pahoClient, dlq, err := mqtt.NewProductionPipelineMQTT(
		ctx,
		a.Cfg.MQTT.BrokerURL(),
		a.Cfg.MQTT.ClientID+"-pipeline",
		a.Cfg.MQTT.Username,
		a.Cfg.MQTT.Password,
		dlqTopic,
		pipelineLogger,
		pipelineOnConnect,
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
			TopicBase: a.Cfg.FleetTelemetry.TopicBase,
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
		log.Warn().Err(err).
			Str("topic_base", a.Cfg.FleetTelemetry.TopicBase).
			Msg("phase-42a: PipelineSubscriber failed to start")
		return nil
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
		log.Info().Msg("signal_history TTL cleanup DISABLED (SIGNAL_HISTORY_RETENTION_DAYS not set)")
		return
	}
	go func() {
		a.SignalHistoryWriter.Cleanup(ctx, a.Cfg.Retention.SignalHistoryRetentionDays)

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				a.SignalHistoryWriter.Cleanup(ctx, a.Cfg.Retention.SignalHistoryRetentionDays)
			}
		}
	}()
	log.Info().Int("retention_days", a.Cfg.Retention.SignalHistoryRetentionDays).Msg("signal_history TTL cleanup scheduled")
}

func (a *App) initTripGenerator(ctx context.Context) {
	tripRepo := database.NewTripRepo(a.DB)
	go func() {
		count, err := tripRepo.GenerateMonthlyTrips(ctx)
		if err != nil {
			log.Warn().Err(err).Msg("trip generator: backfill failed")
		} else if count > 0 {
			log.Info().Int("created", count).Msg("trip generator: backfilled monthly summaries")
		}

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := tripRepo.GenerateMonthlyTrips(ctx)
				if err != nil {
					log.Warn().Err(err).Msg("trip generator: periodic run failed")
				} else if n > 0 {
					log.Info().Int("created", n).Msg("trip generator: new monthly summaries")
				}
			}
		}
	}()
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
	driftVehicleRepo := database.NewVehicleRepo(a.DB)
	driftValidator := worker.NewUnitDriftValidator(a.DB, driftVehicleRepo)
	resilience.SafeGoLoop(ctx, "unit-drift-validator", func(loopCtx context.Context) {
		driftValidator.Start(loopCtx, worker.Options{})
	})
	log.Info().Msg("unit-drift validator started")
}

// initAIBackgroundJobs schedules cross-cutting AI maintenance jobs.
// Currently only embeddings TTL — re-runs every hour to delete
// expired rows from both embeddings tables (see internal/jobs/
// embeddings_ttl.go).
//
// ADR-015 §I12 contract: the cron is started UNCONDITIONALLY. Each
// tick re-checks ai_mode via [jobs.RunEmbeddingsTTL]; when mode='off'
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
	settingsRepo := database.NewSettingsRepo(a.DB)

	// Run once at boot so a long-running tick interval doesn't leave
	// expired rows visible immediately after a restart.
	go func() {
		if _, err := jobs.RunEmbeddingsTTL(ctx, a.DB, settingsRepo); err != nil {
			log.Warn().Err(err).Msg("ai background jobs: initial embeddings TTL run failed")
		}
	}()

	resilience.SafeGoLoop(ctx, "embeddings-ttl-cron", func(loopCtx context.Context) {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-loopCtx.Done():
				return
			case <-ticker.C:
				if _, err := jobs.RunEmbeddingsTTL(loopCtx, a.DB, settingsRepo); err != nil {
					log.Warn().Err(err).Msg("ai background jobs: embeddings TTL run failed")
				}
			}
		}
	})
	log.Info().Msg("ai background jobs scheduled (embeddings_ttl re-checks ai_mode per ADR-015 §I12)")
}

func (a *App) initHealthWatchdog(ctx context.Context) {
	a.notifRepo = database.NewNotificationRepo(a.DB)
	resilience.SafeGo("health-watchdog", func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				checkCtx, checkCancel := context.WithTimeout(ctx, 5*time.Second)
				if dbErr := a.DB.Health(checkCtx); dbErr != nil {
					a.Health.RecordFailure("database", dbErr)
					log.Warn().Err(dbErr).Msg("database health check failed")
				} else {
					a.Health.RecordSuccess("database")
				}
				checkCancel()

				if a.MQTT != nil {
					if a.MQTT.IsConnected() {
						a.Health.RecordSuccess("mqtt")
					} else {
						a.Health.RecordFailure("mqtt", fmt.Errorf("MQTT broker not connected"))
					}
				}

				if a.TeslaClient.HasValidToken() {
					a.Health.RecordSuccess("tesla_api")
				}

				a.Health.RecordSuccess("worker")

				components := a.Health.GetStatus()
				for name, comp := range components {
					prev, seen := a.prevHealthState[name]
					if !seen {
						a.prevHealthState[name] = comp.Status
						continue
					}

					if prev == resilience.StatusHealthy && comp.Status >= resilience.StatusDegraded {
						severity := "warning"
						if comp.Status == resilience.StatusUnhealthy {
							severity = "critical"
						}
						title := fmt.Sprintf("%s is %s", componentDisplayName(name), comp.Status.String())
						message := fmt.Sprintf("Component %s has %d consecutive failures. Last error: %s", name, comp.ConsecFails, comp.LastError)
						_ = severity
						sendSystemNotification(ctx, a.notifRepo, a.MQTT, "⚠️ "+title, message)
						log.Warn().Str("component", name).Str("status", comp.Status.String()).Str("severity", severity).Msg("system alert: component degraded")
					}

					if prev >= resilience.StatusDegraded && comp.Status == resilience.StatusHealthy {
						title := fmt.Sprintf("%s recovered", componentDisplayName(name))
						message := fmt.Sprintf("Component %s is healthy again", name)
						sendSystemNotification(ctx, a.notifRepo, a.MQTT, "✅ "+title, message)
						log.Info().Str("component", name).Msg("system alert: component recovered")
					}

					a.prevHealthState[name] = comp.Status
				}

				overall := a.Health.OverallStatus()
				if overall != resilience.StatusHealthy {
					for name, comp := range components {
						if comp.Status != resilience.StatusHealthy {
							log.Warn().Str("component", name).Str("status", comp.Status.String()).Int("consec_fails", comp.ConsecFails).Msg("degraded component")
						}
					}
				}
			}
		}
	})
}

func (a *App) loadOpenAPISpec() {
	specPaths := []string{"/docs/public/openapi.yaml", "docs/public/openapi.yaml"}
	for _, p := range specPaths {
		if specBytes, err := os.ReadFile(p); err == nil {
			a.openAPISpec = specBytes
			api.SetOpenAPISpec(specBytes)
			break
		}
	}
}
