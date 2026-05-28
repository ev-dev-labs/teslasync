package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/backup"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbbackup "github.com/ev-dev-labs/teslasync/internal/database/backup"
	exportdb "github.com/ev-dev-labs/teslasync/internal/database/export"
	"github.com/ev-dev-labs/teslasync/internal/export"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tracing"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

var Version = "dev"

// tracerName scopes spans emitted by the export-worker process.
const tracerName = "cmd/export-worker"

func workerTracer() oteltrace.Tracer { return otel.Tracer(tracerName) }

func main() {
	// Built-in healthcheck for distroless containers
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		resp, err := http.Get("http://localhost:8082/healthz")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}
	setupLogger(cfg.LogLevel)
	log.Info().Str("version", Version).Msg("starting export worker")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ── OpenTelemetry tracing ────────────────────────────────────────
	// Worker-owned TracerProvider tagged service.name=teslasync-export-worker.
	// Init is non-fatal — see ADR-008.
	tracingShutdown, err := tracing.Init(ctx, cfg, tracing.WithServiceName("teslasync-export-worker"))
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize tracing, continuing without it")
	} else if cfg.OpenTelemetry.Enabled {
		log.Info().
			Str("service", "teslasync-export-worker").
			Str("endpoint", cfg.OTLPEndpoint).
			Msg("OpenTelemetry tracing enabled")
	}

	// Pyroscope continuous profiling — non-fatal (Phase-49 / p49-profiling).
	profilerShutdown, err := tracing.StartProfiler(ctx, cfg, "teslasync-export-worker")
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize pyroscope profiler, continuing without it")
	} else if cfg.Profiling.Enabled && cfg.Profiling.ServerAddress != "" {
		log.Info().
			Str("service", "teslasync-export-worker").
			Str("server", cfg.Profiling.ServerAddress).
			Msg("Pyroscope continuous profiling enabled")
	}

	// Database connection
	var db *database.DB
	err = resilience.ConnectWithRetry(ctx, "database", 10, func(ctx context.Context) error {
		var connErr error
		db, connErr = database.New(ctx, cfg.Database)
		return connErr
	})
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer db.Close()
	log.Info().Msg("database connected")

	// MQTT connection
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.MQTT.BrokerURL()).
		SetClientID(cfg.MQTT.ClientID + "-export-worker").
		SetAutoReconnect(true).
		SetCleanSession(true)

	if cfg.MQTT.Username != "" {
		opts.SetUsername(cfg.MQTT.Username)
		opts.SetPassword(cfg.MQTT.Password)
	}

	mqttClient := pahomqtt.NewClient(opts)
	token := mqttClient.Connect()
	if !token.WaitTimeout(10e9) {
		log.Fatal().Msg("MQTT connection timeout")
	}
	if token.Error() != nil {
		log.Fatal().Err(token.Error()).Msg("MQTT connection failed")
	}
	defer mqttClient.Disconnect(1000)
	log.Info().Msg("MQTT connected")

	// Start MQTT export consumer
	worker := export.NewWorker(db)
	go func() {
		worker.Start(ctx, mqttClient)
	}()

	// Periodic cleanup of old export jobs (every 6 hours, remove jobs older than 7 days)
	exportJobRepo := exportdb.NewExportJobRepo(db)
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tickCtx, span := workerTracer().Start(ctx, "export.cleanup_tick",
					oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
				deleted, err := exportJobRepo.CleanupOld(tickCtx, 7*24*time.Hour)
				if err != nil {
					span.RecordError(err)
					span.SetStatus(codes.Error, "cleanup failed")
					log.Error().Err(err).Msg("export cleanup: failed")
				} else if deleted > 0 {
					span.SetAttributes(attribute.Int64("export.cleanup.deleted", deleted))
					log.Info().Int64("deleted", deleted).Msg("export cleanup: removed old jobs")
				}
				span.End()
			}
		}
	}()

	// Backup scheduler — checks for due backup configs every 60s
	go func() {
		backupCfgRepo := dbbackup.NewBackupConfigRepo(db)
		backupRunRepo := dbbackup.NewBackupRunRepo(db)
		processor := backup.NewProcessor(db)
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		log.Info().Msg("backup scheduler started")
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tickCtx, span := workerTracer().Start(ctx, "export.backup_tick",
					oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
				dueConfigs, err := backupCfgRepo.GetDueConfigs(tickCtx)
				if err != nil {
					span.RecordError(err)
					span.SetStatus(codes.Error, "list due configs failed")
					log.Warn().Err(err).Msg("backup: failed to check due configs")
					span.End()
					continue
				}
				span.SetAttributes(attribute.Int("backup.due_count", len(dueConfigs)))
				for _, cfg := range dueConfigs {
					run := &backupmodel.BackupRun{
						ConfigID:   &cfg.ID,
						RunType:    "backup",
						BackupType: cfg.BackupType,
						Status:     "queued",
						Provider:   cfg.Provider,
						Metadata:   []byte(`{"trigger": "scheduled"}`),
					}
					if err := backupRunRepo.Create(tickCtx, run); err != nil {
						span.RecordError(err)
						log.Error().Err(err).Int64("config_id", cfg.ID).Msg("backup: failed to create scheduled run")
						continue
					}
					log.Info().Int64("config_id", cfg.ID).Str("name", cfg.Name).Msg("backup: starting scheduled backup")
					// Each backup run gets its own root context so the lifetime
					// outlives this tick. The per-run span links to the
					// scheduling tick via a Link attribute so dashboards can
					// trace "which tick scheduled this backup" without making
					// the tick wait synchronously.
					tickSpanCtx := span.SpanContext()
					go func(cfg *backupmodel.BackupConfig, run *backupmodel.BackupRun) {
						runCtx, runSpan := workerTracer().Start(
							context.Background(),
							"export.backup_run",
							oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
							oteltrace.WithLinks(oteltrace.Link{SpanContext: tickSpanCtx}),
							oteltrace.WithAttributes(
								attribute.Int64("backup.config_id", cfg.ID),
								attribute.String("backup.provider", cfg.Provider),
								attribute.String("backup.type", cfg.BackupType),
							),
						)
						processor.RunBackup(runCtx, cfg, run)
						runSpan.End()
					}(cfg, run)
				}
				span.End()
			}
		}
	}()

	log.Info().Msg("export worker running (MQTT consumer + job cleanup)")

	// Health endpoint for k8s probes
	healthPort := os.Getenv("HEALTH_PORT")
	if healthPort == "" {
		healthPort = "8082"
	}
	healthMux := http.NewServeMux()
	healthMux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Health(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprintf(w, `{"status":"unhealthy","error":"%s"}`, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	})
	go func() {
		log.Info().Str("port", healthPort).Msg("health endpoint listening")
		if err := http.ListenAndServe(":"+healthPort, healthMux); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("health endpoint failed")
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Info().Str("signal", sig.String()).Msg("shutting down export worker")
	cancel()
	worker.Shutdown()
	if tracingShutdown != nil {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := tracingShutdown(shutdownCtx); err != nil {
			log.Warn().Err(err).Msg("tracing shutdown failed")
		}
		shutdownCancel()
	}
	if profilerShutdown != nil {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := profilerShutdown(shutdownCtx); err != nil {
			log.Warn().Err(err).Msg("profiler shutdown failed")
		}
		shutdownCancel()
	}
	log.Info().Msg("export worker stopped")
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
