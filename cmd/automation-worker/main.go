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

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/ev-dev-labs/teslasync/internal/automation"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/safety"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbauto "github.com/ev-dev-labs/teslasync/internal/database/automation"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"
	tsmqtt "github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tracing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	oteltrace "go.opentelemetry.io/otel/trace"
)

var Version = "dev"

func main() {
	// Built-in healthcheck for distroless containers
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		port := healthPort()
		resp, err := http.Get("http://localhost:" + port + "/healthz")
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
	log.Info().Str("version", Version).Msg("starting automation worker")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ── OpenTelemetry tracing ────────────────────────────────────────
	// Worker-owned TracerProvider tagged service.name=teslasync-automation-worker.
	// Init is non-fatal — see ADR-008.
	tracingShutdown, err := tracing.Init(ctx, cfg, tracing.WithServiceName("teslasync-automation-worker"))
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize tracing, continuing without it")
	} else if cfg.OpenTelemetry.Enabled {
		log.Info().
			Str("service", "teslasync-automation-worker").
			Str("endpoint", cfg.OTLPEndpoint).
			Msg("OpenTelemetry tracing enabled")
	}

	// Pyroscope continuous profiling is optional and non-fatal.
	profilerShutdown, err := tracing.StartProfiler(ctx, cfg, "teslasync-automation-worker")
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize pyroscope profiler, continuing without it")
	} else if cfg.Profiling.Enabled && cfg.Profiling.ServerAddress != "" {
		log.Info().
			Str("service", "teslasync-automation-worker").
			Str("server", cfg.Profiling.ServerAddress).
			Msg("Pyroscope continuous profiling enabled")
	}

	// ── Database ───────────────────────────────────────────────────────
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

	// ── Outbound api_call_logs sink ──────────────────────────────────
	// The automation worker fires Tesla OAuth refresh exchanges (via
	// internal/tesla.SetAuthSink) and notification webhooks (via
	// internal/notification.SetSink). Each worker process owns its own
	// asyncAPICallLogger because the API server's logger lives in another
	// process. When cfg.APILogs.Enabled=false we install a nil sink
	// (LoggedTransport then logs zerolog only).
	var inboundAPILogger apilog.Logger
	if cfg.APILogs.Enabled {
		apiLogRepo := systemdb.NewAPICallLogRepo(db)
		inboundAPILogger = apilog.NewAsync(apiLogRepo, apilog.AsyncOptions{
			QueueCapacity: cfg.APILogs.QueueCapacity,
			BatchSize:     cfg.APILogs.BatchSize,
			FlushInterval: cfg.APILogs.FlushInterval,
		})
		log.Info().
			Bool("capture_bodies", cfg.APILogs.CaptureBodies).
			Int("queue_capacity", cfg.APILogs.QueueCapacity).
			Int("batch_size", cfg.APILogs.BatchSize).
			Dur("flush_interval", cfg.APILogs.FlushInterval).
			Msg("automation-worker outbound api_call_logs sink enabled")
	} else {
		log.Info().Msg("automation-worker outbound api_call_logs sink disabled (API_LOGS_INBOUND_ENABLED=false)")
	}
	outboundAPILogSink := apilog.SinkAdapter(inboundAPILogger, cfg.APILogs.CaptureBodies)
	notification.SetSink(outboundAPILogSink)
	tesla.SetAuthSink(outboundAPILogSink, cfg.Tesla.Timeout)

	// ── MQTT (raw paho for trigger subscriptions) ──────────────────────
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.MQTT.BrokerURL()).
		SetClientID(cfg.MQTT.ClientID + "-automation-worker").
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

	// ── Tesla Client ──────────────────────────────────────────────────
	teslaClient := tesla.NewClient(cfg.Tesla)
	log.Info().Msg("Tesla client initialised")

	// ── Repositories ──────────────────────────────────────────────────
	automationRepo := dbauto.NewAutomationRepo(db)
	historyRepo := dbauto.NewAutomationHistoryRepo(db)
	vehicleRepo := vehicledb.NewVehicleRepo(db)
	commandLogRepo := energydb.NewCommandLogRepo(db)
	settingsRepo := settingsdb.NewSettingsRepo(db)
	notifRepo := dbnotif.NewNotificationRepo(db)
	varRepo := dbauto.NewAutomationVariableRepo(db)

	// ── Action Chain Executor ─────────────────────────────────────────
	chainExecutor := action.NewChainExecutor(vehicleRepo)

	// Register action executors.
	chainExecutor.Register("command", action.NewCommandExecutor(
		vehicleRepo, commandLogRepo, settingsRepo, teslaClient,
	))
	chainExecutor.Register("notify", action.NewNotifyExecutor(notifRepo, vehicleRepo, nil))
	chainExecutor.Register("set_variable", action.NewSetVariableExecutor(&variableRepoAdapter{repo: varRepo}))
	chainExecutor.Register("wait", action.NewWaitExecutor())

	// ── Safety Guards ─────────────────────────────────────────────────
	rateLimiter := safety.NewRateLimiter(historyRepo)
	loopDetector := safety.NewLoopDetector(
		safety.WithDisabler(automationRepo),
	)

	// ── Engine ────────────────────────────────────────────────────────
	engine := automation.NewEngine(
		automationRepo, historyRepo, chainExecutor,
		automation.WithRateLimiter(rateLimiter),
		automation.WithLoopDetector(loopDetector),
		automation.WithAuditor(automation.NewAuditor(nil)),
	)

	// ── Trigger Managers ──────────────────────────────────────────────
	// Triggers reference engine for the AutomationEngine.Evaluate callback.
	// Then we attach them back to the engine for lifecycle management.

	cronTrig := trigger.NewCronTrigger(automationRepo, engine)
	engine.SetCronTrigger(cronTrig)

	signalTrig := trigger.NewSignalTrigger(automationRepo, engine)
	engine.SetSignalTrigger(signalTrig)

	eventTrig := trigger.NewEventTrigger(automationRepo, engine)
	engine.SetEventTrigger(eventTrig)

	webhookTrig := trigger.NewWebhookTrigger(automationRepo, engine)

	// ── Start Engine ──────────────────────────────────────────────────
	if err := engine.Start(ctx); err != nil {
		log.Error().Err(err).Msg("engine start had errors (non-fatal)")
	}

	// ── Subscribe to Reload Channel ───────────────────────────────────
	reloadTopic := cfg.MQTT.Prefix + "/automations/reload"
	reloadToken := mqttClient.Subscribe(reloadTopic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
		// Extract upstream trace context so the reload-handler span
		// nests under the API request span that triggered this reload.
		// Legacy passthrough means in-flight messages from older API
		// pods still work during a rolling deploy.
		msgCtx, payload := tsmqtt.ExtractTraceContext(ctx, msg.Payload())
		tracer := otel.Tracer("cmd/automation-worker")
		msgCtx, span := tracer.Start(msgCtx, "automation.reload_signal",
			oteltrace.WithSpanKind(oteltrace.SpanKindConsumer),
			oteltrace.WithAttributes(
				semconv.MessagingSystemKey.String("mqtt"),
				semconv.MessagingDestinationName(reloadTopic),
				semconv.MessagingOperationTypeKey.String("process"),
				attribute.Int("messaging.message.payload_size_bytes", len(msg.Payload())),
			),
		)
		defer span.End()
		log.Info().
			Str("topic", msg.Topic()).
			Str("payload", string(payload)).
			Msg("received automation reload signal")
		if err := engine.Reload(msgCtx); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "engine reload failed")
			log.Error().Err(err).Msg("failed to reload engine after signal")
		}
	})
	if !reloadToken.WaitTimeout(10e9) {
		log.Error().Msg("MQTT subscribe timeout for reload channel")
	} else if reloadToken.Error() != nil {
		log.Error().Err(reloadToken.Error()).Msg("MQTT subscribe failed for reload channel")
	} else {
		log.Info().Str("topic", reloadTopic).Msg("subscribed to automation reload channel")
	}

	// ── Subscribe to Webhook Forwarding Channel ───────────────────────
	webhookTopic := cfg.MQTT.Prefix + "/internal/automations/webhook"
	webhookToken := mqttClient.Subscribe(webhookTopic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
		msgCtx, body := tsmqtt.ExtractTraceContext(ctx, msg.Payload())
		tracer := otel.Tracer("cmd/automation-worker")
		msgCtx, span := tracer.Start(msgCtx, "automation.webhook_forward",
			oteltrace.WithSpanKind(oteltrace.SpanKindConsumer),
			oteltrace.WithAttributes(
				semconv.MessagingSystemKey.String("mqtt"),
				semconv.MessagingDestinationName(webhookTopic),
				semconv.MessagingOperationTypeKey.String("process"),
				attribute.Int("messaging.message.payload_size_bytes", len(msg.Payload())),
			),
		)
		defer span.End()
		var payload struct {
			Token     string          `json:"token"`
			Body      json.RawMessage `json:"body"`
			Signature string          `json:"signature"`
			RemoteIP  string          `json:"remote_ip"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "invalid webhook payload")
			log.Error().Err(err).Msg("invalid webhook forwarding payload")
			return
		}
		span.SetAttributes(attribute.String("automation.webhook.token_prefix", safePrefix(payload.Token)))
		if err := webhookTrig.HandleWebhook(msgCtx, payload.Token, payload.Body, payload.Signature, payload.RemoteIP); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "webhook processing failed")
			log.Error().Err(err).Str("token_prefix", safePrefix(payload.Token)).Msg("webhook processing failed")
		}
	})
	if !webhookToken.WaitTimeout(10e9) {
		log.Error().Msg("MQTT subscribe timeout for webhook channel")
	} else if webhookToken.Error() != nil {
		log.Error().Err(webhookToken.Error()).Msg("MQTT subscribe failed for webhook channel")
	} else {
		log.Info().Str("topic", webhookTopic).Msg("subscribed to webhook forwarding channel")
	}

	log.Info().Msg("automation worker running")

	// ── Health Endpoint ───────────────────────────────────────────────
	port := healthPort()
	healthMux := http.NewServeMux()
	healthMux.HandleFunc("/healthz", healthHandler(db))
	healthMux.Handle("/metrics", promhttp.Handler())
	go func() {
		log.Info().Str("port", port).Msg("health endpoint listening")
		if err := http.ListenAndServe(":"+port, healthMux); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("health endpoint failed")
		}
	}()

	// ── Graceful Shutdown ─────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Info().Str("signal", sig.String()).Msg("shutting down automation worker")
	engine.Stop()
	cancel()
	// Drain the outbound api_call_logs writer with a FRESH context so
	// queued rows still reach Postgres after the root ctx has been
	// cancelled. Reusing the cancelled ctx here would short-circuit
	// CreateBatch on its very first call and drop everything in flight.
	if inboundAPILogger != nil {
		drainCtx, drainCancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := inboundAPILogger.Shutdown(drainCtx); err != nil {
			log.Warn().Err(err).Msg("automation-worker api_call_logs writer shutdown timed out — pending entries may have been dropped")
		} else {
			log.Info().Msg("automation-worker api_call_logs writer drained")
		}
		drainCancel()
	}
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
	log.Info().Msg("automation worker stopped")
}

func healthPort() string {
	port := os.Getenv("HEALTH_PORT")
	if port == "" {
		port = "8083"
	}
	return port
}

// healthChecker is the minimal database surface the health endpoint needs.
// Narrowing to this port keeps the handler unit-testable with a fake.
type healthChecker interface {
	Health(ctx context.Context) error
}

// healthHandler returns the /healthz handler. It responds 200 with
// {"status":"ok"} when the checker is healthy and 503 with a JSON-encoded
// {"status":"unhealthy","error":...} otherwise. The error message is
// marshalled rather than string-interpolated so a checker error containing
// quotes or newlines still produces valid, non-injectable JSON, and the
// JSON Content-Type is set on both the success and failure paths.
func healthHandler(checker healthChecker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := checker.Health(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			body, mErr := json.Marshal(struct {
				Status string `json:"status"`
				Error  string `json:"error"`
			}{Status: "unhealthy", Error: err.Error()})
			if mErr != nil {
				body = []byte(`{"status":"unhealthy"}`)
			}
			_, _ = w.Write(body)
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}
}

func safePrefix(token string) string {
	if len(token) <= 8 {
		return token[:len(token)/2] + "***"
	}
	return token[:8] + "***"
}

// variableStore is the persistence surface variableRepoAdapter needs.
// *dbauto.AutomationVariableRepo satisfies it in production; tests use a fake.
type variableStore interface {
	Get(ctx context.Context, key string) (*automationmodel.AutomationVariable, error)
	Set(ctx context.Context, key, value string, vehicleID *int64) error
}

// variableRepoAdapter wraps a variableStore to satisfy action.VariableRepo.
type variableRepoAdapter struct {
	repo variableStore
}

func (a *variableRepoAdapter) Get(ctx context.Context, key string) (*action.VariableEntry, error) {
	v, err := a.repo.Get(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("get automation variable %q: %w", key, err)
	}
	if v == nil {
		return nil, nil
	}
	return &action.VariableEntry{Key: v.Key, Value: v.Value}, nil
}

func (a *variableRepoAdapter) Set(ctx context.Context, key, value string, vehicleID *int64) error {
	if err := a.repo.Set(ctx, key, value, vehicleID); err != nil {
		return fmt.Errorf("set automation variable %q: %w", key, err)
	}
	return nil
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
