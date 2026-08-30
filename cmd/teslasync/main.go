package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/app"
	"github.com/ev-dev-labs/teslasync/internal/config"
)

// main is intentionally a thin shell. All dependency-injection wiring
// lives in internal/app. Returning through run() instead of calling os.Exit
// directly preserves the deferred
// app.Close call so resources release even on error paths.
func main() { os.Exit(run()) }

func run() int {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			return healthcheck()
		case "drain":
			// Kubernetes preStop hook. See cmd/teslasync/drain.go.
			return drain()
		case "vapid-keygen":
			runVAPIDKeygen()
			return 0
		}
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		return 1
	}
	setupLogger(cfg.LogLevel)
	log.Info().Str("version", Version).Msg("starting TeslaSync")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	a, err := app.New(ctx, cfg, app.BuildInfo{Version: Version, Commit: Commit})
	if a != nil {
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			a.Close(shutdownCtx)
		}()
	}
	if errors.Is(err, app.ErrMigrateOnly) {
		log.Info().Msg("MIGRATE_ONLY=true — migrations complete, exiting")
		return 0
	}
	if err != nil {
		log.Error().Err(err).Msg("application init failed")
		return 1
	}

	if runErr := a.Run(ctx); runErr != nil {
		log.Error().Err(runErr).Msg("server stopped with error")
		return 1
	}
	return 0
}

func healthcheck() int {
	port := os.Getenv("TESLASYNC_PORT")
	if port == "" {
		port = "8080"
	}
	resp, err := http.Get("http://localhost:" + port + "/healthz")
	if err != nil || resp.StatusCode != 200 {
		return 1
	}
	return 0
}
