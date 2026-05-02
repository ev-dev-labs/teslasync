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
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/webpush"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

var Version = "dev"

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
	var inboundAPILogger api.APICallLogger
	if cfg.APILogs.Enabled {
		apiLogRepo := database.NewAPICallLogRepo(db)
		inboundAPILogger = api.NewAsyncAPICallLogger(apiLogRepo, api.AsyncLoggerOptions{
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
	notification.SetSink(api.APICallSinkAdapter(inboundAPILogger, cfg.APILogs.CaptureBodies))

	// Web Push (VAPID) — same dispatcher hook the API server registers.
	// The notification worker is the actual MQTT consumer in production
	// (the API server only publishes), so any "webpush" Request that
	// reaches Send() resolves through this dispatcher.
	pushSubsRepo := database.NewPushSubscriptionsRepo(db)
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
	worker := notification.NewWorker(db)
	go func() {
		worker.Start(ctx, mqttClient)
	}()

	// Start schedule processor (checks every 60s for due notifications)
	schedRepo := database.NewNotificationScheduleRepo(db)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				due, err := schedRepo.GetDue(ctx)
				if err != nil {
					log.Error().Err(err).Msg("schedule: failed to fetch due notifications")
					continue
				}
				for _, s := range due {
					ch, err := database.NewNotificationRepo(db).GetChannel(ctx, s.ChannelID)
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
					if pubErr := notification.Publish(mqttClient, req); pubErr != nil {
						log.Error().Err(pubErr).Int64("schedule_id", s.ID).Msg("schedule: failed to publish")
					}
					// Mark as run (one-time schedules get disabled)
					if markErr := schedRepo.MarkRun(ctx, s.ID, nil); markErr != nil {
						log.Error().Err(markErr).Int64("schedule_id", s.ID).Msg("schedule: failed to mark run")
					}
					log.Info().Int64("schedule_id", s.ID).Str("title", s.Title).Msg("schedule: dispatched")
				}
			}
		}
	}()

	// Start computed-metric evaluator (every 5 minutes, evaluates all
	// enabled kind='computed_metric' rules and dispatches notifications via
	// the same MQTT pipeline as schedule entries). Sequential per tick is
	// fine — the registry SQL is cheap (uses cagg/per-table indexes) and
	// the rule count is small.
	alertRuleRepo := database.NewAlertRuleRepo(db)
	notifRepoForCM := database.NewNotificationRepo(db)
	vehicleRepo := database.NewVehicleRepo(db)
	computedEval := api.NewComputedMetricEvaluator(db)
	const computedMetricInterval = 5 * time.Minute
	go func() {
		ticker := time.NewTicker(computedMetricInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runComputedMetricTick(ctx, alertRuleRepo, vehicleRepo, notifRepoForCM, computedEval, mqttClient)
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
alertRuleRepo *database.AlertRuleRepo,
vehicleRepo *database.VehicleRepo,
notifRepo *database.NotificationRepo,
evaluator *api.ComputedMetricEvaluator,
mqttClient pahomqtt.Client,
) {
rules, err := alertRuleRepo.GetEnabledByKind(ctx, "computed_metric")
if err != nil {
log.Error().Err(err).Msg("computed-metric: failed to load rules")
return
}
if len(rules) == 0 {
return
}

// Resolve the target vehicle list once per tick — almost every fleet
// reuses it across rules, so a single batched query is cheaper than one
// per rule.
allVehicles, err := vehicleRepo.GetAll(ctx)
if err != nil {
log.Error().Err(err).Msg("computed-metric: failed to load vehicles")
return
}

channels, err := notifRepo.GetAllChannels(ctx)
if err != nil {
log.Error().Err(err).Msg("computed-metric: failed to load channels")
return
}

for _, rule := range rules {
targets := vehiclesForRule(rule, allVehicles)
for _, vid := range targets {
result, evalErr := evaluator.Evaluate(ctx, rule, vid)
if evalErr != nil {
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
dispatchComputedMetricNotification(rule, vid, result, channels, mqttClient)
}
}
}

func vehiclesForRule(rule *models.AlertRule, all []*models.Vehicle) []int64 {
if rule.VehicleID != nil {
return []int64{*rule.VehicleID}
}
out := make([]int64, 0, len(all))
for _, v := range all {
out = append(out, v.ID)
}
return out
}

func dispatchComputedMetricNotification(
rule *models.AlertRule,
vehicleID int64,
result api.ComputedMetricResult,
channels []*models.NotificationChannel,
mqttClient pahomqtt.Client,
) {
dispatched := 0
for _, ch := range channels {
if ch == nil || !ch.Enabled {
continue
}
req := &notification.Request{
ChannelType: ch.Type,
Config:      ch.Config,
Title:       rule.Name,
Message:     result.Message,
ChannelID:   ch.ID,
AlertID:     rule.ID,
}
if pubErr := notification.Publish(mqttClient, req); pubErr != nil {
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
