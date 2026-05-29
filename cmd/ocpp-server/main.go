// ocpp-server is the OCPP-J 1.6 CSMS (Charging Station Management
// System) entrypoint. It accepts WebSocket connections from
// non-Tesla chargers (Wallbox, OpenEVSE, EVlink, etc.) on the
// `ocpp1.6` subprotocol and routes the protocol messages through
// the internal/ocpp dispatcher.
//
// Usage:
//
//	docker compose up ocpp-server
//
//	# Connect a charger to:
//	ws://ocpp-server.lan:9090/ocpp/<chargePointId>
//
// Env:
//
//	OCPP_LISTEN_ADDR           (default :9090)
//	OCPP_HEARTBEAT_INTERVAL    (default 300s) — interval returned in BootNotification
//	OCPP_READ_DEADLINE         (default 900s) — closes the WS if no message within this window
//
// Persistence: the foundation PR uses the in-memory session store
// (internal/ocpp.MemorySessionStore). A Postgres-backed store can be
// wired here in a follow-up without touching the protocol layer.
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ocpp"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	addr := envOr("OCPP_LISTEN_ADDR", ":9090")
	heartbeat := envDurationOr("OCPP_HEARTBEAT_INTERVAL", 300*time.Second)
	readDeadline := envDurationOr("OCPP_READ_DEADLINE", 900*time.Second)

	store := ocpp.NewMemorySessionStore()
	dispatcher := ocpp.NewDispatcher(store, heartbeat)
	server := ocpp.NewServer(dispatcher, readDeadline)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.Handle("/ocpp/", server)

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	go func() {
		log.Info().Str("addr", addr).
			Dur("heartbeat_interval", heartbeat).
			Dur("read_deadline", readDeadline).
			Msg("OCPP CSMS listening")
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("OCPP server failed")
		}
	}()

	<-ctx.Done()
	log.Info().Msg("OCPP CSMS shutting down")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	_ = httpSrv.Shutdown(shutdownCtx)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envDurationOr(key string, def time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return def
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		log.Warn().Err(err).Str("key", key).Str("raw", raw).Msg("invalid duration, using default")
		return def
	}
	return d
}
