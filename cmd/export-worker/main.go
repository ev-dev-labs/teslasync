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
	"github.com/ev-dev-labs/teslasync/internal/export"
	"github.com/ev-dev-labs/teslasync/internal/resilience"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

var Version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}
	setupLogger(cfg.LogLevel)
	log.Info().Str("version", Version).Msg("starting export worker")

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
	exportJobRepo := database.NewExportJobRepo(db)
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				deleted, err := exportJobRepo.CleanupOld(ctx, 7*24*time.Hour)
				if err != nil {
					log.Error().Err(err).Msg("export cleanup: failed")
				} else if deleted > 0 {
					log.Info().Int64("deleted", deleted).Msg("export cleanup: removed old jobs")
				}
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
