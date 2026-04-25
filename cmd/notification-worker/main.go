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
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/resilience"

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

	log.Info().Msg("notification worker running (MQTT consumer + schedule processor)")

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
