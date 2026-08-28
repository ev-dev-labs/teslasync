package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	apirouter "github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/ops"
)

// ── Isolated drain plane (OPS-09) ────────────────────────────────────
//
// The Kubernetes preStop hook must be able to drain this pod. That
// action is one-way and pod-fatal: it flips the readiness gate closed
// permanently, releases every SSE stream, and holds its response open
// for the endpoint-propagation delay. Exactly the sort of thing that
// must not be reachable from the internet.
//
// Mounting it on the main router put it behind the same listener the
// Service and Ingress publish, outside ForwardAuth, on a well-known
// path. Anything that could reach /api/v1 could permanently remove a
// healthy pod from the fleet, one request at a time.
//
// The fix is structural rather than a header check (an inbound
// User-Agent or a custom header is trivially spoofable by the very
// callers we are excluding): the drain endpoint binds to its OWN
// listener on a port that no Service and no Ingress targets. Kubelet
// reaches a preStop httpGet by dialling the pod IP directly, so it
// needs no Service — but nothing outside the cluster's pod network can
// route to it.
//
// The public router keeps only the read-only /internal/drain-status
// contract, which is what the post-deploy smoke gate probes.

// startDrainListener binds the isolated internal drain listener.
//
// It returns the bound address so callers (and tests) can observe the
// effective port when the configured one was 0. A bind failure is
// returned rather than logged-and-ignored: a pod whose preStop hook
// cannot be served would be torn down without draining, dropping
// in-flight requests on every rollout.
//
// SHUTDOWN OWNERSHIP: this function deliberately starts NO lifecycle
// goroutine. An earlier version watched ctx.Done() here *and* had Run
// call shutdownDrainListener, which produced two concurrent, unordered
// shutdowns racing on a.drainServer — and, worse, the watcher usually
// won, closing the drain plane FIRST when its whole purpose is to stay
// reachable until last. [App.Run] is now the single owner via a defer,
// which also covers the non-context exit paths the watcher never did.
func (a *App) startDrainListener(_ context.Context) (string, error) {
	port := a.Cfg.DrainPort
	if port == 0 {
		return "", errors.New("app: TESLASYNC_DRAIN_PORT is 0; the preStop drain hook would be unreachable")
	}
	if port == a.Cfg.Port {
		return "", fmt.Errorf("app: TESLASYNC_DRAIN_PORT (%d) must differ from TESLASYNC_PORT — the drain endpoint must not be reachable through the public Service", port)
	}

	mux := ops.NewInternalDrainMux(
		apirouter.ShutdownGate,
		port,
		apirouter.EndpointPropagationDelay,
		nil,
	)
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		// No WriteTimeout: the preStop handler deliberately holds its
		// response open for the endpoint-propagation delay.
	}

	// LOOPBACK ONLY. The preStop hook is an `exec` that runs INSIDE this
	// container (`teslasync drain`), so 127.0.0.1 is reachable to it —
	// while nothing else in the cluster can dial the port at all. A
	// wildcard bind was reachable by any pod on the network, and the
	// endpoint is one-way and pod-fatal, so a stray curl could remove a
	// healthy pod from service permanently.
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return "", fmt.Errorf("app: bind internal drain listener on 127.0.0.1:%d: %w", port, err)
	}

	a.drainMu.Lock()
	a.drainServer = srv
	a.drainMu.Unlock()

	go func() {
		log.Info().
			Str("bind", ln.Addr().String()).
			Str("drain_path", ops.DrainPath).
			Str("status_path", ops.DrainStatusPath).
			Msg("internal drain listener started (loopback only; not reachable from the pod network)")
		if serveErr := srv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			log.Error().Err(serveErr).Msg("internal drain listener failed")
		}
	}()

	return ln.Addr().String(), nil
}

// shutdownDrainListener stops the internal listener.
//
// It runs LAST in the shutdown sequence: while the main server is still
// draining, kubelet may retry the preStop hook, and an already-closed
// drain plane would make that retry fail.
//
// Safe to call from any goroutine and any number of times. The once
// guard plus the mutex-protected hand-off eliminate the double-shutdown
// race, and taking a local copy of the pointer removes the window in
// which a concurrent caller could observe a nil server mid-teardown.
func (a *App) shutdownDrainListener() {
	a.drainOnce.Do(func() {
		a.drainMu.Lock()
		srv := a.drainServer
		a.drainServer = nil
		a.drainMu.Unlock()

		if srv == nil {
			return
		}
		if err := ops.DrainHTTPServer(context.Background(), srv, DrainListenerBudget); err != nil {
			log.Warn().Err(err).Msg("internal drain listener shutdown was forced")
		} else {
			log.Info().Msg("internal drain listener closed (last)")
		}
	})
}

// drainListenerRunning reports whether the listener is still owned. Used
// by tests to assert shutdown ordering.
func (a *App) drainListenerRunning() bool {
	a.drainMu.Lock()
	defer a.drainMu.Unlock()
	return a.drainServer != nil
}
