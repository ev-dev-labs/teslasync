// Phase-46 / Prompt 42 — session tracker middleware tests.
//
// Coverage:
//
//   - Open mode (empty header name) → middleware is a passthrough.
//     No Set-Cookie header is written; no store calls happen.
//   - Forward-auth mode + missing header → passthrough (the upstream
//     ForwardAuth middleware already 401s; we don't double-fault).
//   - Forward-auth mode + no cookie → mints + persists + attaches
//     Set-Cookie + injects current session id into context.
//   - Forward-auth mode + valid cookie → bumps last_seen_at via the
//     debouncer + injects current session id into context.
//   - Forward-auth mode + revoked cookie → 401 + clears cookie + does
//     NOT propagate to the wrapped handler.
//   - Forward-auth mode + cookie for a different subject → 401 +
//     clears cookie.
package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeSessionStore is an in-memory SessionStore for tests. The HMAC
// secret is fixed so we can recompute hashes from the test body.
type fakeSessionStore struct {
	rowsByHash  map[string]*database.AuthSessionRow
	mintToken   string
	mintErr     error
	createErr   error
	bumpedID    uuid.UUID
	bumpCalls   int32
	createCalls int32
}

func newFakeStore() *fakeSessionStore {
	return &fakeSessionStore{rowsByHash: make(map[string]*database.AuthSessionRow)}
}

func (s *fakeSessionStore) HashCookie(token string) []byte {
	// Stable, easy-to-recompute "hash" — sufficient for routing
	// requests through the middleware. Production uses HMAC-SHA256.
	return []byte("h:" + token)
}

func (s *fakeSessionStore) MintCookieToken() (string, []byte, error) {
	if s.mintErr != nil {
		return "", nil, s.mintErr
	}
	t := s.mintToken
	if t == "" {
		t = "abcd1234"
	}
	return t, s.HashCookie(t), nil
}

func (s *fakeSessionStore) Create(_ context.Context, subject string, cookieHash []byte, ua, ip string) (uuid.UUID, error) {
	atomic.AddInt32(&s.createCalls, 1)
	if s.createErr != nil {
		return uuid.Nil, s.createErr
	}
	id := uuid.New()
	row := &database.AuthSessionRow{
		ID:         id,
		Subject:    subject,
		UserAgent:  ua,
		IP:         ip,
		CreatedAt:  time.Now(),
		LastSeenAt: time.Now(),
	}
	s.rowsByHash[string(cookieHash)] = row
	return id, nil
}

func (s *fakeSessionStore) GetByCookieHash(_ context.Context, cookieHash []byte) (*database.AuthSessionRow, error) {
	row, ok := s.rowsByHash[string(cookieHash)]
	if !ok {
		return nil, database.ErrAuthSessionNotFound
	}
	return row, nil
}

func (s *fakeSessionStore) BumpLastSeen(_ context.Context, id uuid.UUID) error {
	atomic.AddInt32(&s.bumpCalls, 1)
	s.bumpedID = id
	return nil
}

const testHeader = "X-Forwarded-User"

// nextRecorder wraps the wrapped-handler invocation count + the
// resolved current session id from the request context.
type nextRecorder struct {
	calls         int
	lastCtxID     uuid.UUID
	lastCtxOK     bool
	wantStatus    int
	writeResponse string
}

func (n *nextRecorder) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.calls++
		id, ok := CurrentSessionID(r.Context())
		n.lastCtxID = id
		n.lastCtxOK = ok
		if n.wantStatus != 0 {
			w.WriteHeader(n.wantStatus)
		}
		if n.writeResponse != "" {
			_, _ = w.Write([]byte(n.writeResponse))
		}
	})
}

func TestMiddleware_OpenModePassthrough(t *testing.T) {
	store := newFakeStore()
	rec := &nextRecorder{wantStatus: http.StatusOK, writeResponse: "ok"}
	mw := Middleware("", store, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	srv.ServeHTTP(w, req)

	if rec.calls != 1 {
		t.Fatalf("next called %d times, want 1", rec.calls)
	}
	if rec.lastCtxOK {
		t.Fatalf("CurrentSessionID should be empty in open mode")
	}
	if got := w.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("open mode must not Set-Cookie; got %q", got)
	}
	if atomic.LoadInt32(&store.createCalls) != 0 {
		t.Fatalf("open mode must not call store.Create")
	}
}

func TestMiddleware_NilStorePassthrough(t *testing.T) {
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, nil, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	req.Header.Set(testHeader, "alice")
	srv.ServeHTTP(w, req)

	if rec.calls != 1 {
		t.Fatalf("next called %d times, want 1", rec.calls)
	}
	if got := w.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("nil-store mode must not Set-Cookie; got %q", got)
	}
}

func TestMiddleware_MissingHeaderPassthrough(t *testing.T) {
	store := newFakeStore()
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, store, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	// No X-Forwarded-User — proxy stripped or unauthenticated path.
	srv.ServeHTTP(w, req)

	if rec.calls != 1 {
		t.Fatalf("next called %d times, want 1", rec.calls)
	}
	if atomic.LoadInt32(&store.createCalls) != 0 {
		t.Fatalf("missing-header path must not call Create")
	}
}

func TestMiddleware_FirstRequestMintsCookie(t *testing.T) {
	store := newFakeStore()
	store.mintToken = "freshtoken"
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, store, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	req.Header.Set(testHeader, "alice@example.com")
	req.Header.Set("User-Agent", "TestAgent/1.0")
	srv.ServeHTTP(w, req)

	if rec.calls != 1 {
		t.Fatalf("next not called")
	}
	if !rec.lastCtxOK {
		t.Fatalf("CurrentSessionID must be populated after mint")
	}
	if rec.lastCtxID == uuid.Nil {
		t.Fatalf("session id should be non-zero after mint")
	}
	cookieHeader := w.Header().Get("Set-Cookie")
	if !strings.Contains(cookieHeader, SessionCookieName+"=freshtoken") {
		t.Fatalf("Set-Cookie missing token: %q", cookieHeader)
	}
	if !strings.Contains(strings.ToLower(cookieHeader), "httponly") {
		t.Fatalf("cookie must be HttpOnly: %q", cookieHeader)
	}
	if atomic.LoadInt32(&store.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", store.createCalls)
	}
}

func TestMiddleware_ValidCookieBumpsAndPropagates(t *testing.T) {
	store := newFakeStore()
	id := uuid.New()
	const token = "validtoken"
	hash := store.HashCookie(token)
	store.rowsByHash[string(hash)] = &database.AuthSessionRow{
		ID:         id,
		Subject:    "alice",
		LastSeenAt: time.Now().Add(-2 * time.Minute),
	}
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, store, SessionTrackerOptions{
		BumpInterval: 30 * time.Second,
		Now:          func() time.Time { return time.Now() },
	})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	req.Header.Set(testHeader, "alice")
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: token})
	srv.ServeHTTP(w, req)

	if !rec.lastCtxOK || rec.lastCtxID != id {
		t.Fatalf("expected ctx id %s, got %s ok=%v", id, rec.lastCtxID, rec.lastCtxOK)
	}
	if got := atomic.LoadInt32(&store.bumpCalls); got != 1 {
		t.Fatalf("expected 1 bump call, got %d", got)
	}
	if got := w.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("valid cookie should NOT re-Set-Cookie; got %q", got)
	}
}

func TestMiddleware_DebounceBumps(t *testing.T) {
	store := newFakeStore()
	id := uuid.New()
	const token = "validtoken"
	hash := store.HashCookie(token)
	store.rowsByHash[string(hash)] = &database.AuthSessionRow{ID: id, Subject: "alice"}

	frozen := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	mw := Middleware(testHeader, store, SessionTrackerOptions{
		BumpInterval: 60 * time.Second,
		Now:          func() time.Time { return frozen },
	})
	srv := mw((&nextRecorder{wantStatus: http.StatusOK}).handler())

	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
		req.Header.Set(testHeader, "alice")
		req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: token})
		srv.ServeHTTP(w, req)
	}
	if got := atomic.LoadInt32(&store.bumpCalls); got != 1 {
		t.Fatalf("expected 1 bump call across 3 requests within window, got %d", got)
	}
}

func TestMiddleware_RevokedCookieReturns401(t *testing.T) {
	store := newFakeStore()
	id := uuid.New()
	const token = "revokedtoken"
	hash := store.HashCookie(token)
	revokedAt := time.Now().Add(-time.Minute)
	store.rowsByHash[string(hash)] = &database.AuthSessionRow{
		ID:        id,
		Subject:   "alice",
		RevokedAt: &revokedAt,
	}
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, store, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	req.Header.Set(testHeader, "alice")
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: token})
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked cookie should 401, got %d", w.Code)
	}
	if rec.calls != 0 {
		t.Fatalf("revoked cookie must NOT propagate to wrapped handler")
	}
	cookieHeader := w.Header().Get("Set-Cookie")
	if !strings.Contains(cookieHeader, SessionCookieName+"=") || !strings.Contains(strings.ToLower(cookieHeader), "max-age=0") {
		t.Fatalf("revoked path should clear cookie via Max-Age=0; got %q", cookieHeader)
	}
}

func TestMiddleware_SubjectMismatchReturns401(t *testing.T) {
	store := newFakeStore()
	id := uuid.New()
	const token = "alicetoken"
	hash := store.HashCookie(token)
	store.rowsByHash[string(hash)] = &database.AuthSessionRow{
		ID:      id,
		Subject: "alice",
	}
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, store, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	req.Header.Set(testHeader, "bob") // different subject!
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: token})
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("subject mismatch should 401, got %d", w.Code)
	}
	if rec.calls != 0 {
		t.Fatalf("subject mismatch must NOT propagate to wrapped handler")
	}
}

func TestMiddleware_UnknownCookieClearedAndPassesThrough(t *testing.T) {
	store := newFakeStore()
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, store, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	req.Header.Set(testHeader, "alice")
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "stale"})
	srv.ServeHTTP(w, req)

	if rec.calls != 1 {
		t.Fatalf("unknown cookie should pass through; got %d calls", rec.calls)
	}
	cookieHeader := w.Header().Get("Set-Cookie")
	if !strings.Contains(strings.ToLower(cookieHeader), "max-age=0") {
		t.Fatalf("unknown cookie path should clear cookie; got %q", cookieHeader)
	}
	if atomic.LoadInt32(&store.createCalls) != 0 {
		t.Fatalf("unknown cookie path must not Create — only the next request should mint")
	}
}

func TestMiddleware_MintFailureFallsThrough(t *testing.T) {
	store := newFakeStore()
	store.createErr = errors.New("db down")
	rec := &nextRecorder{wantStatus: http.StatusOK}
	mw := Middleware(testHeader, store, SessionTrackerOptions{})
	srv := mw(rec.handler())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	req.Header.Set(testHeader, "alice")
	srv.ServeHTTP(w, req)

	if rec.calls != 1 {
		t.Fatalf("mint failure should still propagate; got %d calls", rec.calls)
	}
	if rec.lastCtxOK {
		t.Fatalf("mint failure must NOT inject a session id")
	}
	if got := w.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("mint failure should NOT Set-Cookie; got %q", got)
	}
}

func TestCurrentSessionID_NilContext(t *testing.T) {
	if id, ok := CurrentSessionID(nil); ok || id != uuid.Nil {
		t.Fatalf("nil ctx should yield (nil, false); got (%s, %v)", id, ok)
	}
}

func TestCurrentSessionID_NoValue(t *testing.T) {
	if id, ok := CurrentSessionID(context.Background()); ok || id != uuid.Nil {
		t.Fatalf("ctx without value should yield (nil, false); got (%s, %v)", id, ok)
	}
}

func TestRequestClientIP(t *testing.T) {
	cases := []struct {
		name string
		set  func(*http.Request)
		want string
	}{
		{
			name: "X-Forwarded-For wins",
			set: func(r *http.Request) {
				r.Header.Set("X-Forwarded-For", "10.1.1.1, 10.2.2.2")
				r.Header.Set("X-Real-IP", "10.3.3.3")
				r.RemoteAddr = "10.4.4.4:1234"
			},
			want: "10.1.1.1",
		},
		{
			name: "X-Real-IP fallback",
			set: func(r *http.Request) {
				r.Header.Set("X-Real-IP", "10.3.3.3")
				r.RemoteAddr = "10.4.4.4:1234"
			},
			want: "10.3.3.3",
		},
		{
			name: "RemoteAddr fallback",
			set: func(r *http.Request) {
				r.RemoteAddr = "10.4.4.4:1234"
			},
			want: "10.4.4.4",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			tc.set(req)
			if got := requestClientIP(req); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
