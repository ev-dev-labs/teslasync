package ops

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ── Drain plane isolation (OPS-09, review finding 2) ─────────────────

// TestNewInternalDrainMux_ServesOnlyTheDrainPlane pins the blast radius
// of the isolated listener: it must expose the drain endpoint and its
// read-only status, and nothing else. If someone later mounts the app
// router on this port, this fails.
func TestNewInternalDrainMux_ServesOnlyTheDrainPlane(t *testing.T) {
	gate := NewReadinessGate()
	mux := NewInternalDrainMux(gate, 8090, 0, func(time.Duration) {})

	for _, tc := range []struct {
		path string
		want int
	}{
		{DrainPath, http.StatusOK},
		{DrainStatusPath, http.StatusOK},
		{"/api/v1/vehicles", http.StatusNotFound},
		{"/healthz", http.StatusNotFound},
		{"/metrics", http.StatusNotFound},
		{"/", http.StatusNotFound},
	} {
		t.Run(tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != tc.want {
				t.Fatalf("GET %s = %d, want %d", tc.path, rec.Code, tc.want)
			}
		})
	}
}

func TestNewInternalDrainMux_RejectsUnsafeMethods(t *testing.T) {
	mux := NewInternalDrainMux(NewReadinessGate(), 8090, 0, func(time.Duration) {})
	for _, method := range []string{http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, DrainPath, nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s = %d, want 405", method, DrainPath, rec.Code)
		}
	}
}

// TestDrainStatusHandler_IsNonMutating is the core of review finding 1:
// the endpoint a smoke gate probes must never change pod state.
func TestDrainStatusHandler_IsNonMutating(t *testing.T) {
	gate := NewReadinessGate()
	h := DrainStatusHandler(gate, 8090, 5*time.Second)

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		start := time.Now()
		h(rec, httptest.NewRequest(http.MethodGet, DrainStatusPath, nil))
		elapsed := time.Since(start)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if gate.Draining() {
			t.Fatal("the drain-status probe drained the pod; it must be read-only")
		}
		// The mutating endpoint deliberately sleeps for the propagation
		// delay. The status probe must not, or it would blow a smoke
		// gate's latency budget on every call.
		if elapsed > time.Second {
			t.Fatalf("status probe took %s; it must not sleep for the propagation delay", elapsed)
		}

		var body DrainStatus
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("body is not JSON: %v", err)
		}
		if body.Draining {
			t.Fatal("draining reported true on a healthy pod")
		}
		if body.DrainEndpoint != DrainPath || body.InternalPort != 8090 {
			t.Fatalf("drain contract not advertised: %+v", body)
		}
		if body.PropagationDelaySeconds != 5 {
			t.Fatalf("propagation delay = %d, want 5", body.PropagationDelaySeconds)
		}
	}
}

func TestDrainStatusHandler_ReflectsDrainState(t *testing.T) {
	gate := NewReadinessGate()
	h := DrainStatusHandler(gate, 8090, 5*time.Second)
	gate.Drain()

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, DrainStatusPath, nil))

	var body DrainStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if !body.Draining {
		t.Fatal("a draining pod must report draining: true")
	}
}

// TestDrainPathAndStatusPathDiffer guards against someone collapsing the
// two back into one endpoint.
func TestDrainPathAndStatusPathDiffer(t *testing.T) {
	if DrainPath == DrainStatusPath {
		t.Fatal("the mutating drain path and the read-only status path must be distinct")
	}
}

// ── Smoke manifest may never probe the drain endpoint ────────────────

func TestValidateSmoke_RejectsProbingTheDrainEndpoint(t *testing.T) {
	body := `
version: 1
defaults:
  timeout: 10s
  max_latency: 5s
  expect_status: [200]
auth:
  mode: forward_auth_header
  header: X-Forwarded-User
  value_env: SMOKE_USER
checks:
  - id: liveness
    description: alive
    path: /healthz
    critical: true
    tags: [availability, recovery, observability, frontend]
  - id: api
    description: authenticated read
    path: /api/v1/vehicles
    authenticated: true
    critical: true
    tags: [availability]
  - id: prestop-drain-hook
    description: drains the pod we just deployed
    path: ` + DrainPath + `
    critical: true
    tags: [recovery]
`
	findings := ValidateSmoke(loadSmokeFromString(t, body))
	if !hasMessage(findings, "must never be probed by the smoke gate") {
		t.Fatalf("a mutating drain probe was accepted: %+v", findings)
	}
	if !hasMessage(findings, "one-way and pod-fatal") {
		t.Fatalf("the failure message does not explain why: %+v", findings)
	}
}

func TestValidateSmoke_RejectsUnsafeMethods(t *testing.T) {
	body := `
version: 1
defaults:
  timeout: 10s
  max_latency: 5s
  expect_status: [200]
auth:
  mode: forward_auth_header
  header: X-Forwarded-User
  value_env: SMOKE_USER
checks:
  - id: liveness
    description: alive
    path: /healthz
    critical: true
    tags: [availability, recovery, observability, frontend]
  - id: mutate
    description: posts something
    method: POST
    path: /api/v1/exports
    authenticated: true
    critical: true
    tags: [availability]
`
	findings := ValidateSmoke(loadSmokeFromString(t, body))
	if !hasMessage(findings, "not a safe method") {
		t.Fatalf("a POST smoke check was accepted: %+v", findings)
	}
}

// TestRealSmokeManifestIsNonMutating asserts the property against the
// committed manifest, not just a fixture.
func TestRealSmokeManifestIsNonMutating(t *testing.T) {
	m, err := LoadSmokeManifest(repoFSForTest(t), SmokeManifestPath)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	sawDrainStatus := false
	for _, c := range m.Checks {
		if c.Method != http.MethodGet && c.Method != http.MethodHead {
			t.Errorf("check %q uses unsafe method %s", c.ID, c.Method)
		}
		if c.Path == DrainPath {
			t.Errorf("check %q probes the pod-fatal drain endpoint", c.ID)
		}
		if c.Path == DrainStatusPath {
			sawDrainStatus = true
		}
	}
	if !sawDrainStatus {
		t.Errorf("the smoke manifest no longer asserts the drain contract via %s", DrainStatusPath)
	}
}
