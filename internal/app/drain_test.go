package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	apirouter "github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/ops"
)

// ── OPS-09 / review findings 2 and 5 ─────────────────────────────────
//
// The drain endpoint used to live on the main router: publicly routable,
// outside ForwardAuth, and one-way pod-fatal. These tests pin the
// replacement contract — a separate listener on a separate port — and the
// shutdown budget that the chart's terminationGracePeriodSeconds has to
// hold.

func newDrainApp(t *testing.T, port int) *App {
	t.Helper()
	return &App{Cfg: &config.Config{Port: 18080, DrainPort: port}}
}

func TestStartDrainListener_BindsSeparatePortAndServesDrainPlane(t *testing.T) {
	// Reset the process-wide gate so this test is order-independent.
	apirouter.ShutdownGate = ops.NewReadinessGate()

	a := newDrainApp(t, 0)
	// Port 0 is rejected on purpose (see below); use an ephemeral high
	// port instead and assert the bound address.
	a.Cfg.DrainPort = 18190

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	addr, err := a.startDrainListener(ctx)
	if err != nil {
		t.Fatalf("startDrainListener: %v", err)
	}
	defer a.shutdownDrainListener()

	if addr == "" {
		t.Fatal("no bound address returned")
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", a.Cfg.DrainPort)

	// The read-only status endpoint is reachable and non-mutating.
	resp, err := http.Get(base + ops.DrainStatusPath)
	if err != nil {
		t.Fatalf("GET drain status: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("drain status = %d, want 200", resp.StatusCode)
	}
	var status ops.DrainStatus
	if err := json.Unmarshal(body, &status); err != nil {
		t.Fatalf("status body is not JSON: %v (%s)", err, body)
	}
	if status.Draining {
		t.Fatal("a freshly started pod reports draining")
	}
	if apirouter.ShutdownGate.Draining() {
		t.Fatal("reading drain status drained the pod")
	}

	// Application surface must NOT be reachable on the drain listener.
	for _, path := range []string{"/api/v1/vehicles", "/healthz", "/metrics"} {
		r, err := http.Get(base + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		r.Body.Close()
		if r.StatusCode != http.StatusNotFound {
			t.Errorf("drain listener served %s with %d; it must expose only the drain plane", path, r.StatusCode)
		}
	}
}

// TestStartDrainListener_RefusesToShareThePublicPort is the structural
// guarantee behind the isolation claim: if the drain port were the
// service port, the pod-fatal endpoint would be published again.
func TestStartDrainListener_RefusesToShareThePublicPort(t *testing.T) {
	a := newDrainApp(t, 18080) // same as Cfg.Port
	if _, err := a.startDrainListener(context.Background()); err == nil {
		t.Fatal("expected a refusal when the drain port equals the public port")
	}
}

func TestStartDrainListener_RefusesPortZero(t *testing.T) {
	a := newDrainApp(t, 0)
	if _, err := a.startDrainListener(context.Background()); err == nil {
		t.Fatal("expected a refusal when the drain port is unset; the preStop hook would be unreachable")
	}
}

// TestDrainListener_ExecutesTheDrain covers the behaviour that was moved
// OFF the smoke path: the drain itself still works, it is just no longer
// something a post-deploy probe can trigger.
func TestDrainListener_ExecutesTheDrain(t *testing.T) {
	apirouter.ShutdownGate = ops.NewReadinessGate()

	gate := apirouter.ShutdownGate
	// Zero propagation delay + injected sleep keeps this deterministic;
	// the real handler sleeps for apirouter.EndpointPropagationDelay.
	mux := ops.NewInternalDrainMux(gate, 18191, 0, func(time.Duration) {})
	srv := &http.Server{Addr: "127.0.0.1:18191", Handler: mux, ReadHeaderTimeout: time.Second}
	ln := mustListen(t, "127.0.0.1:18191")
	go func() { _ = srv.Serve(ln) }()
	defer srv.Close()

	// kubelet issues a GET.
	resp, err := http.Get("http://127.0.0.1:18191" + ops.DrainPath)
	if err != nil {
		t.Fatalf("preStop GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("preStop GET = %d, want 200", resp.StatusCode)
	}
	if !gate.Draining() {
		t.Fatal("the preStop hook did not drain the pod")
	}
}

// ── Shutdown budget (review finding 5) ───────────────────────────────

// TestShutdownBudgetMatchesManifest is the middle leg of the three-way
// lock. The constants below are what the process actually uses; the
// manifest is what the Helm gate sizes terminationGracePeriodSeconds
// against. If they drift, the chart's grace period stops being derived
// from reality.
func TestShutdownBudgetMatchesManifest(t *testing.T) {
	m, err := ops.LoadRolloutManifest(repoFS(t), ops.RolloutManifestPath)
	if err != nil {
		t.Fatalf("load rollout manifest: %v", err)
	}
	s := m.Shutdown

	for _, tc := range []struct {
		field    string
		manifest int
		actual   time.Duration
	}{
		{"prestop_propagation_seconds", s.PreStopPropagationSeconds, apirouter.EndpointPropagationDelay},
		{"telemetry_flush_seconds", s.TelemetryFlushSeconds, TelemetryFlushBudget},
		{"server_drain_seconds", s.ServerDrainSeconds, ServerDrainBudget},
		{"inbound_log_drain_seconds", s.InboundLogDrainSeconds, InboundLogDrainBudget},
		{"drain_listener_seconds", s.DrainListenerSeconds, DrainListenerBudget},
	} {
		if got := int(tc.actual / time.Second); got != tc.manifest {
			t.Errorf("shutdown.%s: manifest says %ds, code uses %ds", tc.field, tc.manifest, got)
		}
	}
}

// TestShutdownBudgetFitsGracePeriod asserts the property the manifest
// exists to protect: the chart's grace period must hold the whole
// shutdown, with headroom. Kubernetes' 30s default could not, which is
// how pods were being SIGKILLed 50s into a drain.
func TestShutdownBudgetFitsGracePeriod(t *testing.T) {
	m, err := ops.LoadRolloutManifest(repoFS(t), ops.RolloutManifestPath)
	if err != nil {
		t.Fatalf("load rollout manifest: %v", err)
	}
	total := m.Shutdown.TotalSeconds()
	required := m.Shutdown.RequiredGracePeriodSeconds()

	if total <= 30 {
		t.Fatalf("the shutdown budget is %ds; if it really fits in the Kubernetes default this test is measuring the wrong thing", total)
	}
	if required <= total {
		t.Fatalf("required grace period %ds must exceed the budget %ds", required, total)
	}

	// Cross-check against the live code rather than the manifest alone.
	codeTotal := int((apirouter.EndpointPropagationDelay +
		TelemetryFlushBudget +
		ServerDrainBudget +
		InboundLogDrainBudget +
		DrainListenerBudget) / time.Second)
	if codeTotal != total {
		t.Fatalf("code budget %ds != manifest budget %ds", codeTotal, total)
	}
}

func mustListen(t *testing.T, addr string) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("listen %s: %v", addr, err)
	}
	return ln
}

// repoFS roots an fs.FS at the repository root so the tests can read the
// committed ops/ manifests.
func repoFS(t *testing.T) fs.FS {
	t.Helper()
	return os.DirFS(filepath.Join("..", ".."))
}
