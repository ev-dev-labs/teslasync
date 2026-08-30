package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	apirouter "github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/ops"
)

// ── Re-review finding 2: one ordered shutdown owner ──────────────────
//
// The previous version had TWO shutdown paths: a `<-ctx.Done()`
// goroutine started inside startDrainListener, and an explicit call in
// Run. They raced on the unsynchronised a.drainServer pointer, and the
// watcher usually won — closing the drain plane FIRST, when its entire
// purpose is to stay reachable until last so kubelet can retry the
// preStop hook while the main server drains.

func drainApp(port int) *App {
	return &App{Cfg: &config.Config{Port: 18080, DrainPort: port}}
}

// TestDrainListener_CtxCancellationDoesNotCloseIt is the direct
// regression for the removed watcher goroutine. Cancelling the context
// must NOT tear the drain plane down — Run owns that, and only after the
// main server has drained.
func TestDrainListener_CtxCancellationDoesNotCloseIt(t *testing.T) {
	apirouter.ShutdownGate = ops.NewReadinessGate()
	a := drainApp(18240)

	ctx, cancel := context.WithCancel(context.Background())
	if _, err := a.startDrainListener(ctx); err != nil {
		t.Fatalf("startDrainListener: %v", err)
	}
	defer a.shutdownDrainListener()

	cancel()
	// Give any (incorrectly reintroduced) watcher goroutine a generous
	// window to act.
	time.Sleep(250 * time.Millisecond)

	if !a.drainListenerRunning() {
		t.Fatal("context cancellation closed the drain listener; Run must own shutdown so the drain plane closes LAST")
	}
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d%s", a.Cfg.DrainPort, ops.DrainStatusPath))
	if err != nil {
		t.Fatalf("drain listener unreachable after ctx cancellation: %v", err)
	}
	resp.Body.Close()
}

// TestShutdownDrainListener_IsIdempotentUnderConcurrency exercises the
// once+mutex guard. Run with -race, this is the test that would have
// caught the original data race.
func TestShutdownDrainListener_IsIdempotentUnderConcurrency(t *testing.T) {
	apirouter.ShutdownGate = ops.NewReadinessGate()
	a := drainApp(18241)
	if _, err := a.startDrainListener(context.Background()); err != nil {
		t.Fatalf("startDrainListener: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a.shutdownDrainListener()
			_ = a.drainListenerRunning()
		}()
	}
	wg.Wait()

	if a.drainListenerRunning() {
		t.Fatal("listener still owned after shutdown")
	}
	// A second round must also be safe — Run's defer can fire after an
	// explicit call from Close().
	a.shutdownDrainListener()
}

func TestShutdownDrainListener_SafeWhenNeverStarted(t *testing.T) {
	a := drainApp(18242)
	a.shutdownDrainListener() // must not panic on the nil server
	if a.drainListenerRunning() {
		t.Fatal("unexpectedly reports a running listener")
	}
}

// TestDrainListener_ClosesLast proves the ordering property: the drain
// plane is still serving throughout the telemetry/server/inbound-log
// drains, and stops only when its own shutdown runs.
func TestDrainListener_ClosesLast(t *testing.T) {
	apirouter.ShutdownGate = ops.NewReadinessGate()
	a := drainApp(18243)
	if _, err := a.startDrainListener(context.Background()); err != nil {
		t.Fatalf("startDrainListener: %v", err)
	}

	probe := func(stage string) {
		t.Helper()
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d%s", a.Cfg.DrainPort, ops.DrainStatusPath))
		if err != nil {
			t.Fatalf("drain plane unreachable %s: %v", stage, err)
		}
		resp.Body.Close()
	}

	// Mirror Run's shutdown sequence. Each of these is a no-op on a
	// zero-value App, which is fine — the assertion is that none of them
	// takes the drain plane down.
	probe("before shutdown")
	a.shutdownTelemetry()
	probe("after telemetry flush")
	a.shutdownServer()
	probe("after HTTP server drain")
	a.shutdownInboundAPILogger()
	probe("after inbound log drain")

	// …and only now does it close.
	a.shutdownDrainListener()
	if a.drainListenerRunning() {
		t.Fatal("listener still owned after its shutdown")
	}
	if _, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d%s", a.Cfg.DrainPort, ops.DrainStatusPath)); err == nil {
		t.Fatal("drain plane still reachable after shutdown")
	}
}

// ── Re-review finding 4: loopback binding ────────────────────────────

// TestDrainListener_BindsLoopbackOnly is the exposure regression. A
// wildcard bind made a one-way, pod-fatal endpoint reachable by every
// pod on the cluster network.
func TestDrainListener_BindsLoopbackOnly(t *testing.T) {
	apirouter.ShutdownGate = ops.NewReadinessGate()
	a := drainApp(18244)
	addr, err := a.startDrainListener(context.Background())
	if err != nil {
		t.Fatalf("startDrainListener: %v", err)
	}
	defer a.shutdownDrainListener()

	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("parse bound address %q: %v", addr, err)
	}
	if host != "127.0.0.1" {
		t.Fatalf("drain listener bound to %q; a non-loopback bind exposes the pod-fatal endpoint to the pod network", host)
	}

	// Loopback works (this is how the preStop exec hook reaches it)…
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d%s", a.Cfg.DrainPort, ops.DrainStatusPath))
	if err != nil {
		t.Fatalf("loopback unreachable: %v", err)
	}
	resp.Body.Close()

	// …and a non-loopback local address does not. Skipped when the host
	// has no routable interface (some CI sandboxes).
	outbound := nonLoopbackIP(t)
	if outbound == "" {
		t.Skip("no non-loopback interface available to prove the negative")
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(outbound, fmt.Sprint(a.Cfg.DrainPort)), 2*time.Second)
	if err == nil {
		conn.Close()
		t.Fatalf("drain port is reachable on %s; the listener is not loopback-bound", outbound)
	}
}

func nonLoopbackIP(t *testing.T) string {
	t.Helper()
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() || ipnet.IP.To4() == nil {
			continue
		}
		return ipnet.IP.String()
	}
	return ""
}

// ── Re-review finding 4: stuck-drain self-heal ───────────────────────

// TestStuckDrainLiveness covers the escape hatch. The drain latch is
// one-way by design, but a pod that latched it and was never terminated
// would sit unready-but-alive forever: readiness says "send me nothing",
// liveness says "I'm fine", and nothing restarts it.
func TestStuckDrainLiveness(t *testing.T) {
	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	gate := ops.NewReadinessGate()
	gate.Now = func() time.Time { return now }

	clock := now
	handler := gate.GuardLiveness(apirouter.StuckDrainBudget, func() time.Time { return clock })(
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		})

	call := func() int {
		rec := newRecorder()
		handler(rec, httpGetRequest())
		return rec.Code
	}

	// Healthy pod: alive.
	if got := call(); got != http.StatusOK {
		t.Fatalf("healthy liveness = %d, want 200", got)
	}

	gate.Drain()

	// Immediately after draining — i.e. a NORMAL termination — liveness
	// must still pass. Failing here would make the kubelet restart a pod
	// that is shutting down correctly.
	if got := call(); got != http.StatusOK {
		t.Fatalf("liveness during normal termination = %d, want 200; a graceful shutdown must not be interrupted", got)
	}

	// Still inside the budget.
	clock = now.Add(apirouter.StuckDrainBudget - time.Second)
	if got := call(); got != http.StatusOK {
		t.Fatalf("liveness at budget-1s = %d, want 200", got)
	}

	// Past the budget: the pod drained but was never terminated.
	clock = now.Add(apirouter.StuckDrainBudget + time.Second)
	if got := call(); got != http.StatusServiceUnavailable {
		t.Fatalf("liveness for a stuck-drained pod = %d, want 503 so the kubelet restarts it", got)
	}
}

// TestStuckDrainBudgetExceedsShutdownBudget: the watchdog must never
// fire during a legitimate shutdown.
func TestStuckDrainBudgetExceedsShutdownBudget(t *testing.T) {
	m, err := ops.LoadRolloutManifest(repoFS(t), ops.RolloutManifestPath)
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	budget := time.Duration(m.Shutdown.TotalSeconds()) * time.Second
	if apirouter.StuckDrainBudget <= budget {
		t.Fatalf("StuckDrainBudget (%s) must exceed the %s shutdown budget, or a slow-but-legitimate termination would be restarted mid-drain",
			apirouter.StuckDrainBudget, budget)
	}
	declared := time.Duration(m.DrainPlane.StuckDrainLivenessBudgetSeconds) * time.Second
	if declared != apirouter.StuckDrainBudget {
		t.Fatalf("manifest declares %s but the code uses %s", declared, apirouter.StuckDrainBudget)
	}
}

// TestDrainPlaneManifestMatchesImplementation locks the manifest's
// drain-plane claims to what the code actually does.
func TestDrainPlaneManifestMatchesImplementation(t *testing.T) {
	m, err := ops.LoadRolloutManifest(repoFS(t), ops.RolloutManifestPath)
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	d := m.DrainPlane
	if d.BindAddress != "127.0.0.1" {
		t.Errorf("manifest bind_address = %q, want 127.0.0.1", d.BindAddress)
	}
	if d.HookType != "exec" {
		t.Errorf("manifest hook_type = %q, want exec", d.HookType)
	}
	if d.DrainPath != ops.DrainPath || d.PublicStatusPath != ops.DrainStatusPath {
		t.Errorf("manifest paths (%s / %s) do not match the code (%s / %s)",
			d.DrainPath, d.PublicStatusPath, ops.DrainPath, ops.DrainStatusPath)
	}
	if d.ExposedByService {
		t.Error("manifest claims the drain plane is Service-exposed")
	}
}

// ── small HTTP helpers shared by the drain-plane tests ───────────────

func newRecorder() *httptest.ResponseRecorder { return httptest.NewRecorder() }

func httpGetRequest() *http.Request {
	return httptest.NewRequest(http.MethodGet, "/healthz", nil)
}
