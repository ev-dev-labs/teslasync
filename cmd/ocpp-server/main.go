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
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ocpp"
)

const (
	defaultListenAddr        = ":9090"
	defaultHeartbeatInterval = 300 * time.Second
	defaultReadDeadline      = 900 * time.Second
	// readHeaderTimeout bounds the header-read phase of the initial
	// HTTP/WebSocket handshake — a defence against slowloris-style
	// clients holding a connection open before the upgrade.
	readHeaderTimeout = 10 * time.Second
	// shutdownTimeout bounds how long graceful drain waits for
	// in-flight charger connections before forcing them closed.
	shutdownTimeout = 10 * time.Second
)

// config is the fully-resolved runtime configuration for the CSMS.
// It is a plain value so tests can construct it directly instead of
// mutating the process environment.
type config struct {
	listenAddr        string
	heartbeatInterval time.Duration
	readDeadline      time.Duration
}

// loadConfig resolves the CSMS configuration from the environment,
// falling back to spec-sensible defaults for anything unset or blank.
func loadConfig() config {
	return config{
		listenAddr:        envOr("OCPP_LISTEN_ADDR", defaultListenAddr),
		heartbeatInterval: envDurationOr("OCPP_HEARTBEAT_INTERVAL", defaultHeartbeatInterval),
		readDeadline:      envDurationOr("OCPP_READ_DEADLINE", defaultReadDeadline),
	}
}

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	cfg := loadConfig()
	log.Info().
		Str("addr", cfg.listenAddr).
		Dur("heartbeat_interval", cfg.heartbeatInterval).
		Dur("read_deadline", cfg.readDeadline).
		Msg("OCPP CSMS configuration loaded")

	// Bind before entering the serve loop so a bad OCPP_LISTEN_ADDR
	// (port in use, insufficient privileges) fails fast + visibly
	// rather than racing inside a background goroutine.
	ln, err := net.Listen("tcp", cfg.listenAddr)
	if err != nil {
		log.Fatal().Err(err).Str("addr", cfg.listenAddr).Msg("OCPP server failed to bind")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx, newServer(cfg), ln, shutdownTimeout); err != nil {
		log.Fatal().Err(err).Msg("OCPP server failed")
	}
}

// newServer builds the HTTP server that fronts the OCPP CSMS: a
// /healthz liveness probe plus the WebSocket transport mounted at
// /ocpp/. Persistence uses the zero-config in-memory session store;
// a Postgres-backed store can be swapped in without changing this
// wiring or the protocol layer.
func newServer(cfg config) *http.Server {
	store := ocpp.NewMemorySessionStore()
	dispatcher := ocpp.NewDispatcher(store, cfg.heartbeatInterval)
	ocppServer := ocpp.NewServer(dispatcher, cfg.readDeadline)
	return &http.Server{
		Handler:           newMux(ocppServer),
		ReadHeaderTimeout: readHeaderTimeout,
	}
}

// newMux wires the health probe and the OCPP WebSocket handler. A
// charger connects to /ocpp/{chargePointId}; every other path 404s.
func newMux(ocppHandler http.Handler) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthz)
	mux.Handle("/ocpp/", ocppHandler)
	return mux
}

// healthz is a dependency-free liveness probe. It deliberately never
// touches the OCPP layer so it stays green even when no charger is
// connected.
func healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// run serves on ln until ctx is cancelled, then gracefully drains
// in-flight connections within shutdownTimeout. A serve failure before
// shutdown is returned (wrapped) so the caller can exit non-zero; a
// clean shutdown returns nil.
func run(ctx context.Context, srv *http.Server, ln net.Listener, drainTimeout time.Duration) error {
	serveErr := make(chan error, 1)
	go func() {
		log.Info().Str("addr", ln.Addr().String()).Msg("OCPP CSMS listening")
		err := srv.Serve(ln)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		serveErr <- err
	}()

	select {
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("serve: %w", err)
		}
		return nil
	case <-ctx.Done():
	}

	log.Info().Msg("OCPP CSMS shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), drainTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	return nil
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
