package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
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
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/worker"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	setupLogger(cfg.LogLevel)
	log.Info().Str("version", Version).Msg("starting TeslaSync")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

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

	if err := db.Migrate(cfg.Database.MigrationsPath); err != nil {
		log.Fatal().Err(err).Msg("failed to run migrations")
	}
	log.Info().Msg("database migrations applied")

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
		} else {
			defer mqttClient.Disconnect()
			health.RecordSuccess("mqtt")
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
			Method:     method,
			URL:        url,
			DurationMs: durationMs,
		}
		if statusCode > 0 {
			logEntry.StatusCode = &statusCode
		}
		if len(reqBody) > 0 {
			s := string(reqBody)
			logEntry.RequestBody = &s
		}
		// Truncate response body to prevent excessive storage
		if len(respBody) > 0 {
			s := string(respBody)
			if len(s) > 10000 {
				s = s[:10000] + "...(truncated)"
			}
			logEntry.ResponseBody = &s
		}
		if callErr != nil {
			s := callErr.Error()
			logEntry.Error = &s
		}
		if err := apiLogRepo.Create(context.Background(), logEntry); err != nil {
			log.Error().Err(err).Msg("failed to log API call")
		}
	})

	// Worker (vehicle poller) — runs in a self-healing goroutine
	w := worker.New(db, teslaClient, mqttClient, cfg.Worker, eventBus, encryptor)
	resilience.SafeGoLoop(ctx, "vehicle-poller", func(loopCtx context.Context) {
		w.Start(loopCtx)
	})
	log.Info().Msg("vehicle poller started (resilient mode)")

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

	// Periodic component health checker
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

				// Log overall status
				overall := health.OverallStatus()
				if overall != resilience.StatusHealthy {
					components := health.GetStatus()
					for name, comp := range components {
						if comp.Status != resilience.StatusHealthy {
							log.Warn().Str("component", name).Str("status", comp.Status.String()).Int("consec_fails", comp.ConsecFails).Msg("degraded component")
						}
					}
				}
			}
		}
	})

	// HTTP API
	router := api.NewRouter(db, teslaClient, mqttClient, cfg, health, api.RouterOptions{
		AppVersion: Version,
		Encryptor:  encryptor,
	})
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second, // Increased for SSE and large analytics queries
		IdleTimeout:  120 * time.Second,
	}

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

	// Phase 2: Drain HTTP connections
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
