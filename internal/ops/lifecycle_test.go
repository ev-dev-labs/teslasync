package ops

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// ── ReadinessGate ────────────────────────────────────────────────────

func TestReadinessGate_StartsReadyAndFailsClosedOnDrain(t *testing.T) {
	gate := NewReadinessGate()
	handler := gate.GuardReadiness(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	rec := httptest.NewRecorder()
	handler(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("before drain: status = %d, want 200", rec.Code)
	}

	gate.Drain()

	rec = httptest.NewRecorder()
	handler(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("after drain: status = %d, want 503", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("drain body is not JSON: %v", err)
	}
	if body["status"] != "draining" {
		t.Fatalf("drain body status = %q, want draining", body["status"])
	}
}

func TestReadinessGate_DrainIsIdempotentAndConcurrencySafe(t *testing.T) {
	gate := NewReadinessGate()
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			gate.Drain()
			_ = gate.Draining()
		}()
	}
	wg.Wait()

	if !gate.Draining() {
		t.Fatal("gate should be draining")
	}
	select {
	case <-gate.Drained():
	default:
		t.Fatal("Drained() channel should be closed after Drain()")
	}
}

func TestReadinessGate_ZeroValueIsReady(t *testing.T) {
	var gate ReadinessGate
	if gate.Draining() {
		t.Fatal("zero-value gate must start ready")
	}
	gate.Drain()
	if !gate.Draining() {
		t.Fatal("zero-value gate must be drainable")
	}
}

// ── preStop drain hook ───────────────────────────────────────────────

// TestPreStopFlushHandler_AnswersGET is the regression test for the
// kubelet contract: helm's lifecycle.preStop.httpGet issues a GET, so a
// POST-only route would 405 and the Pod would never drain.
func TestPreStopFlushHandler_AnswersGET(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			gate := NewReadinessGate()
			h := PreStopFlushHandler(gate, 0, nil)

			rec := httptest.NewRecorder()
			h(rec, httptest.NewRequest(method, "/internal/flush", nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not JSON: %v", err)
			}
			if body["status"] != "flushed" {
				t.Fatalf("status = %q, want flushed", body["status"])
			}
			if !gate.Draining() {
				t.Fatal("preStop must flip the readiness gate to draining")
			}
		})
	}
}

func TestPreStopFlushHandler_HoldsForEndpointPropagation(t *testing.T) {
	gate := NewReadinessGate()
	var slept time.Duration
	var drainingWhenSlept bool
	h := PreStopFlushHandler(gate, 7*time.Second, func(d time.Duration) {
		slept = d
		drainingWhenSlept = gate.Draining()
	})

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/internal/flush", nil))

	if slept != 7*time.Second {
		t.Fatalf("propagation delay = %s, want 7s", slept)
	}
	if !drainingWhenSlept {
		t.Fatal("the gate must flip BEFORE the propagation delay, otherwise the delay buys nothing")
	}
}

func TestPreStopFlushHandler_ToleratesNilGate(t *testing.T) {
	rec := httptest.NewRecorder()
	PreStopFlushHandler(nil, 0, nil)(rec, httptest.NewRequest(http.MethodGet, "/internal/flush", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

// ── graceful shutdown / connection draining ──────────────────────────

type fakeServer struct {
	shutdownErr error
	closeErr    error
	closed      bool
	sawDeadline bool
	budget      time.Duration
}

func (f *fakeServer) Shutdown(ctx context.Context) error {
	if dl, ok := ctx.Deadline(); ok {
		f.sawDeadline = true
		f.budget = time.Until(dl)
	}
	return f.shutdownErr
}

func (f *fakeServer) Close() error {
	f.closed = true
	return f.closeErr
}

func TestDrainHTTPServer_GracefulPathDoesNotForceClose(t *testing.T) {
	srv := &fakeServer{}
	if err := DrainHTTPServer(context.Background(), srv, 3*time.Second); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if srv.closed {
		t.Fatal("a successful graceful shutdown must not force-close the listener")
	}
	if !srv.sawDeadline {
		t.Fatal("shutdown must be bounded by the grace budget")
	}
	if srv.budget <= 0 || srv.budget > 3*time.Second {
		t.Fatalf("grace budget = %s, want (0, 3s]", srv.budget)
	}
}

func TestDrainHTTPServer_ForcesCloseWhenGraceExceeded(t *testing.T) {
	srv := &fakeServer{shutdownErr: context.DeadlineExceeded}
	err := DrainHTTPServer(context.Background(), srv, time.Second)
	if err == nil {
		t.Fatal("expected an error when the grace budget is exceeded")
	}
	if !srv.closed {
		t.Fatal("a timed-out shutdown must force-close so the listener never leaks")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error should wrap the shutdown cause, got %v", err)
	}
}

func TestDrainHTTPServer_NilServerIsANoOp(t *testing.T) {
	if err := DrainHTTPServer(context.Background(), nil, time.Second); err != nil {
		t.Fatalf("nil server should be a no-op, got %v", err)
	}
}

// TestDrainHTTPServer_LetsInFlightRequestFinish exercises a real
// http.Server: a request that is mid-flight when shutdown starts must
// still complete, and the listener must stop accepting new ones.
func TestDrainHTTPServer_LetsInFlightRequestFinish(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("done"))
	}))
	defer srv.Close()

	type result struct {
		status int
		err    error
	}
	resCh := make(chan result, 1)
	go func() {
		resp, err := http.Get(srv.URL)
		if err != nil {
			resCh <- result{err: err}
			return
		}
		defer resp.Body.Close()
		resCh <- result{status: resp.StatusCode}
	}()

	<-started
	drainDone := make(chan error, 1)
	go func() { drainDone <- DrainHTTPServer(context.Background(), srv.Config, 5*time.Second) }()

	close(release)

	select {
	case r := <-resCh:
		if r.err != nil {
			t.Fatalf("in-flight request failed during drain: %v", r.err)
		}
		if r.status != http.StatusOK {
			t.Fatalf("in-flight request status = %d, want 200", r.status)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("in-flight request never completed")
	}

	select {
	case err := <-drainDone:
		if err != nil {
			t.Fatalf("drain returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("drain never returned")
	}
}

// ── worker lease ─────────────────────────────────────────────────────

func TestLease_Validate(t *testing.T) {
	base := func() *Lease {
		return &Lease{Name: "trip-generator", Owner: "pod-a", TTL: 30 * time.Second, RenewInterval: 10 * time.Second, Store: NewMemoryLeaseStore()}
	}
	tests := []struct {
		name    string
		mutate  func(*Lease)
		wantErr bool
	}{
		{"valid", func(*Lease) {}, false},
		{"nil store", func(l *Lease) { l.Store = nil }, true},
		{"missing name", func(l *Lease) { l.Name = "" }, true},
		{"missing owner", func(l *Lease) { l.Owner = "" }, true},
		{"zero ttl", func(l *Lease) { l.TTL = 0 }, true},
		{"zero renew", func(l *Lease) { l.RenewInterval = 0 }, true},
		{"renew too close to ttl", func(l *Lease) { l.RenewInterval = 20 * time.Second }, true},
		{"renew exactly one third", func(l *Lease) { l.RenewInterval = 10 * time.Second }, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := base()
			tt.mutate(l)
			err := l.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() error = %v, wantErr = %v", err, tt.wantErr)
			}
		})
	}
}

func TestLease_SecondOwnerIsRefusedWhileHeld(t *testing.T) {
	store := NewMemoryLeaseStore()
	ok, err := store.Acquire(context.Background(), "notification-worker", "pod-a", time.Minute)
	if err != nil || !ok {
		t.Fatalf("first acquire: ok=%v err=%v", ok, err)
	}

	second := &Lease{Name: "notification-worker", Owner: "pod-b", TTL: time.Minute, RenewInterval: 10 * time.Second, Store: store}
	err = second.Run(context.Background(), func(context.Context) error {
		t.Fatal("work must not run without the lease")
		return nil
	})
	if !errors.Is(err, ErrLeaseNotAcquired) {
		t.Fatalf("second owner error = %v, want ErrLeaseNotAcquired", err)
	}
}

func TestLease_ExpiredLeaseIsReclaimable(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	store := NewMemoryLeaseStore()
	store.Now = func() time.Time { return now }

	if ok, err := store.Acquire(context.Background(), "export-worker", "pod-a", 30*time.Second); err != nil || !ok {
		t.Fatalf("initial acquire: ok=%v err=%v", ok, err)
	}
	// pod-a dies without releasing; the clock moves past the TTL.
	now = now.Add(31 * time.Second)

	ok, err := store.Acquire(context.Background(), "export-worker", "pod-b", 30*time.Second)
	if err != nil || !ok {
		t.Fatalf("expired lease was not reclaimable: ok=%v err=%v", ok, err)
	}
	if ok, _ := store.Renew(context.Background(), "export-worker", "pod-a", 30*time.Second); ok {
		t.Fatal("the evicted owner must not be able to renew")
	}
}

func TestLease_RunReleasesOnCompletion(t *testing.T) {
	store := NewMemoryLeaseStore()
	l := &Lease{Name: "automation-worker", Owner: "pod-a", TTL: time.Minute, RenewInterval: 10 * time.Second, Store: store}

	ran := false
	if err := l.Run(context.Background(), func(context.Context) error {
		ran = true
		return nil
	}); err != nil {
		t.Fatalf("Run() = %v", err)
	}
	if !ran {
		t.Fatal("work never ran")
	}
	// A different owner must be able to take the lease immediately.
	if ok, err := store.Acquire(context.Background(), "automation-worker", "pod-b", time.Minute); err != nil || !ok {
		t.Fatalf("lease was not released: ok=%v err=%v", ok, err)
	}
}

func TestLease_WorkContextIsCancelledWhenLeaseIsLost(t *testing.T) {
	store := NewMemoryLeaseStore()
	l := &Lease{
		Name:          "trip-generator",
		Owner:         "pod-a",
		TTL:           30 * time.Millisecond,
		RenewInterval: 5 * time.Millisecond,
		Store:         store,
	}

	err := l.Run(context.Background(), func(ctx context.Context) error {
		// Simulate the lease being stolen after acquisition (e.g. this
		// pod paused long enough for the row to expire).
		_ = store.Release(context.Background(), "trip-generator", "pod-a")
		if ok, aerr := store.Acquire(context.Background(), "trip-generator", "pod-b", time.Minute); aerr != nil || !ok {
			t.Errorf("steal failed: ok=%v err=%v", ok, aerr)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(2 * time.Second):
			return errors.New("work context was never cancelled after the lease was lost")
		}
	})
	if err != nil && !errors.Is(err, ErrLeaseNotAcquired) {
		t.Fatalf("Run() = %v, want nil or ErrLeaseNotAcquired", err)
	}
}

func TestLease_PropagatesWorkError(t *testing.T) {
	sentinel := errors.New("boom")
	l := &Lease{Name: "n", Owner: "o", TTL: time.Minute, RenewInterval: time.Second, Store: NewMemoryLeaseStore()}
	if err := l.Run(context.Background(), func(context.Context) error { return sentinel }); !errors.Is(err, sentinel) {
		t.Fatalf("Run() = %v, want %v", err, sentinel)
	}
}
