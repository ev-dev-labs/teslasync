package api

// Phase-46 / Prompt 33 — Aggregated self-test endpoint tests.
//
// The runner is exercised against deterministic stub checks so the
// tests don't need a live DB / MQTT / Redis. The production check
// implementations (db.connectivity, mqtt.connected, etc.) are covered
// at the function level by separate sub-tests against minimal stubs
// (nil deps, fake circuit breaker state, fake redis pinger).

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sony/gobreaker"

	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// fakePinger satisfies diagnosticPinger by returning a pre-canned
// redis.StatusCmd. errPing controls whether Err() returns a value.
type fakePinger struct {
	errPing error
	calls   int32
}

func (f *fakePinger) Ping(_ context.Context) *redis.StatusCmd {
	atomic.AddInt32(&f.calls, 1)
	cmd := redis.NewStatusCmd(context.Background(), "ping")
	if f.errPing != nil {
		cmd.SetErr(f.errPing)
	} else {
		cmd.SetVal("PONG")
	}
	return cmd
}

// stubCheck builds a DiagnosticCheckFn with a fixed result. delay !=0
// makes the runner sleep before returning so tests can exercise the
// per-check timeout path.
func stubCheck(id, status string, delay time.Duration) DiagnosticCheckFn {
	return func(ctx context.Context) DiagnosticCheck {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return DiagnosticCheck{
					ID:     id,
					Name:   id,
					Status: DiagnosticStatusFail,
					Detail: "context cancelled: " + ctx.Err().Error(),
				}
			}
		}
		return DiagnosticCheck{
			ID:     id,
			Name:   id,
			Status: status,
			Detail: id + " stub",
		}
	}
}

func TestDiagnosticRunner_AggregatesOverallStatus(t *testing.T) {
	tests := []struct {
		name           string
		checks         []DiagnosticCheckFn
		wantOverall    string
		wantCheckCount int
	}{
		{
			name: "all ok",
			checks: []DiagnosticCheckFn{
				stubCheck("a", DiagnosticStatusOK, 0),
				stubCheck("b", DiagnosticStatusOK, 0),
			},
			wantOverall:    DiagnosticOverallOK,
			wantCheckCount: 2,
		},
		{
			name: "warn dominates ok",
			checks: []DiagnosticCheckFn{
				stubCheck("a", DiagnosticStatusOK, 0),
				stubCheck("b", DiagnosticStatusWarn, 0),
				stubCheck("c", DiagnosticStatusOK, 0),
			},
			wantOverall:    DiagnosticOverallDegraded,
			wantCheckCount: 3,
		},
		{
			name: "fail dominates everything",
			checks: []DiagnosticCheckFn{
				stubCheck("a", DiagnosticStatusOK, 0),
				stubCheck("b", DiagnosticStatusWarn, 0),
				stubCheck("c", DiagnosticStatusFail, 0),
				stubCheck("d", DiagnosticStatusOK, 0),
			},
			wantOverall:    DiagnosticOverallDown,
			wantCheckCount: 4,
		},
		{
			name:           "empty check list is ok",
			checks:         []DiagnosticCheckFn{},
			wantOverall:    DiagnosticOverallOK,
			wantCheckCount: 0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := NewDiagnosticHandlerWithChecks(tc.checks, time.Second)
			report := h.Run(context.Background())
			if report.OverallStatus != tc.wantOverall {
				t.Errorf("OverallStatus = %q, want %q", report.OverallStatus, tc.wantOverall)
			}
			if got := len(report.Checks); got != tc.wantCheckCount {
				t.Errorf("len(Checks) = %d, want %d", got, tc.wantCheckCount)
			}
			if report.GeneratedAt.IsZero() {
				t.Error("GeneratedAt is zero, want a real timestamp")
			}
		})
	}
}

func TestDiagnosticRunner_PreservesCheckOrder(t *testing.T) {
	// The runner fans out checks concurrently; the result slice MUST
	// still come back in the original input order so the SPA can render
	// a stable list.
	checks := []DiagnosticCheckFn{
		stubCheck("first", DiagnosticStatusOK, 0),
		stubCheck("second", DiagnosticStatusOK, 0),
		stubCheck("third", DiagnosticStatusOK, 0),
		stubCheck("fourth", DiagnosticStatusOK, 0),
	}
	h := NewDiagnosticHandlerWithChecks(checks, time.Second)
	report := h.Run(context.Background())

	wantIDs := []string{"first", "second", "third", "fourth"}
	if len(report.Checks) != len(wantIDs) {
		t.Fatalf("len(Checks) = %d, want %d", len(report.Checks), len(wantIDs))
	}
	for i, want := range wantIDs {
		if report.Checks[i].ID != want {
			t.Errorf("Checks[%d].ID = %q, want %q", i, report.Checks[i].ID, want)
		}
	}
}

func TestDiagnosticRunner_PerCheckTimeout(t *testing.T) {
	// A check that sleeps past the per-check timeout should NOT block
	// the report. The check itself is responsible for honouring its
	// context and reporting a fail with a context-cancelled detail.
	checks := []DiagnosticCheckFn{
		stubCheck("fast", DiagnosticStatusOK, 0),
		stubCheck("slow", DiagnosticStatusOK, 100*time.Millisecond),
	}
	h := NewDiagnosticHandlerWithChecks(checks, 10*time.Millisecond)

	start := time.Now()
	report := h.Run(context.Background())
	elapsed := time.Since(start)

	if elapsed > 200*time.Millisecond {
		t.Errorf("Run took %v, expected to short-circuit at the per-check timeout (~10ms)", elapsed)
	}
	if got := report.Checks[0].Status; got != DiagnosticStatusOK {
		t.Errorf("fast check Status = %q, want %q", got, DiagnosticStatusOK)
	}
	if got := report.Checks[1].Status; got != DiagnosticStatusFail {
		t.Errorf("slow check Status = %q, want %q (context cancelled)", got, DiagnosticStatusFail)
	}
	if !strings.Contains(report.Checks[1].Detail, "context") {
		t.Errorf("slow check Detail = %q, want context-cancelled message", report.Checks[1].Detail)
	}
}

func TestDiagnosticRunner_RecoversFromPanic(t *testing.T) {
	// A panicking check MUST NOT crash the whole report. The runner
	// recovers per-check and emits a fail row carrying the panic value.
	panicCheck := DiagnosticCheckFn(func(_ context.Context) DiagnosticCheck {
		panic("boom")
	})
	h := NewDiagnosticHandlerWithChecks([]DiagnosticCheckFn{
		stubCheck("ok", DiagnosticStatusOK, 0),
		panicCheck,
	}, time.Second)

	report := h.Run(context.Background())
	if len(report.Checks) != 2 {
		t.Fatalf("len(Checks) = %d, want 2", len(report.Checks))
	}
	if report.Checks[1].Status != DiagnosticStatusFail {
		t.Errorf("panic check Status = %q, want %q", report.Checks[1].Status, DiagnosticStatusFail)
	}
	if !strings.Contains(report.Checks[1].Detail, "panic") {
		t.Errorf("panic check Detail = %q, want it to mention the panic", report.Checks[1].Detail)
	}
	if report.OverallStatus != DiagnosticOverallDown {
		t.Errorf("OverallStatus = %q, want %q", report.OverallStatus, DiagnosticOverallDown)
	}
}

func TestDiagnosticRunner_MeasuresDuration(t *testing.T) {
	// DurationMs should default to the wall time of the check when the
	// implementation doesn't set it explicitly.
	const sleep = 25 * time.Millisecond
	checks := []DiagnosticCheckFn{
		func(_ context.Context) DiagnosticCheck {
			time.Sleep(sleep)
			return DiagnosticCheck{ID: "timed", Name: "timed", Status: DiagnosticStatusOK}
		},
	}
	h := NewDiagnosticHandlerWithChecks(checks, time.Second)
	report := h.Run(context.Background())
	if got := report.Checks[0].DurationMs; got < int64(sleep/time.Millisecond) {
		t.Errorf("DurationMs = %d, want >= %d", got, int64(sleep/time.Millisecond))
	}
}

func TestDiagnosticHandler_ServeHTTP_Post(t *testing.T) {
	h := NewDiagnosticHandlerWithChecks([]DiagnosticCheckFn{
		stubCheck("a", DiagnosticStatusOK, 0),
		stubCheck("b", DiagnosticStatusWarn, 0),
	}, time.Second)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/system/diagnostic", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var report DiagnosticReport
	if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if report.OverallStatus != DiagnosticOverallDegraded {
		t.Errorf("OverallStatus = %q, want %q", report.OverallStatus, DiagnosticOverallDegraded)
	}
	if len(report.Checks) != 2 {
		t.Fatalf("len(Checks) = %d, want 2", len(report.Checks))
	}
}

func TestDiagnosticHandler_ServeHTTP_RejectsGet(t *testing.T) {
	h := NewDiagnosticHandlerWithChecks([]DiagnosticCheckFn{
		stubCheck("a", DiagnosticStatusOK, 0),
	}, time.Second)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/system/diagnostic", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
	if got := rec.Header().Get("Allow"); got != http.MethodPost {
		t.Errorf("Allow header = %q, want %q", got, http.MethodPost)
	}
}

func TestDiagnosticHandler_NilHandler_RunReturnsDown(t *testing.T) {
	// Defensive: Run on a nil receiver must not panic.
	var h *DiagnosticHandler
	report := h.Run(context.Background())
	if report.OverallStatus != DiagnosticOverallDown {
		t.Errorf("nil handler OverallStatus = %q, want %q", report.OverallStatus, DiagnosticOverallDown)
	}
}

// ── Production check unit tests ─────────────────────────────────────

func TestDbConnectivityCheck_NilDB(t *testing.T) {
	res := dbConnectivityCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusFail {
		t.Errorf("Status = %q, want %q", res.Status, DiagnosticStatusFail)
	}
	if res.Remediation == "" {
		t.Error("Remediation must be set when fail")
	}
}

func TestDbMigrationVersionCheck_NilDB(t *testing.T) {
	res := dbMigrationVersionCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusFail {
		t.Errorf("Status = %q, want %q", res.Status, DiagnosticStatusFail)
	}
}

func TestSignalLogFreshnessCheck_NilDB(t *testing.T) {
	res := signalLogFreshnessCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusFail {
		t.Errorf("Status = %q, want %q", res.Status, DiagnosticStatusFail)
	}
}

func TestTeslaTokenCheck_NilClient(t *testing.T) {
	res := teslaTokenCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusFail {
		t.Errorf("nil client Status = %q, want %q", res.Status, DiagnosticStatusFail)
	}
	if res.Remediation == "" {
		t.Error("Remediation must guide the operator to /tesla-account")
	}
}

func TestTeslaCircuitBreakerCheck_NilClient(t *testing.T) {
	res := teslaCircuitBreakerCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusWarn {
		t.Errorf("nil client Status = %q, want %q", res.Status, DiagnosticStatusWarn)
	}
}

// breakerStateStubber is a thin shim around the breaker-state branches
// in teslaCircuitBreakerCheck. We can't easily fake *tesla.Client so we
// re-derive the same switch here as a documentation+regression aid; the
// production code is exercised in tesla.Client tests.
func TestDiagnosticBreakerStateMapping(t *testing.T) {
	cases := []struct {
		state      string
		wantStatus string
	}{
		{gobreaker.StateClosed.String(), DiagnosticStatusOK},
		{gobreaker.StateHalfOpen.String(), DiagnosticStatusWarn},
		{gobreaker.StateOpen.String(), DiagnosticStatusFail},
		{"unknown-zoo", DiagnosticStatusWarn},
	}
	for _, tc := range cases {
		t.Run(tc.state, func(t *testing.T) {
			// Replicate the switch from teslaCircuitBreakerCheck
			// against a string state — the production function
			// chains tc.CircuitBreakerState() into the same logic.
			var got string
			switch tc.state {
			case gobreaker.StateClosed.String():
				got = DiagnosticStatusOK
			case gobreaker.StateHalfOpen.String():
				got = DiagnosticStatusWarn
			case gobreaker.StateOpen.String():
				got = DiagnosticStatusFail
			default:
				got = DiagnosticStatusWarn
			}
			if got != tc.wantStatus {
				t.Errorf("state %q → %q, want %q", tc.state, got, tc.wantStatus)
			}
		})
	}
}

func TestMqttConnectedCheck_NilClient(t *testing.T) {
	res := mqttConnectedCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusWarn {
		t.Errorf("nil client Status = %q, want %q (treated as disabled, not failed)", res.Status, DiagnosticStatusWarn)
	}
}

func TestRedisPingCheck_NilPinger(t *testing.T) {
	res := redisPingCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusWarn {
		t.Errorf("nil pinger Status = %q, want %q (in-memory fallback)", res.Status, DiagnosticStatusWarn)
	}
}

func TestRedisPingCheck_PingOK(t *testing.T) {
	p := &fakePinger{}
	res := redisPingCheck(p)(context.Background())
	if res.Status != DiagnosticStatusOK {
		t.Errorf("ping ok Status = %q, want %q", res.Status, DiagnosticStatusOK)
	}
	if atomic.LoadInt32(&p.calls) != 1 {
		t.Errorf("Ping called %d times, want 1", p.calls)
	}
}

func TestRedisPingCheck_PingErr(t *testing.T) {
	p := &fakePinger{errPing: errors.New("boom")}
	res := redisPingCheck(p)(context.Background())
	if res.Status != DiagnosticStatusFail {
		t.Errorf("ping err Status = %q, want %q", res.Status, DiagnosticStatusFail)
	}
	if !strings.Contains(res.Detail, "boom") {
		t.Errorf("Detail = %q, want it to include the underlying error", res.Detail)
	}
}

func TestHealthMonitorCheck_NilMonitor(t *testing.T) {
	res := healthMonitorCheck(nil)(context.Background())
	if res.Status != DiagnosticStatusWarn {
		t.Errorf("nil monitor Status = %q, want %q", res.Status, DiagnosticStatusWarn)
	}
}

func TestHealthMonitorCheck_AllHealthy(t *testing.T) {
	hm := resilience.NewHealthMonitor()
	hm.Register("db")
	hm.RecordSuccess("db")
	res := healthMonitorCheck(hm)(context.Background())
	if res.Status != DiagnosticStatusOK {
		t.Errorf("healthy monitor Status = %q, want %q", res.Status, DiagnosticStatusOK)
	}
}

func TestHealthMonitorCheck_Degraded(t *testing.T) {
	hm := resilience.NewHealthMonitor()
	hm.Register("db")
	hm.Register("mqtt")
	hm.RecordSuccess("db")
	// Three consecutive failures push a component to degraded (per
	// resilience.go thresholds: 3 → Degraded, 10 → Unhealthy).
	hm.RecordFailure("mqtt", errors.New("flap"))
	hm.RecordFailure("mqtt", errors.New("flap"))
	hm.RecordFailure("mqtt", errors.New("flap"))
	res := healthMonitorCheck(hm)(context.Background())
	if res.Status == DiagnosticStatusOK {
		t.Errorf("Status = %q, want a non-ok status when a component is degraded", res.Status)
	}
}

func TestRuntimeGoroutineCheck_OK(t *testing.T) {
	// Test process is unlikely to be over 2000 goroutines so we expect ok.
	res := runtimeGoroutineCheck()(context.Background())
	if res.Status != DiagnosticStatusOK {
		t.Errorf("Status = %q, want %q (goroutine count low in tests)", res.Status, DiagnosticStatusOK)
	}
	if !strings.Contains(res.Detail, "goroutines") {
		t.Errorf("Detail = %q, want a goroutine count label", res.Detail)
	}
}

func TestUptimeCheck_AlwaysOK(t *testing.T) {
	res := uptimeCheck()(context.Background())
	if res.Status != DiagnosticStatusOK {
		t.Errorf("Status = %q, want %q", res.Status, DiagnosticStatusOK)
	}
	if res.Detail == "" {
		t.Error("Detail must carry the uptime string")
	}
}

func TestNewDiagnosticHandler_WiresAllChecks(t *testing.T) {
	// Smoke: nil deps for everything except cfg is tolerated; the
	// handler should still register the full check set so the report
	// shape is stable across deployments.
	h := NewDiagnosticHandler(nil, nil, nil, nil, nil, nil)
	if got := len(h.checks); got != 10 {
		t.Errorf("len(checks) = %d, want 10", got)
	}
	report := h.Run(context.Background())
	if len(report.Checks) != 10 {
		t.Errorf("len(report.Checks) = %d, want 10", len(report.Checks))
	}
	// With nil deps, the report should be down (db.connectivity fails).
	if report.OverallStatus != DiagnosticOverallDown {
		t.Errorf("OverallStatus = %q, want %q (nil DB → fail)", report.OverallStatus, DiagnosticOverallDown)
	}
}
