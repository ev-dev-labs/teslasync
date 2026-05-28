// Package auth — subject recorder middleware (Phase-46 / Prompt 57).
//
// The recorder bumps the auth_subjects table on every authenticated
// request so the table stays an accurate materialisation of who has
// touched the API. Other features (RBAC matrix, impersonation
// candidate list, future admin "users" panel) read from this table
// rather than scanning auth_sessions for distinct subjects — that
// query would miss principals who never minted a TeslaSync cookie
// (e.g. machine accounts that never round-trip a Set-Cookie response).
//
// Open-mode policy
// ----------------
// In open mode (no FORWARD_AUTH_HEADER configured) the middleware is
// a passthrough — there is no subject to record.
//
// Throttling
// ----------
// Authenticated traffic is request-rate, not human-rate; UPSERT-ing on
// every call would generate write amplification proportional to API
// load. The recorder debounces per-subject writes through an
// in-process map (default 60-second window). The window is
// configurable so tests can pin behaviour deterministically.
package auth

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
)

// DefaultSubjectRecorderInterval is the minimum gap between
// successive Upsert writes for the same subject inside a single
// process. 60 seconds matches the [dbauth.NewDebouncedBumper]
// default used by the session tracker so operators see a single
// consistent "last activity" cadence across the auth surface.
const DefaultSubjectRecorderInterval = 60 * time.Second

// SubjectStore is the storage seam for the recorder. Production
// wires this to *dbauth.AuthSubjectsRepo; tests substitute an
// in-memory fake.
//
// The interface is intentionally minimal — only the side-effect the
// recorder produces — so a future swap to a different backend (or
// to a buffered queue) does not require resurrecting unused methods.
type SubjectStore interface {
	// Upsert MUST be idempotent. now is the wall-clock instant the
	// recorder observed the request; the implementation is free to
	// clamp / round it for storage.
	Upsert(ctx context.Context, subject string, now time.Time) error
}

// SubjectRecorderOptions tunes the middleware. Zero values are
// treated as documented defaults so production wiring can pass the
// zero struct.
type SubjectRecorderOptions struct {
	// Interval is the minimum gap between repeat Upserts for the
	// same subject. Zero defaults to DefaultSubjectRecorderInterval.
	Interval time.Duration

	// Now is injectable for deterministic tests. Defaults to
	// time.Now.
	Now func() time.Time

	// AsyncWrite, when true, hands the Upsert off to a goroutine so
	// the caller's handler doesn't pay the write latency. Default
	// false because the call cost is already tiny (debounce hits in
	// the common case) and synchronous semantics make tests easier
	// to reason about.
	AsyncWrite bool
}

// SubjectRecorder bundles the per-process debounce map with the
// store-write behaviour. Exposed (rather than constructed inside
// SubjectRecorderMiddleware) so tests can poke the bumper directly
// without mounting a full http.Handler chain.
type SubjectRecorder struct {
	store      SubjectStore
	interval   time.Duration
	now        func() time.Time
	asyncWrite bool

	mu       sync.Mutex
	lastSeen map[string]time.Time
}

// NewSubjectRecorder builds a recorder with the supplied options.
// store may be nil; the recorder then becomes a no-op at every
// observation, matching the open-mode contract.
func NewSubjectRecorder(store SubjectStore, opts SubjectRecorderOptions) *SubjectRecorder {
	interval := opts.Interval
	if interval <= 0 {
		interval = DefaultSubjectRecorderInterval
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	return &SubjectRecorder{
		store:      store,
		interval:   interval,
		now:        now,
		asyncWrite: opts.AsyncWrite,
		lastSeen:   make(map[string]time.Time),
	}
}

// Observe records a sighting of subject. Returns true when the
// underlying store was called (debounce window expired or first
// sighting), false when the call was throttled. Callers don't
// usually care about the return value; the boolean exists so tests
// can pin debounce behaviour without poking the unexported map.
//
// Errors from the store are intentionally swallowed (logged at the
// caller's discretion via a wrapped store) — the recorder is a
// best-effort audit primitive and a transient DB blip MUST NOT
// fail the inbound request.
func (r *SubjectRecorder) Observe(ctx context.Context, subject string) bool {
	if r == nil || r.store == nil {
		return false
	}
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return false
	}
	now := r.now()
	r.mu.Lock()
	last, seen := r.lastSeen[subject]
	if seen && now.Sub(last) < r.interval {
		r.mu.Unlock()
		return false
	}
	r.lastSeen[subject] = now
	r.mu.Unlock()

	if r.asyncWrite {
		go func() {
			_ = r.store.Upsert(context.Background(), subject, now)
		}()
		return true
	}
	_ = r.store.Upsert(ctx, subject, now)
	return true
}

// SubjectRecorderMiddleware mounts the recorder as an HTTP middleware.
// MUST be installed AFTER ForwardAuthMiddleware so the principal
// header is guaranteed present on every request that reaches the
// recorder.
//
// In open mode (headerName == "") or with a nil recorder the
// middleware is a passthrough.
func SubjectRecorderMiddleware(headerName string, recorder *SubjectRecorder) func(http.Handler) http.Handler {
	if headerName == "" || recorder == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if subject, ok := SubjectFromRequest(r, headerName); ok {
				recorder.Observe(r.Context(), subject)
			}
			next.ServeHTTP(w, r)
		})
	}
}
