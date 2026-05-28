package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/ev-dev-labs/teslasync/internal/webpush"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

var Version = "dev"

// tracerName is the instrumentation scope for spans emitted by this
// worker process. Dashboards filter by this attribute to scope
// telemetry to "notification-worker tick loops".
const tracerName = "cmd/notification-worker"

func workerTracer() oteltrace.Tracer { return otel.Tracer(tracerName) }

func main() {
	// Built-in healthcheck for distroless containers
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		resp, err := http.Get("http://localhost:8081/healthz")
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
	log.Info().Str("version", Version).Msg("starting notification worker")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ── OpenTelemetry tracing ────────────────────────────────────────
	// Each worker process owns its own TracerProvider because they run
	// in distinct OS processes (and distinct containers in prod). The
	// service.name resource attribute distinguishes their spans in
	// Tempo. Init is non-fatal: if the OTLP collector is unreachable
	// the worker continues unsampled — same pattern as internal/app.New
	// initTracing() — see ADR-008.
	tracingShutdown, err := tracing.Init(ctx, cfg, tracing.WithServiceName("teslasync-notification-worker"))
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize tracing, continuing without it")
	} else if cfg.OpenTelemetry.Enabled {
		log.Info().
			Str("service", "teslasync-notification-worker").
			Str("endpoint", cfg.OTLPEndpoint).
			Msg("OpenTelemetry tracing enabled")
	}

	// ── Pyroscope continuous profiling ──────────────────────────────
	// Phase-49 / p49-profiling. Same non-fatal pattern as tracing.Init:
	// when the Pyroscope server is unreachable the worker continues
	// without profile uploads. UploadRate defaults to 15s — see
	// internal/config.ProfilingConfig and docs/runbooks/phase-49-pyroscope.md.
	profilerShutdown, err := tracing.StartProfiler(ctx, cfg, "teslasync-notification-worker")
	if err != nil {
		log.Warn().Err(err).Msg("failed to initialize pyroscope profiler, continuing without it")
	} else if cfg.Profiling.Enabled && cfg.Profiling.ServerAddress != "" {
		log.Info().
			Str("service", "teslasync-notification-worker").
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

	// ── Outbound api_call_logs sink ──────────────────────────────────
	// The notification worker fires HTTP webhooks (Discord/Slack/ntfy/
	// generic) via internal/notification, which builds its outbound
	// *http.Client through httputil.NewClient(Name="notify-generic").
	// Each worker process owns its own asyncAPICallLogger because the
	// API server's logger lives in another process and cannot be shared
	// over a function call boundary. When cfg.APILogs.Enabled=false we
	// install a nil sink (LoggedTransport then logs zerolog only).
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
			Msg("notification-worker outbound api_call_logs sink enabled")
	} else {
		log.Info().Msg("notification-worker outbound api_call_logs sink disabled (API_LOGS_INBOUND_ENABLED=false)")
	}
	notification.SetSink(apilog.SinkAdapter(inboundAPILogger, cfg.APILogs.CaptureBodies))

	// Web Push (VAPID) — same dispatcher hook the API server registers.
	// The notification worker is the actual MQTT consumer in production
	// (the API server only publishes), so any "webpush" Request that
	// reaches Send() resolves through this dispatcher.
	pushSubsRepo := dbnotif.NewPushSubscriptionsRepo(db)
	webpushSvc := webpush.NewService(pushSubsRepo, cfg.WebPush.PublicKey, cfg.WebPush.PrivateKey, cfg.WebPush.Subject)
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

	// MQTT connection
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.MQTT.BrokerURL()).
		SetClientID(cfg.MQTT.ClientID + "-notification-worker").
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

	// Start MQTT notification consumer
	// Phase-46 / Prompt 19 — register the quiet-hours decider so the
	// dispatcher can defer notifications during DND windows. Replay
	// loop below promotes deferred rows once the window ends.
	quietHoursRepo := database.NewQuietHoursRepo(db)
	quietHoursDecider := notification.NewRepoDecider(quietHoursRepo)
	worker := notification.NewWorker(db).WithQuietHoursDecider(quietHoursDecider)
	go func() {
		worker.Start(ctx, mqttClient)
	}()

	// Phase-46 / Prompt 19 — DND replay loop. Walks deferred_dnd rows
	// every 60 seconds and dispatches the ones whose window has
	// ended. Replay goes through notification.Send directly (NOT
	// MQTT) so we update the existing log row in place rather than
	// creating a duplicate row.
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tickCtx, span := workerTracer().Start(ctx, "notification.dnd_replay_tick",
					oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
				replayed, failed, err := worker.ReplayDeferred(tickCtx)
				span.SetAttributes(
					attribute.Int("notification.replayed", replayed),
					attribute.Int("notification.failed", failed),
				)
				if err != nil {
					span.RecordError(err)
					span.SetStatus(codes.Error, "replay deferred failed")
					log.Error().Err(err).Msg("notification: deferred replay failed")
					span.End()
					continue
				}
				if replayed > 0 || failed > 0 {
					log.Info().Int("replayed", replayed).Int("failed", failed).Msg("notification: deferred replay tick")
				}
				span.End()
			}
		}
	}()

	// Start schedule processor (checks every 60s for due notifications)
	schedRepo := dbnotif.NewNotificationScheduleRepo(db)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tickCtx, span := workerTracer().Start(ctx, "notification.schedule_tick",
					oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
				due, err := schedRepo.GetDue(tickCtx)
				if err != nil {
					span.RecordError(err)
					span.SetStatus(codes.Error, "fetch due failed")
					log.Error().Err(err).Msg("schedule: failed to fetch due notifications")
					span.End()
					continue
				}
				span.SetAttributes(attribute.Int("notification.schedule.due_count", len(due)))
				dispatched := 0
				for _, s := range due {
					ch, err := dbnotif.NewNotificationRepo(db).GetChannel(tickCtx, s.ChannelID)
					if err != nil || ch == nil {
						log.Warn().Int64("schedule_id", s.ID).Msg("schedule: channel not found, skipping")
						continue
					}
					req := &notification.Request{
						ChannelType: ch.Type,
						Config:      ch.Config,
						Title:       s.Title,
						Message:     s.Message,
						ChannelID:   ch.ID,
					}
					if pubErr := notification.PublishCtx(tickCtx, mqttClient, req); pubErr != nil {
						span.RecordError(pubErr)
						log.Error().Err(pubErr).Int64("schedule_id", s.ID).Msg("schedule: failed to publish")
					} else {
						dispatched++
					}
					// Mark as run (one-time schedules get disabled)
					if markErr := schedRepo.MarkRun(tickCtx, s.ID, nil); markErr != nil {
						span.RecordError(markErr)
						log.Error().Err(markErr).Int64("schedule_id", s.ID).Msg("schedule: failed to mark run")
					}
					log.Info().Int64("schedule_id", s.ID).Str("title", s.Title).Msg("schedule: dispatched")
				}
				span.SetAttributes(attribute.Int("notification.schedule.dispatched", dispatched))
				span.End()
			}
		}
	}()

	// Start computed-metric evaluator (every 5 minutes, evaluates all
	// enabled kind='computed_metric' rules and dispatches notifications via
	// the same MQTT pipeline as schedule entries). Sequential per tick is
	// fine — the registry SQL is cheap (uses cagg/per-table indexes) and
	// the rule count is small.
	alertRuleRepo := dbalert.NewAlertRuleRepo(db)
	notifRepoForCM := dbnotif.NewNotificationRepo(db)
	vehicleRepo := vehicledb.NewVehicleRepo(db)
	computedEval := computed.New(db)
	const computedMetricInterval = 5 * time.Minute
	go func() {
		ticker := time.NewTicker(computedMetricInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tickCtx, span := workerTracer().Start(ctx, "notification.computed_metric_tick",
					oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
				runComputedMetricTick(tickCtx, alertRuleRepo, vehicleRepo, notifRepoForCM, computedEval, mqttClient, span)
				span.End()
			}
		}
	}()

	log.Info().Msg("notification worker running (MQTT consumer + schedule processor + computed-metric evaluator)")

	// Health endpoint for k8s probes
	healthPort := os.Getenv("HEALTH_PORT")
	if healthPort == "" {
		healthPort = "8081"
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
	log.Info().Str("signal", sig.String()).Msg("shutting down notification worker")
	cancel()
	worker.Shutdown()
	// Drain the outbound api_call_logs writer with a FRESH context so
	// queued rows still reach Postgres after the root ctx has been
	// cancelled. Reusing the cancelled ctx here would short-circuit
	// CreateBatch on its very first call and drop everything in flight.
	if inboundAPILogger != nil {
		drainCtx, drainCancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := inboundAPILogger.Shutdown(drainCtx); err != nil {
			log.Warn().Err(err).Msg("notification-worker api_call_logs writer shutdown timed out — pending entries may have been dropped")
		} else {
			log.Info().Msg("notification-worker api_call_logs writer drained")
		}
		drainCancel()
	}
	// Flush remaining spans to the collector with a fresh, bounded
	// context. 5s mirrors internal/app.initTracing(). Must come AFTER
	// worker.Shutdown so any spans started inside in-flight handlers
	// are ended before the provider drains.
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
	log.Info().Msg("notification worker stopped")
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

// runComputedMetricTick walks every enabled computed_metric rule, evaluates
// it against each target vehicle, and dispatches a notification through MQTT
// for every triggered (rule, vehicle) pair. Vehicle resolution mirrors the
// signal-rule behavior in TelemetryAlertEvaluator: VehicleID == nil means
// "fan out across all vehicles in the fleet".
func runComputedMetricTick(
	ctx context.Context,
	alertRuleRepo *dbalert.AlertRuleRepo,
	vehicleRepo *vehicledb.VehicleRepo,
	notifRepo *dbnotif.NotificationRepo,
	evaluator *computed.Evaluator,
	mqttClient pahomqtt.Client,
	span oteltrace.Span,
) {
	rules, err := alertRuleRepo.GetEnabledByKind(ctx, "computed_metric")
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "load rules failed")
		log.Error().Err(err).Msg("computed-metric: failed to load rules")
		return
	}
	span.SetAttributes(attribute.Int("notification.computed_metric.rule_count", len(rules)))
	if len(rules) == 0 {
		return
	}

	// Resolve the target vehicle list once per tick — almost every fleet
	// reuses it across rules, so a single batched query is cheaper than one
	// per rule.
	allVehicles, err := vehicleRepo.GetAll(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "load vehicles failed")
		log.Error().Err(err).Msg("computed-metric: failed to load vehicles")
		return
	}

	channels, err := notifRepo.GetAllChannels(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "load channels failed")
		log.Error().Err(err).Msg("computed-metric: failed to load channels")
		return
	}

	triggered := 0
	for _, rule := range rules {
		targets := vehiclesForRule(rule, allVehicles)
		for _, vid := range targets {
			result, evalErr := evaluator.Evaluate(ctx, rule, vid)
			if evalErr != nil {
				span.RecordError(evalErr)
				log.Warn().
					Err(evalErr).
					Int64("rule_id", rule.ID).
					Int64("vehicle_id", vid).
					Msg("computed-metric: evaluator failed")
				continue
			}
			if !result.Triggered {
				continue
			}
			triggered++
			// Resolve a friendly vehicle name for the message template,
			// falling back silently when the vehicle is missing — the
			// renderer is tolerant of an empty VehicleName.
			vehicleName := ""
			for _, v := range allVehicles {
				if v != nil && v.ID == vid {
					if v.DisplayName != "" {
						vehicleName = v.DisplayName
					} else {
						vehicleName = v.VIN
					}
					break
				}
			}
			dispatchComputedMetricNotification(ctx, rule, vid, vehicleName, result, channels, mqttClient)
		}
	}
	span.SetAttributes(attribute.Int("notification.computed_metric.triggered", triggered))
}

func vehiclesForRule(rule *alertmodel.AlertRule, all []*vehiclemodel.Vehicle) []int64 {
	// Phase-49 / Slice 0005: multi-vehicle picker. Honour the new
	// sticky-all flag + explicit subset hydrated by the repo.
	if rule.AllVehicles {
		out := make([]int64, 0, len(all))
		for _, v := range all {
			out = append(out, v.ID)
		}
		return out
	}
	if len(rule.VehicleIDs) > 0 {
		out := make([]int64, len(rule.VehicleIDs))
		copy(out, rule.VehicleIDs)
		return out
	}
	// Legacy fallback: a rule that somehow has neither all_vehicles nor
	// any junction entries (malformed migration data) targets nothing.
	if rule.VehicleID != nil {
		return []int64{*rule.VehicleID}
	}
	return nil
}

func dispatchComputedMetricNotification(
	ctx context.Context,
	rule *alertmodel.AlertRule,
	vehicleID int64,
	vehicleName string,
	result computed.Result,
	channels []*notificationmodel.NotificationChannel,
	mqttClient pahomqtt.Client,
) {
	// Phase-50 / ADR-005: route computed-metric dispatch through the
	// shared alertmsg package so the message is rendered identically to
	// the telemetry path. Without this, a custom msg_template on a
	// computed-metric rule would be ignored and the IncludeTitle toggle
	// would never reach the transports.
	msgCtx := alertmsg.BuildContext(rule, vehicleName, nil, map[string]any{
		"Severity":        rule.Severity,
		"MetricValue":     result.Value,
		"MetricPrevValue": result.PreviousValue,
		"MetricChangePct": result.PercentChange,
	})
	title := alertmsg.RenderTitle(rule, msgCtx)
	body := alertmsg.RenderBody(rule, msgCtx)
	if !rule.IncludeTitle && body == "" {
		body = rule.Name
	}
	suppressTransportTitle := !rule.IncludeTitle

	dispatched := 0
	for _, ch := range channels {
		if ch == nil || !ch.Enabled {
			continue
		}
		req := &notification.Request{
			ChannelType:            ch.Type,
			Config:                 ch.Config,
			Title:                  title,
			Message:                body,
			ChannelID:              ch.ID,
			AlertID:                rule.ID,
			Severity:               rule.Severity,
			SuppressTransportTitle: suppressTransportTitle,
		}
		if pubErr := notification.PublishCtx(ctx, mqttClient, req); pubErr != nil {
			log.Error().
				Err(pubErr).
				Int64("rule_id", rule.ID).
				Int64("vehicle_id", vehicleID).
				Int64("channel_id", ch.ID).
				Msg("computed-metric: publish failed")
			continue
		}
		dispatched++
	}
	log.Info().
		Int64("rule_id", rule.ID).
		Int64("vehicle_id", vehicleID).
		Float64("value", result.Value).
		Int("dispatched", dispatched).
		Msg("computed-metric: alert fired")
}
