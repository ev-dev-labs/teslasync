package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	sigsvc "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/ev-dev-labs/teslasync/internal/worker"

	"github.com/ev-dev-labs/teslasync/internal/adapter/gasprices"
)

func main() {
	// Built-in healthcheck for distroless containers (no wget/curl available)
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		port := os.Getenv("TESLASYNC_PORT")
		if port == "" {
			port = "8080"
		}
		resp, err := http.Get("http://localhost:" + port + "/healthz")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	setupLogger(cfg.LogLevel)
	log.Info().Str("version", Version).Msg("starting TeslaSync")

	startupStart := time.Now()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize OpenTelemetry tracing (optional)
	if cfg.OpenTelemetry.Enabled {
		shutdownTracer, err := tracing.Init(ctx, cfg.OpenTelemetry.ServiceName, cfg.OpenTelemetry.Endpoint, cfg.OpenTelemetry.Insecure)
		if err != nil {
			log.Warn().Err(err).Msg("failed to initialize tracing, continuing without it")
		} else {
			log.Info().Str("endpoint", cfg.OpenTelemetry.Endpoint).Str("service", cfg.OpenTelemetry.ServiceName).Msg("OpenTelemetry tracing enabled")
			defer func() {
				shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := shutdownTracer(shutdownCtx); err != nil {
					log.Warn().Err(err).Msg("failed to shutdown tracer")
				}
			}()
		}
	}

	// Component health monitor
	health := resilience.NewHealthMonitor()
	health.Register("database")
	health.Register("mqtt")
	health.Register("tesla_api")
	health.Register("worker")

	// Database — retry connection with exponential backoff (critical, must succeed)
	var db *database.DB
	err = resilience.ConnectWithRetry(ctx, "database", 10, func(ctx context.Context) error {
		var connErr error
		db, connErr = database.New(ctx, cfg.Database)
		return connErr
	})
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database after retries")
	}
	defer db.Close()
	health.RecordSuccess("database")

	if err := db.Migrate(cfg.Database.MigrationsPath, cfg.Database); err != nil {
		log.Fatal().Err(err).Msg("failed to run migrations")
	}
	log.Info().Msg("database migrations applied")

	// Record current migration version metric
	var migVer int
	if err := db.Pool.QueryRow(ctx, "SELECT version FROM schema_migrations LIMIT 1").Scan(&migVer); err == nil {
		metrics.MigrationVersion.Set(float64(migVer))
	}

	// If running in migrate-only mode (Helm pre-upgrade job), exit after migrations
	if os.Getenv("MIGRATE_ONLY") == "true" {
		log.Info().Msg("MIGRATE_ONLY=true — migrations complete, exiting")
		return
	}

	// MQTT — non-fatal, system degrades gracefully without it
	var mqttClient *mqtt.Client
	if cfg.MQTT.Enabled {
		mqttErr := resilience.ConnectWithRetry(ctx, "mqtt", 5, func(ctx context.Context) error {
			var connErr error
			mqttClient, connErr = mqtt.NewClient(cfg.MQTT)
			return connErr
		})
		if mqttErr != nil {
			log.Warn().Err(mqttErr).Msg("MQTT unavailable — running in degraded mode without real-time MQTT publishing")
			health.RecordFailure("mqtt", mqttErr)
			metrics.MQTTConnected.Set(0)
		} else {
			defer mqttClient.Disconnect()
			health.RecordSuccess("mqtt")
			metrics.MQTTConnected.Set(1)
			log.Info().Msg("connected to MQTT broker")
		}
	}

	// Cache (Redis or in-memory fallback)
	cacheStore := cache.New(cfg.Redis)
	defer cacheStore.Close()

	// Domain event bus (MQTT-backed)
	var eventBus *events.Bus
	if mqttClient != nil {
		eventBus = events.NewBus(mqttClient.Underlying())
	} else {
		eventBus = events.NewBus(nil)
	}

	// Encryption for sensitive data at rest
	encryptor := crypto.NewFromEnv()
	if encryptor != nil {
		log.Info().Msg("encryption enabled for sensitive data")
	}

	// Tesla API client
	teslaClient := tesla.NewClient(cfg.Tesla)

	// Wire Tesla API call logging
	apiLogRepo := database.NewAPICallLogRepo(db)
	teslaClient.SetLogCallback(func(method, url string, statusCode int, reqBody, respBody []byte, durationMs int, callErr error) {
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
		logCtx, logCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := apiLogRepo.Create(logCtx, logEntry); err != nil {
			log.Error().Err(err).Msg("failed to log API call")
		}
		logCancel()
	})

	// Fleet Telemetry handler — created early so the worker can check streaming state
	var telemetryHandler *api.TelemetryHandler
	var signalStore *sigsvc.Store
	var signalHistoryWriter *database.SignalHistoryWriter
	if cfg.FleetTelemetry.Enabled {
		telemetryHandler = api.NewTelemetryHandler(db, mqttClient, nil, cfg.FleetTelemetry.StaleTimeout, geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey)) // eventHub wired later via router
		telemetryHandler.SetTimings(
			cfg.FleetTelemetry.SnapshotWriteInterval,
			cfg.FleetTelemetry.CleanupInterval,
			cfg.FleetTelemetry.StaleSessionTimeout,
		)

		// Initialize SignalStore (in-memory; recovery via Redis → signal_log)
		signalStore = sigsvc.New()
		telemetryHandler.SetSignalStore(signalStore)
		telemetryHandler.FSMHandler().SetSignalStore(signalStore)

		// Wire Redis signal cache(write-through HSET mirror, fire-and-forget)
		if rdb := cacheStore.Underlying(); rdb != nil {
			telemetryHandler.SetRedisCache(sigsvc.NewRedisSignalCache(rdb))
			log.Info().Msg("redis signal cache enabled")
		}

		// Load existing state from Redis/signal_log (pod restart recovery)
		if vehicles, err := database.NewVehicleRepo(db).GetAll(ctx); err == nil {
			for _, v := range vehicles {
				signalStore.LoadFromDB(ctx, v.ID)
			}
		}
		log.Info().Msg("signal store initialized")

		// Postgres signal_history writer (always-on per-signal history)
		signalHistoryWriter = database.NewSignalHistoryWriter(db, 2*time.Second, cacheStore.Underlying())
		telemetryHandler.SetSignalHistoryWriter(signalHistoryWriter)

		// Hydrate remaining signals from signal_history (covers all 230+ signals)
		// Must run before session/alert recovery so they see the full signal set.
		if vehicles, err := database.NewVehicleRepo(db).GetAll(ctx); err == nil {
			for _, v := range vehicles {
				if extra, err := signalHistoryWriter.GetLatestPerSignal(ctx, v.ID); err == nil {
					signalStore.Hydrate(v.ID, extra)
				} else {
					log.Warn().Err(err).Int64("vehicle_id", v.ID).Msg("signal store: hydration from signal_history failed")
				}
			}
		}
		log.Info().Msg("signal store hydrated from signal_history")

		go signalHistoryWriter.FlushLoop(ctx)
		log.Info().Int("retention_days", cfg.Retention.SignalHistoryRetentionDays).Msg("Postgres signal_history writer started")

		// Recover active drive/charge sessions from Postgres (pod restart resilience)
		sessionTracker := telemetryHandler.SessionTracker()
		signalLogReader := database.NewSignalLogReader(db)
		if sessionTracker != nil {
			sessionTracker.SetSignalLogReader(signalLogReader)
			sessionTracker.RecoverSessions(ctx)
			sessionTracker.ValidateRecoveredSessions(ctx)
			sessionTracker.RecoverIncompleteSessions(ctx)
			sessionTracker.StartBufferDrains(ctx)
		}

		// Populate alert prevSignals from SignalStore (pod restart resilience)
		alertEvaluator := telemetryHandler.AlertEvaluator()
		if alertEvaluator != nil {
			for _, vid := range signalStore.VehicleIDs() {
				raw := signalStore.GetRawMap(vid)
				if raw != nil {
					alertEvaluator.RuleEngine().LoadPrevSignalsFromStore(vid, raw)
				}
			}
			log.Info().Msg("alert prevSignals populated from signal store")
		}

		log.Info().Msg("FSM vehicle state engine active — declarative transition table with 20 transitions")

		// Start FSM reconciliation loop (compares FSM state against signal store)
		telemetryHandler.FSMHandler().StartReconcileLoop()

		// MongoDB raw telemetry capture (optional)
		if cfg.MongoDB.Enabled {
			mongoClient, err := database.NewMongoClient(cfg.MongoDB)
			if err != nil {
				log.Warn().Err(err).Msg("MongoDB connection failed — raw telemetry capture disabled")
			} else {
				defer mongoClient.Close()
				rawRepo := database.NewRawTelemetryRepo(mongoClient)
				telemetryHandler.SetRawTelemetryRepo(rawRepo)

				// Initialize per-signal log for full history
				signalLogRepo := database.NewSignalLogRepo(mongoClient)
				telemetryHandler.SetSignalLogRepo(signalLogRepo)

				log.Info().Str("database", cfg.MongoDB.Database).Int("ttl_days", cfg.MongoDB.TTLDays).Msg("MongoDB raw telemetry capture + signal log available")

				// Read initial capture toggle from settings
				settingsRepo := database.NewSettingsRepo(db)
				if _, err := settingsRepo.GetPollingConfig(ctx); err == nil {
					// TelemetryCapture toggle was removed in the typed-schema migration.
					// Raw capture is now controlled via MongoDB availability only.
					log.Debug().Msg("polling config loaded (telemetry capture toggle removed)")
				}
			}
		}

		// Start periodic cleanup of stale streaming/session state
		telemetryHandler.StartCleanup(ctx)

		// Backfill addresses for drives that have coordinates but no geocoded name
		go telemetryHandler.SessionTracker().BackfillAddresses(ctx)

		// Start MQTT subscriber for fleet-telemetry data
		if mqttClient != nil && cfg.FleetTelemetry.TopicBase != "" {
			ftSubscriber := mqtt.NewSubscriber(
				mqttClient.Underlying(),
				cfg.FleetTelemetry.TopicBase,
				cfg.FleetTelemetry.BatchMs,
				func(ctx context.Context, vin string, signals map[string]interface{}) {
					// Process signals without re-publishing to MQTT (fleet-telemetry already published)
					telemetryHandler.ProcessSignals(ctx, vin, signals, false)
				},
			)
			if err := ftSubscriber.Start(); err != nil {
				log.Warn().Err(err).Msg("fleet-telemetry MQTT subscriber failed to start")
			} else {
				log.Info().
					Str("topic_base", cfg.FleetTelemetry.TopicBase).
					Int("batch_ms", cfg.FleetTelemetry.BatchMs).
					Dur("stale_timeout", cfg.FleetTelemetry.StaleTimeout).
					Msg("fleet-telemetry MQTT subscriber active")
				defer ftSubscriber.Stop()
			}
		}
	}

	// Worker (vehicle poller) — runs in a self-healing goroutine.
	// When fleet telemetry is enabled, the worker operates in fallback mode:
	// it only polls vehicles that are NOT actively streaming via telemetry.
	w := worker.New(db, teslaClient, mqttClient, cfg.Worker, eventBus, encryptor)

	// Initialise the adaptive polling engine
	pollEngineCfg := polling.DefaultEngineConfig()
	pollEngineCfg.FleetTelemetryEnabled = cfg.FleetTelemetry.Enabled
	pollEngine := polling.NewPollEngine(pollEngineCfg)

	// Wire the predictive scheduler if we have a database
	if db != nil && db.Pool != nil {
		predictor := polling.NewPredictor(db.Pool)
		predictor.RefreshIfNeeded(ctx)
		pollEngine.SetPredictor(predictor)
	}

	w.PollEngine = pollEngine

	if telemetryHandler != nil {
		w.IsVehicleStreaming = telemetryHandler.IsVehicleStreaming
		w.FleetTelemetryEnabled = true
		w.SetFallbackPollInterval(cfg.FleetTelemetry.FallbackPollInterval)
		log.Info().
			Dur("fallback_poll_interval", cfg.FleetTelemetry.FallbackPollInterval).
			Dur("stale_timeout", cfg.FleetTelemetry.StaleTimeout).
			Msg("fleet telemetry primary mode — worker will only poll non-streaming vehicles as fallback")
	}

	log.Info().
		Bool("fleet_telemetry", pollEngineCfg.FleetTelemetryEnabled).
		Bool("predictor", pollEngine != nil).
		Msg("adaptive polling engine initialised")

	resilience.SafeGoLoop(ctx, "vehicle-poller", func(loopCtx context.Context) {
		w.Start(loopCtx)
	})
	log.Info().Msg("vehicle poller started (resilient mode)")
	health.RecordSuccess("worker")

	// Notification worker — processes notifications via MQTT queue
	if mqttClient != nil {
		notifWorker := notification.NewWorker(db)
		resilience.SafeGoLoop(ctx, "notification-worker", func(loopCtx context.Context) {
			notifWorker.Start(loopCtx, mqttClient.Underlying())
		})
	}

	// Maintenance worker — periodic data retention cleanup
	resilience.SafeGoLoop(ctx, "maintenance-worker", func(loopCtx context.Context) {
		worker.StartMaintenanceWorker(loopCtx, db, cfg)
	})
	log.Info().Msg("maintenance worker started")

	// Signal history TTL cleanup — daily purge of old rows (only if retention configured)
	if signalHistoryWriter != nil && cfg.Retention.SignalHistoryRetentionDays > 0 {
		go func() {
			signalHistoryWriter.Cleanup(ctx, cfg.Retention.SignalHistoryRetentionDays)

			ticker := time.NewTicker(24 * time.Hour)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					signalHistoryWriter.Cleanup(ctx, cfg.Retention.SignalHistoryRetentionDays)
				}
			}
		}()
		log.Info().Int("retention_days", cfg.Retention.SignalHistoryRetentionDays).Msg("signal_history TTL cleanup scheduled")
	} else if signalHistoryWriter != nil {
		log.Info().Msg("signal_history TTL cleanup DISABLED (SIGNAL_HISTORY_RETENTION_DAYS not set)")
	}

	// Trip generator — backfill monthly summaries on startup, then daily
	tripRepo := database.NewTripRepo(db)
	go func() {
		// Backfill on startup
		count, err := tripRepo.GenerateMonthlyTrips(ctx)
		if err != nil {
			log.Warn().Err(err).Msg("trip generator: backfill failed")
		} else if count > 0 {
			log.Info().Int("created", count).Msg("trip generator: backfilled monthly summaries")
		}

		// Then run daily at midnight
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

	// Gas price worker — polls EIA API for US average gasoline price
	var gasPriceWorker *worker.GasPriceWorker
	if cfg.GasPrice.APIKey != "" {
		eiaAdapter := gasprices.NewEIAAdapter(cfg.GasPrice.APIKey)
		gasPriceWorker = worker.NewGasPriceWorker(db, cfg.GasPrice, eiaAdapter)
		resilience.SafeGoLoop(ctx, "gas-price-worker", func(loopCtx context.Context) {
			gasPriceWorker.Start(loopCtx)
		})
		log.Info().
			Bool("enabled", cfg.GasPrice.Enabled).
			Str("poll_interval", cfg.GasPrice.PollInterval).
			Msg("gas price worker started")
	}

	// Periodic component health checker — sends notifications on state changes
	notifRepo := database.NewNotificationRepo(db)
	prevHealthState := make(map[string]resilience.ComponentStatus)
	resilience.SafeGo("health-watchdog", func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// Check database
				checkCtx, checkCancel := context.WithTimeout(ctx, 5*time.Second)
				if dbErr := db.Health(checkCtx); dbErr != nil {
					health.RecordFailure("database", dbErr)
					log.Warn().Err(dbErr).Msg("database health check failed")
				} else {
					health.RecordSuccess("database")
				}
				checkCancel()

				// Check MQTT connectivity
				if mqttClient != nil {
					if mqttClient.IsConnected() {
						health.RecordSuccess("mqtt")
					} else {
						health.RecordFailure("mqtt", fmt.Errorf("MQTT broker not connected"))
					}
				}

				// Check Tesla API auth status
				if teslaClient.HasValidToken() {
					health.RecordSuccess("tesla_api")
				}

				// Worker is alive if we reach this point (SafeGoLoop restarts on crash)
				health.RecordSuccess("worker")

				// Check for state transitions and create system alerts
				components := health.GetStatus()
				for name, comp := range components {
					prev, seen := prevHealthState[name]
					if !seen {
						prevHealthState[name] = comp.Status
						continue
					}

					// Component became unhealthy or degraded
					if prev == resilience.StatusHealthy && comp.Status >= resilience.StatusDegraded {
						severity := "warning"
						if comp.Status == resilience.StatusUnhealthy {
							severity = "critical"
						}
						title := fmt.Sprintf("%s is %s", componentDisplayName(name), comp.Status.String())
						message := fmt.Sprintf("Component %s has %d consecutive failures. Last error: %s", name, comp.ConsecFails, comp.LastError)
						_ = severity // logged below
						sendSystemNotification(ctx, notifRepo, mqttClient, "⚠️ "+title, message)
						log.Warn().Str("component", name).Str("status", comp.Status.String()).Str("severity", severity).Msg("system alert: component degraded")
					}

					// Component recovered
					if prev >= resilience.StatusDegraded && comp.Status == resilience.StatusHealthy {
						title := fmt.Sprintf("%s recovered", componentDisplayName(name))
						message := fmt.Sprintf("Component %s is healthy again", name)
						sendSystemNotification(ctx, notifRepo, mqttClient, "✅ "+title, message)
						log.Info().Str("component", name).Msg("system alert: component recovered")
					}

					prevHealthState[name] = comp.Status
				}

				// Log overall status
				overall := health.OverallStatus()
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

	// Provide OpenAPI spec to API layer (best-effort; non-fatal if missing)
	// Try absolute path first (Docker), then relative (local dev)
	specPaths := []string{"/docs/public/openapi.yaml", "docs/public/openapi.yaml"}
	for _, p := range specPaths {
		if specBytes, err := os.ReadFile(p); err == nil {
			api.SetOpenAPISpec(specBytes)
			break
		}
	}

	// HTTP API
	router := api.NewRouter(db, teslaClient, mqttClient, cfg, health, api.RouterOptions{
		AppVersion:       Version,
		Encryptor:        encryptor,
		TelemetryHandler: telemetryHandler,
		GasPriceWorker:   gasPriceWorker,
		PollEngine:       pollEngine,
		SignalStore:      signalStore,
		CacheStore:       cacheStore,
	})
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // Disabled for SSE long-lived connections (heartbeat keeps alive)
		IdleTimeout:  120 * time.Second,
	}

	// Record startup metrics
	metrics.AppInfo.WithLabelValues(Version, runtime.Version(), Commit).Set(1)
	metrics.StartupDuration.Set(time.Since(startupStart).Seconds())
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				metrics.UptimeSeconds.Set(time.Since(startupStart).Seconds())
			}
		}
	}()

	go func() {
		log.Info().Int("port", cfg.Port).Msg("HTTP server listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("HTTP server failed")
		}
	}()

	// Graceful shutdown with ordered teardown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Info().Str("signal", sig.String()).Msg("initiating graceful shutdown")

	// Phase 1: Stop accepting new work
	cancel()

	// Phase 2: Signal store no longer has Postgres flush (uses Redis + signal_log)
	// Nothing to flush here.

	// Phase 3: Shutdown telemetry handler goroutines
	if telemetryHandler != nil {
		// Stop FSM reconciliation before tearing down telemetry handler
		if fsmH := telemetryHandler.FSMHandler(); fsmH != nil {
			fsmH.StopReconcileLoop()
		}
		telemetryHandler.Shutdown()
		// Final drain of any buffered telemetry writes
		if st := telemetryHandler.SessionTracker(); st != nil {
			flushCtx, flushCancel := context.WithTimeout(context.Background(), 10*time.Second)
			st.FlushBuffers(flushCtx)
			flushCancel()
		}
	}

	// Phase 4: Drain HTTP connections
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("HTTP server shutdown error — forcing close")
		server.Close()
	}

	log.Info().Msg("TeslaSync stopped cleanly")
}

func setupLogger(level string) {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lvl)

	if os.Getenv("TESLASYNC_DEV") == "true" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}
}

func componentDisplayName(name string) string {
	switch name {
	case "database":
		return "PostgreSQL"
	case "mqtt":
		return "MQTT Broker"
	case "tesla_api":
		return "Tesla Fleet API"
	case "worker":
		return "Vehicle Poller"
	case "redis":
		return "Redis Cache"
	default:
		return name
	}
}

func sendSystemNotification(ctx context.Context, notifRepo *database.NotificationRepo, mqttClient *mqtt.Client, title, message string) {
	if mqttClient == nil {
		return
	}
	channels, err := notifRepo.GetAllChannels(ctx)
	if err != nil {
		return
	}
	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		req := &notification.Request{
			ChannelType: ch.Type,
			Config:      ch.Config,
			Title:       title,
			Message:     message,
			ChannelID:   ch.ID,
		}
		if err := notification.Publish(mqttClient.Underlying(), req); err != nil {
			log.Warn().Err(err).Int64("channel_id", ch.ID).Msg("failed to send system notification")
		}
	}
}
