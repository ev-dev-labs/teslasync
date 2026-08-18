package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	"github.com/prometheus/client_golang/prometheus/promhttp"
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
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		os.Exit(healthcheckExitCode(ctx, http.DefaultClient, healthcheckURL(resolveHealthPort())))
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

	// Pyroscope continuous profiling is non-fatal.
	profilerShutdown, err := tracing.StartProfiler(ctx, cfg, "teslasync-export-worker")
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize pyroscope profiler, continuing without it")
	} else if cfg.Profiling.Enabled && cfg.Profiling.ServerAddress != "" {
		log.Info().
			Str("service", "teslasync-export-worker").
			Str("server", cfg.Profiling.ServerAddress).
			Msg("Pyroscope continuous profiling enabled")
	}

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

	worker := export.NewWorker(db)
	go func() {
		worker.Start(ctx, mqttClient)
	}()

	// Cleanup runs every 6 hours and removes export jobs older than 7 days.
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

	// Backup scheduler checks for due configs every 60s.
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
					run := newScheduledBackupRun(cfg)
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

	// Health endpoint for Kubernetes probes.
	healthPort := resolveHealthPort()
	healthMux := http.NewServeMux()
	healthMux.HandleFunc("/healthz", newHealthHandler(db))
	healthMux.Handle("/metrics", promhttp.Handler())
	go func() {
		log.Info().Str("port", healthPort).Msg("health endpoint listening")
		if err := http.ListenAndServe(":"+healthPort, healthMux); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("health endpoint failed")
		}
	}()

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

// resolveHealthPort returns the TCP port the health endpoint binds to. It
// honors HEALTH_PORT and falls back to 8082 (the port the image EXPOSEs). The
// same value is used by both the server and the in-container healthcheck probe
// so a custom port stays consistent across the two.
func resolveHealthPort() string {
	if p := os.Getenv("HEALTH_PORT"); p != "" {
		return p
	}
	return "8082"
}

// healthcheckURL builds the loopback URL the container healthcheck probe hits.
func healthcheckURL(port string) string {
	return fmt.Sprintf("http://localhost:%s/healthz", port)
}

// healthcheckExitCode performs the distroless container liveness probe. It GETs
// url and returns 0 only when the endpoint answers 200; any request-build
// failure, transport error, non-200 status, or context expiry yields 1. The
// response body is always closed to avoid leaking the connection, and the
// caller-supplied context bounds the request so the probe can never hang.
func healthcheckExitCode(ctx context.Context, client *http.Client, url string) int {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 1
	}
	resp, err := client.Do(req)
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

// healthChecker is the minimal surface newHealthHandler needs from the database
// pool, letting the handler be exercised without a live connection.
type healthChecker interface {
	Health(ctx context.Context) error
}

// newHealthHandler returns the /healthz handler. It responds 200 with
// {"status":"ok"} when the dependency is reachable and 503 with a JSON error
// body otherwise. The error string is JSON-encoded (not string-interpolated) so
// a driver message containing quotes cannot produce a malformed body, and
// Content-Type is set on both paths.
func newHealthHandler(hc healthChecker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := hc.Health(r.Context()); err != nil {
			body, _ := json.Marshal(map[string]string{
				"status": "unhealthy",
				"error":  err.Error(),
			})
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write(body)
			return
		}
		body, _ := json.Marshal(map[string]string{"status": "ok"})
		_, _ = w.Write(body)
	}
}

// newScheduledBackupRun builds the queued BackupRun the scheduler persists for a
// due config. ConfigID points at the config's ID so the run is attributable to
// its schedule, and the metadata records that a scheduled tick (not a manual
// request) triggered it.
func newScheduledBackupRun(cfg *backupmodel.BackupConfig) *backupmodel.BackupRun {
	return &backupmodel.BackupRun{
		ConfigID:   &cfg.ID,
		RunType:    "backup",
		BackupType: cfg.BackupType,
		Status:     "queued",
		Provider:   cfg.Provider,
		Metadata:   []byte(`{"trigger": "scheduled"}`),
	}
}
