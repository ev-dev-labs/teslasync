package ops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// ── OPS-09: readiness, draining, graceful shutdown, worker leases ────
//
// Kubernetes removes a Pod from Service endpoints asynchronously. Between
// the moment the kubelet sends SIGTERM and the moment kube-proxy stops
// routing to the Pod, requests keep arriving. If /readyz still answers
// 200 during that window the Pod advertises itself as healthy while it
// is tearing down, and in-flight requests are dropped.
//
// ReadinessGate closes that window: the preStop hook flips the gate to
// draining, /readyz starts returning 503 immediately, the endpoint
// controller de-registers the Pod, and only then does the HTTP server
// begin its graceful shutdown.

// ReadinessGate is a concurrency-safe ready/draining flag.
//
// The zero value is ready.
type ReadinessGate struct {
	draining atomic.Bool
	// drained is closed the first time Drain is called, so tests and
	// shutdown code can wait for the transition without polling.
	once    sync.Once
	drained chan struct{}
	initial sync.Once

	// mu guards drainedAt, which the liveness watchdog reads to detect a
	// pod that drained but was never terminated.
	mu        sync.Mutex
	drainedAt time.Time
	// Now is injectable for deterministic tests.
	Now func() time.Time
}

// NewReadinessGate returns a gate in the ready state.
func NewReadinessGate() *ReadinessGate {
	g := &ReadinessGate{}
	g.ensure()
	return g
}

func (g *ReadinessGate) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

func (g *ReadinessGate) ensure() {
	g.initial.Do(func() {
		if g.drained == nil {
			g.drained = make(chan struct{})
		}
	})
}

// Drain marks the process as no longer accepting new traffic. It is
// idempotent and safe to call from multiple goroutines.
func (g *ReadinessGate) Drain() {
	g.ensure()
	g.once.Do(func() {
		g.mu.Lock()
		g.drainedAt = g.now()
		g.mu.Unlock()
		g.draining.Store(true)
		close(g.drained)
	})
}

// Draining reports whether Drain has been called.
func (g *ReadinessGate) Draining() bool { return g.draining.Load() }

// Drained returns a channel closed on the first Drain call.
func (g *ReadinessGate) Drained() <-chan struct{} {
	g.ensure()
	return g.drained
}

// DrainedAt returns the time Drain was first called, and false if the
// gate is still ready.
func (g *ReadinessGate) DrainedAt() (time.Time, bool) {
	if !g.Draining() {
		return time.Time{}, false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.drainedAt, true
}

// GuardLiveness wraps a LIVENESS handler so that a pod which has been
// draining longer than budget starts failing its liveness probe.
//
// The drain latch is deliberately one-way — that is what makes
// termination deterministic. But it also means an accidental drain (a
// stray preStop invocation, an operator curl, a bug) leaves the pod
// permanently unready, serving nothing, and *alive*: readiness says
// "never send me traffic" and liveness says "I'm fine", so nothing ever
// restarts it. The pod becomes a silent hole in capacity.
//
// Failing liveness after the full shutdown budget has elapsed closes
// that hole. During a real termination the container is long gone before
// the budget expires, so intentional shutdown semantics are untouched;
// only a drained-but-not-terminating pod ever reaches this branch, and
// for that pod a kubelet restart is exactly the right answer.
func (g *ReadinessGate) GuardLiveness(budget time.Duration, now func() time.Time) func(http.HandlerFunc) http.HandlerFunc {
	if now == nil {
		now = time.Now
	}
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if at, draining := g.DrainedAt(); draining && budget > 0 {
				if age := now().Sub(at); age > budget {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusServiceUnavailable)
					_ = json.NewEncoder(w).Encode(map[string]any{
						"status":         "drain-stuck",
						"draining_for_s": int(age / time.Second),
						"budget_s":       int(budget / time.Second),
						"remediation":    "pod drained but was never terminated; failing liveness so the kubelet restarts it",
					})
					return
				}
			}
			next(w, r)
		}
	}
}

// GuardReadiness wraps a readiness handler so that once the gate is
// draining the response is an unconditional 503, regardless of what the
// underlying dependency checks would have said.
func (g *ReadinessGate) GuardReadiness(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if g.Draining() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "draining"})
			return
		}
		next(w, r)
	}
}

// PreStopFlushHandler returns the handler mounted at /internal/flush on
// the ISOLATED internal listener (see internal/app/drain.go).
//
// It MUST answer GET: a Kubernetes `lifecycle.preStop.httpGet` probe
// issues a GET, so a POST-only route silently 405s and the drain never
// happens. It also answers POST so operators can curl it by hand.
//
// SECURITY: this handler is one-way and pod-fatal — it takes the pod out
// of Service endpoints permanently and releases every SSE stream. It
// must therefore never be mounted on the public router. Kubelet reaches
// it by dialling the pod IP on a port that no Service or Ingress
// targets; see helm/teslasync/templates/deployment.yaml and the
// selector/exposure assertions in .github/workflows/ops-gate.yml.
//
// propagationDelay holds the response open long enough for the endpoint
// controller to observe the now-failing readiness probe and de-register
// the Pod before the container is signalled. sleep is injected so tests
// stay deterministic.
func PreStopFlushHandler(gate *ReadinessGate, propagationDelay time.Duration, sleep func(time.Duration)) http.HandlerFunc {
	if sleep == nil {
		sleep = time.Sleep
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if gate != nil {
			gate.Drain()
		}
		if propagationDelay > 0 {
			sleep(propagationDelay)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "flushed"})
	}
}

// DrainStatus is the body returned by [DrainStatusHandler].
type DrainStatus struct {
	// Draining reports whether the preStop hook has fired.
	Draining bool `json:"draining"`
	// DrainEndpoint names the path that performs the drain, and
	// InternalPort the isolated listener it lives on, so an operator (or
	// a smoke gate) can assert the contract without invoking it.
	DrainEndpoint string `json:"drain_endpoint"`
	InternalPort  int    `json:"internal_port"`
	// PropagationDelaySeconds is how long the preStop hook holds its
	// response open after flipping the gate.
	PropagationDelaySeconds int `json:"propagation_delay_seconds"`
}

// DrainStatusHandler returns a READ-ONLY view of the drain contract.
//
// This is what a post-deploy smoke gate is allowed to probe. Probing the
// drain endpoint itself would take the pod it just deployed out of
// service — the check would kill the thing it was verifying, and then
// fail on its own latency budget while the preStop delay elapsed.
func DrainStatusHandler(gate *ReadinessGate, internalPort int, propagationDelay time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := DrainStatus{
			DrainEndpoint:           DrainPath,
			InternalPort:            internalPort,
			PropagationDelaySeconds: int(propagationDelay / time.Second),
		}
		if gate != nil {
			status.Draining = gate.Draining()
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(status)
	}
}

// Drain-plane paths. DrainPath is served ONLY on the isolated internal
// listener; DrainStatusPath is safe to serve publicly.
const (
	DrainPath       = "/internal/flush"
	DrainStatusPath = "/internal/drain-status"
)

// NewInternalDrainMux builds the isolated drain listener's handler. It
// serves exactly two routes and nothing else, so binding it to a
// dedicated port cannot accidentally expose application surface.
func NewInternalDrainMux(gate *ReadinessGate, internalPort int, propagationDelay time.Duration, sleep func(time.Duration)) *http.ServeMux {
	mux := http.NewServeMux()
	flush := PreStopFlushHandler(gate, propagationDelay, sleep)
	mux.HandleFunc(DrainPath, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodPost:
			flush(w, r)
		default:
			w.Header().Set("Allow", "GET, POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc(DrainStatusPath, DrainStatusHandler(gate, internalPort, propagationDelay))
	return mux
}

// httpServer is the narrow surface DrainHTTPServer needs, so tests can
// exercise the timeout branch without racing a real listener.
type httpServer interface {
	Shutdown(ctx context.Context) error
	Close() error
}

// DrainHTTPServer performs a bounded graceful shutdown: it stops
// accepting new connections and waits up to grace for in-flight requests
// to finish, then force-closes whatever is left.
//
// It returns the Shutdown error (so callers can log it) but always
// force-closes on timeout, because leaving a listener open after the
// grace budget defeats the point of a bounded shutdown.
func DrainHTTPServer(ctx context.Context, srv httpServer, grace time.Duration) error {
	if srv == nil {
		return nil
	}
	shutdownCtx, cancel := context.WithTimeout(ctx, grace)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		closeErr := srv.Close()
		if closeErr != nil {
			return fmt.Errorf("graceful shutdown failed (%w) and force close failed: %w", err, closeErr)
		}
		return fmt.Errorf("graceful shutdown exceeded %s budget, forced close: %w", grace, err)
	}
	return nil
}

// ── Worker lease ─────────────────────────────────────────────────────
//
// Several TeslaSync workers are single-writer by construction: two
// notification workers consuming the same MQTT subscription would
// double-deliver, and two trip generators would double-write. During a
// rolling deploy the old and new Pods overlap, so "one replica" is not a
// guarantee — a lease is.

// ErrLeaseNotAcquired is returned when another owner currently holds it.
var ErrLeaseNotAcquired = errors.New("worker lease held by another owner")

// LeaseStore is the persistence port for a worker lease. The production
// implementation is expected to be a PostgreSQL row with an expiry
// column (or pg_try_advisory_lock); MemoryLeaseStore covers tests and
// single-process deployments.
type LeaseStore interface {
	// Acquire claims the lease for owner until now+ttl. It returns
	// false (without error) when another live owner holds it.
	Acquire(ctx context.Context, name, owner string, ttl time.Duration) (bool, error)
	// Renew extends an already-held lease. It returns false when the
	// lease was lost (expired and taken, or forcibly released).
	Renew(ctx context.Context, name, owner string, ttl time.Duration) (bool, error)
	// Release drops the lease if owner still holds it.
	Release(ctx context.Context, name, owner string) error
}

// MemoryLeaseStore is an in-process LeaseStore.
type MemoryLeaseStore struct {
	mu     sync.Mutex
	leases map[string]memLease
	Now    func() time.Time
}

type memLease struct {
	owner     string
	expiresAt time.Time
}

// NewMemoryLeaseStore returns an empty in-process store.
func NewMemoryLeaseStore() *MemoryLeaseStore {
	return &MemoryLeaseStore{leases: map[string]memLease{}}
}

func (s *MemoryLeaseStore) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Acquire implements LeaseStore.
func (s *MemoryLeaseStore) Acquire(_ context.Context, name, owner string, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.leases == nil {
		s.leases = map[string]memLease{}
	}
	cur, held := s.leases[name]
	if held && cur.owner != owner && cur.expiresAt.After(s.now()) {
		return false, nil
	}
	s.leases[name] = memLease{owner: owner, expiresAt: s.now().Add(ttl)}
	return true, nil
}

// Renew implements LeaseStore.
func (s *MemoryLeaseStore) Renew(_ context.Context, name, owner string, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, held := s.leases[name]
	if !held || cur.owner != owner || !cur.expiresAt.After(s.now()) {
		return false, nil
	}
	s.leases[name] = memLease{owner: owner, expiresAt: s.now().Add(ttl)}
	return true, nil
}

// Release implements LeaseStore.
func (s *MemoryLeaseStore) Release(_ context.Context, name, owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cur, held := s.leases[name]; held && cur.owner == owner {
		delete(s.leases, name)
	}
	return nil
}

// Lease runs work under a renewable single-writer lease.
type Lease struct {
	Name          string
	Owner         string
	TTL           time.Duration
	RenewInterval time.Duration
	Store         LeaseStore
}

// Validate checks the lease configuration. A renew interval that is not
// comfortably shorter than the TTL guarantees eventual split-brain, so
// it is rejected rather than warned about.
func (l *Lease) Validate() error {
	switch {
	case l.Store == nil:
		return errors.New("lease: nil store")
	case l.Name == "" || l.Owner == "":
		return errors.New("lease: name and owner are required")
	case l.TTL <= 0:
		return errors.New("lease: ttl must be positive")
	case l.RenewInterval <= 0:
		return errors.New("lease: renew interval must be positive")
	case l.RenewInterval*3 > l.TTL:
		return fmt.Errorf("lease: renew interval %s must be at most one third of ttl %s so a single missed renewal cannot expire the lease", l.RenewInterval, l.TTL)
	}
	return nil
}

// Run acquires the lease, then invokes work with a context that is
// cancelled if the lease is ever lost. It always releases the lease
// before returning.
//
// Run returns ErrLeaseNotAcquired when another owner holds the lease,
// which callers should treat as "another replica is the writer" and
// exit cleanly rather than as a failure.
func (l *Lease) Run(ctx context.Context, work func(context.Context) error) error {
	if err := l.Validate(); err != nil {
		return err
	}
	acquired, err := l.Store.Acquire(ctx, l.Name, l.Owner, l.TTL)
	if err != nil {
		return fmt.Errorf("acquire lease %s: %w", l.Name, err)
	}
	if !acquired {
		return ErrLeaseNotAcquired
	}

	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	renewDone := make(chan struct{})
	var renewErr atomic.Value
	go func() {
		defer close(renewDone)
		ticker := time.NewTicker(l.RenewInterval)
		defer ticker.Stop()
		for {
			select {
			case <-workCtx.Done():
				return
			case <-ticker.C:
				ok, rerr := l.Store.Renew(workCtx, l.Name, l.Owner, l.TTL)
				if rerr != nil {
					renewErr.Store(fmt.Errorf("renew lease %s: %w", l.Name, rerr))
					cancel()
					return
				}
				if !ok {
					renewErr.Store(fmt.Errorf("lost lease %s: %w", l.Name, ErrLeaseNotAcquired))
					cancel()
					return
				}
			}
		}
	}()

	workErr := work(workCtx)
	cancel()
	<-renewDone
	// Release with the parent context: workCtx is already cancelled.
	if rerr := l.Store.Release(ctx, l.Name, l.Owner); rerr != nil && workErr == nil {
		workErr = fmt.Errorf("release lease %s: %w", l.Name, rerr)
	}
	if lost, ok := renewErr.Load().(error); ok && lost != nil && workErr == nil {
		workErr = lost
	}
	return workErr
}
