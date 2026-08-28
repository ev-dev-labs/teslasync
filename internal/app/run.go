package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/rs/zerolog/log"

	apirouter "github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/ops"
)

// ── Shutdown budget (OPS-09 / OPS-05) ────────────────────────────────
//
// These four budgets plus the preStop endpoint-propagation delay are the
// complete wall-clock cost of a graceful shutdown. Their sum has to fit
// inside the pod's terminationGracePeriodSeconds, or the kubelet SIGKILLs
// the container mid-drain and every in-flight request is dropped —
// exactly the failure the graceful path exists to prevent.
//
// Kubernetes' default grace period is 30s, which the old budgets
// (5 + 10 + 30 + 30 = 75s) blew through by 45s. The chart now sets
// terminationGracePeriodSeconds explicitly from
// .Values.terminationGracePeriodSeconds, and the three-way lock is
// enforced by:
//
//   - ops/rollout/stages.yaml `shutdown` records each budget,
//   - TestShutdownBudgetMatchesManifest asserts these constants equal it,
//   - `go run ./cmd/ops-gate -check rollout` asserts the recorded sum
//     plus headroom fits the chart's grace period.
//
// Changing any one of the three without the others fails a gate.
const (
	// TelemetryFlushBudget bounds the session-tracker buffer flush.
	TelemetryFlushBudget = 10 * time.Second
	// ServerDrainBudget bounds in-flight HTTP request completion.
	ServerDrainBudget = 30 * time.Second
	// InboundLogDrainBudget bounds the api_call_logs writer drain.
	InboundLogDrainBudget = 30 * time.Second
	// DrainListenerBudget bounds the isolated drain listener shutdown.
	DrainListenerBudget = 5 * time.Second
)

// Run constructs the HTTP router (via internal/api), starts the
// http.Server, records startup metrics, kicks off the uptime ticker
// goroutine, and blocks until ctx is cancelled or ListenAndServe
// returns. On ctx cancellation it performs the explicit shutdown
// sequence (cancel context → telemetry handler shutdown → server
// shutdown → inbound api_call_logs drain) before returning. The
// LIFO closer chain registered during [New] runs separately in
// [App.Close].
//
// Run blocks. The caller is expected to:
//
//	defer a.Close(shutdownCtx)
//	if err := a.Run(ctx); err != nil { … }
//
// so that Close() runs after Run() returns.
func (a *App) Run(ctx context.Context) error {
	r := apirouter.NewRouter(a.DB, a.TeslaClient, a.MQTT, a.Cfg, a.Health, a.StateReader, apirouter.RouterOptions{
		AppVersion:        a.Build.Version,
		Encryptor:         a.Encryptor,
		TelemetryHandler:  a.TelemetryHandler,
		GasPriceWorker:    a.GasPriceWorker,
		PollEngine:        a.PollEngine,
		SignalStore:       a.SignalStore,
		CacheStore:        a.Cache,
		DataRepairScanner: a.DataRepairScanner,

		// Dead-letter and feature-flag observability.
		DLQInspector:           a.DLQInspector,
		DLQReplayAuditRepo:     a.DLQReplayAuditRepo,
		FlagStore:              a.FlagStore,
		FeatureFlagChangesRepo: a.FeatureFlagChangesRepo,

		// Operator-confidence repositories.
		AuditRecorder:         a.AuditRecorder,
		AuditLogQueryRepo:     a.AuditLogQueryRepo,
		SlowQueriesRepo:       a.SlowQueriesRepo,
		HypertableMetricsRepo: a.HypertableMetricsRepo,
		IngestXRayRepo:        a.IngestXRayRepo,
		GDPRArtifactRepo:      a.GDPRArtifactRepo,
		RotationTracker:       a.RotationTracker,
		SchemaSeed:            a.SchemaSeed,

		// SLO and synthetic-check observability.
		SLOCatalog:        a.SLOCatalog,
		SLOTracker:        a.SLOTracker,
		DataQualityScorer: a.DataQualityScorer,
		SyntheticRunner:   a.SyntheticRunner,
	})
	a.server = &http.Server{
		Addr:         fmt.Sprintf(":%d", a.Cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // Disabled for SSE long-lived connections (heartbeat keeps alive)
		IdleTimeout:  120 * time.Second,
	}

	metrics.AppInfo.WithLabelValues(a.Build.Version, runtime.Version(), a.Build.Commit).Set(1)
	metrics.StartupDuration.Set(time.Since(a.startupStart).Seconds())

	// The isolated drain plane must be listening BEFORE the public
	// server accepts traffic: a pod that is serving requests but cannot
	// answer its preStop hook would be killed without draining.
	if _, err := a.startDrainListener(ctx); err != nil {
		return err
	}
	// SINGLE SHUTDOWN OWNER. This deferred call is the only place the
	// drain plane is torn down, and being a defer it runs after BOTH
	// exit paths below — including the ListenAndServe-failed path, which
	// the previous ctx.Done() watcher goroutine never covered. Deferring
	// it here also guarantees it runs LAST, after the telemetry, server,
	// and inbound-log drains, so kubelet can still retry the preStop
	// hook while the main server is draining.
	defer a.shutdownDrainListener()

	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				metrics.UptimeSeconds.Set(time.Since(a.startupStart).Seconds())
			}
		}
	}()

	errCh := make(chan error, 1)
	go func() {
		log.Info().Int("port", a.Cfg.Port).Msg("HTTP server listening")
		errCh <- a.server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		log.Info().Str("signal", ctx.Err().Error()).Msg("initiating graceful shutdown")
		// Fail readiness closed and release long-lived SSE streams
		// BEFORE draining the listener. http.Server.Shutdown does not
		// cancel in-flight handler contexts, so an attached SSE client
		// would otherwise hold the shutdown open for the entire 30s
		// grace budget. In Kubernetes the preStop hook already did this;
		// this covers plain SIGTERM (docker compose, local runs).
		apirouter.ShutdownGate.Drain()
		a.shutdownTelemetry()
		a.shutdownServer()
		a.shutdownInboundAPILogger()
		// The drain plane closes LAST, via the defer above — not here.
		log.Info().Msg("TeslaSync stopped cleanly")
		return nil
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("HTTP server failed: %w", err)
		}
		return nil
	}
}

// shutdownTelemetry stops the FSM reconcile loop, calls
// TelemetryHandler.Shutdown, and flushes the session-tracker write
// buffers with a 10s budget. Mirrors lines 947-960 of the legacy
// main.go.
func (a *App) shutdownTelemetry() {
	if a.TelemetryHandler == nil {
		return
	}
	if fsmH := a.TelemetryHandler.FSMHandler(); fsmH != nil {
		fsmH.StopReconcileLoop()
	}
	a.TelemetryHandler.Shutdown()
	if st := a.TelemetryHandler.SessionTracker(); st != nil {
		flushCtx, flushCancel := context.WithTimeout(context.Background(), TelemetryFlushBudget)
		st.FlushBuffers(flushCtx)
		flushCancel()
	}
}

// shutdownServer drains in-flight HTTP connections with a 30s budget,
// then forces close on timeout. Mirrors lines 962-969.
func (a *App) shutdownServer() {
	if a.server == nil {
		return
	}
	if err := ops.DrainHTTPServer(context.Background(), a.server, ServerDrainBudget); err != nil {
		log.Error().Err(err).Msg("HTTP server shutdown error — connections were force-closed")
	}
}

// shutdownInboundAPILogger drains the inbound api_call_logs writer
// after HTTP shutdown so no more requests can enqueue entries.
// Mirrors lines 971-979.
func (a *App) shutdownInboundAPILogger() {
	if a.InboundAPILogger == nil {
		return
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), InboundLogDrainBudget)
	defer cancel()
	if err := a.InboundAPILogger.Shutdown(shutdownCtx); err != nil {
		log.Warn().Err(err).Msg("inbound api_call_logs writer shutdown timed out — pending entries may have been dropped")
	} else {
		log.Info().Msg("inbound api_call_logs writer drained")
	}
}
