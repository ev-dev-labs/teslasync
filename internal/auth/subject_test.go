// Auth subject and recorder middleware tests.
//
// Covers:
//
//   - SubjectFromRequest open-mode vs forward-auth + missing-header
//     vs forward-auth + present.
//   - RequireSubjectMiddleware emits the canonical { error, code }
//     envelope with code AUTH_MODE_OPEN in open mode and
//     MISSING_IDENTITY when the header is configured but absent.
//   - SubjectRecorder debounces per-subject writes inside the
//     configured interval.
//   - SubjectRecorder treats a nil store as a no-op (open-mode wiring).
//   - Recorder middleware passes through when headerName is empty
//     even if a recorder is supplied.
package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSubjectFromRequest_OpenMode(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-User", "alice")

	sub, ok := SubjectFromRequest(r, "")
	if ok {
		t.Fatalf("open mode must report ok=false; got sub=%q", sub)
	}
	if sub != "" {
		t.Fatalf("open mode must yield empty subject; got %q", sub)
	}
}

func TestSubjectFromRequest_ForwardAuthMissingHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	// No header set.
	if sub, ok := SubjectFromRequest(r, "X-Forwarded-User"); ok {
		t.Fatalf("missing header must report ok=false; got sub=%q", sub)
	}

	r.Header.Set("X-Forwarded-User", "   \t\n")
	if sub, ok := SubjectFromRequest(r, "X-Forwarded-User"); ok {
		t.Fatalf("whitespace-only header must report ok=false; got sub=%q", sub)
	}
}

func TestSubjectFromRequest_HappyPath(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-User", "  alice  ")
	sub, ok := SubjectFromRequest(r, "X-Forwarded-User")
	if !ok {
		t.Fatalf("header set must report ok=true")
	}
	if sub != "alice" {
		t.Fatalf("subject must be trimmed; got %q", sub)
	}
}

func TestIsOpenMode(t *testing.T) {
	if !IsOpenMode("") {
		t.Fatal(`IsOpenMode("") = false; want true`)
	}
	if IsOpenMode("X-Forwarded-User") {
		t.Fatal(`IsOpenMode("X-Forwarded-User") = true; want false`)
	}
}

func TestRequireSubjectMiddleware_OpenMode(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	})
	mw := RequireSubjectMiddleware("")(next)

	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))

	if called {
		t.Fatal("open mode must short-circuit before next.ServeHTTP")
	}
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status: got %d, want 501", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["code"] != AuthModeOpenCode {
		t.Fatalf("code: got %q, want %q", body["code"], AuthModeOpenCode)
	}
	if body["error"] == "" {
		t.Fatal("error message must be non-empty")
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content-type: got %q, want application/json", got)
	}
}

func TestRequireSubjectMiddleware_MissingHeader(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	})
	mw := RequireSubjectMiddleware("X-Forwarded-User")(next)

	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))

	if called {
		t.Fatal("missing header must short-circuit before next.ServeHTTP")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["code"] != MissingIdentityCode {
		t.Fatalf("code: got %q, want %q", body["code"], MissingIdentityCode)
	}
}

func TestRequireSubjectMiddleware_HeaderPresentPassesThrough(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	})
	mw := RequireSubjectMiddleware("X-Forwarded-User")(next)

	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-User", "alice")
	mw.ServeHTTP(httptest.NewRecorder(), r)

	if !called {
		t.Fatal("present subject must pass through to next.ServeHTTP")
	}
}

// fakeSubjectStore is the in-memory test double for SubjectStore.
// Records every Upsert call so tests can pin call counts and
// per-subject sequencing.
type fakeSubjectStore struct {
	mu    sync.Mutex
	calls []fakeSubjectCall
	err   error
}

type fakeSubjectCall struct {
	subject string
	at      time.Time
}

func (f *fakeSubjectStore) Upsert(_ context.Context, subject string, now time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, fakeSubjectCall{subject: subject, at: now})
	return f.err
}

func (f *fakeSubjectStore) snapshot() []fakeSubjectCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]fakeSubjectCall, len(f.calls))
	copy(out, f.calls)
	return out
}

func TestSubjectRecorder_DebouncePerSubject(t *testing.T) {
	store := &fakeSubjectStore{}
	clock := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	rec := NewSubjectRecorder(store, SubjectRecorderOptions{
		Interval: 30 * time.Second,
		Now:      func() time.Time { return clock },
	})

	if !rec.Observe(context.Background(), "alice") {
		t.Fatal("first observation must call store")
	}
	clock = clock.Add(10 * time.Second)
	if rec.Observe(context.Background(), "alice") {
		t.Fatal("second observation inside window must be debounced")
	}
	clock = clock.Add(25 * time.Second)
	if !rec.Observe(context.Background(), "alice") {
		t.Fatal("observation past window must call store")
	}

	calls := store.snapshot()
	if len(calls) != 2 {
		t.Fatalf("call count: got %d, want 2; %+v", len(calls), calls)
	}
	if calls[0].subject != "alice" || calls[1].subject != "alice" {
		t.Fatalf("subject names: got %+v", calls)
	}
}

func TestSubjectRecorder_DistinctSubjectsIndependent(t *testing.T) {
	store := &fakeSubjectStore{}
	clock := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	rec := NewSubjectRecorder(store, SubjectRecorderOptions{
		Interval: 60 * time.Second,
		Now:      func() time.Time { return clock },
	})

	if !rec.Observe(context.Background(), "alice") {
		t.Fatal("alice first call must record")
	}
	if !rec.Observe(context.Background(), "bob") {
		t.Fatal("bob first call must record even within alice's window")
	}
	clock = clock.Add(30 * time.Second)
	if rec.Observe(context.Background(), "alice") {
		t.Fatal("alice within window must debounce")
	}
	if rec.Observe(context.Background(), "bob") {
		t.Fatal("bob within window must debounce")
	}
}

func TestSubjectRecorder_TrimsAndRejectsEmpty(t *testing.T) {
	store := &fakeSubjectStore{}
	rec := NewSubjectRecorder(store, SubjectRecorderOptions{
		Now: func() time.Time { return time.Now() },
	})

	if rec.Observe(context.Background(), "") {
		t.Fatal("empty subject must return false")
	}
	if rec.Observe(context.Background(), "   ") {
		t.Fatal("whitespace-only subject must return false")
	}
	if !rec.Observe(context.Background(), "  alice  ") {
		t.Fatal("trimmed subject must record")
	}
	calls := store.snapshot()
	if len(calls) != 1 || calls[0].subject != "alice" {
		t.Fatalf("expected one trimmed call; got %+v", calls)
	}
}

func TestSubjectRecorder_NilStoreNoOp(t *testing.T) {
	rec := NewSubjectRecorder(nil, SubjectRecorderOptions{})
	if rec.Observe(context.Background(), "alice") {
		t.Fatal("nil store must yield no-op false")
	}
}

func TestSubjectRecorder_NilRecorderNoOp(t *testing.T) {
	var rec *SubjectRecorder
	if rec.Observe(context.Background(), "alice") {
		t.Fatal("nil recorder must not panic and must return false")
	}
}

func TestSubjectRecorderOptions_DefaultInterval(t *testing.T) {
	store := &fakeSubjectStore{}
	rec := NewSubjectRecorder(store, SubjectRecorderOptions{})
	if rec.interval != DefaultSubjectRecorderInterval {
		t.Fatalf("interval default: got %v, want %v", rec.interval, DefaultSubjectRecorderInterval)
	}
}

func TestSubjectRecorderMiddleware_OpenModePassthrough(t *testing.T) {
	store := &fakeSubjectStore{}
	rec := NewSubjectRecorder(store, SubjectRecorderOptions{})
	called := atomic.Int32{}
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called.Add(1)
	})

	mw := SubjectRecorderMiddleware("", rec)(next)
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-User", "alice")
	mw.ServeHTTP(httptest.NewRecorder(), r)

	if called.Load() != 1 {
		t.Fatal("open mode must passthrough to next")
	}
	if calls := store.snapshot(); len(calls) != 0 {
		t.Fatalf("open mode must not record; got %+v", calls)
	}
}

func TestSubjectRecorderMiddleware_NilRecorderPassthrough(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	})

	mw := SubjectRecorderMiddleware("X-Forwarded-User", nil)(next)
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-User", "alice")
	mw.ServeHTTP(httptest.NewRecorder(), r)

	if !called {
		t.Fatal("nil recorder must passthrough to next")
	}
}

func TestSubjectRecorderMiddleware_RecordsHeaderPresent(t *testing.T) {
	store := &fakeSubjectStore{}
	rec := NewSubjectRecorder(store, SubjectRecorderOptions{
		Now: func() time.Time { return time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC) },
	})
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})

	mw := SubjectRecorderMiddleware("X-Forwarded-User", rec)(next)
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-User", "alice")
	mw.ServeHTTP(httptest.NewRecorder(), r)

	calls := store.snapshot()
	if len(calls) != 1 || calls[0].subject != "alice" {
		t.Fatalf("expected one alice record; got %+v", calls)
	}
}

func TestSubjectRecorderMiddleware_NoHeaderNoRecord(t *testing.T) {
	store := &fakeSubjectStore{}
	rec := NewSubjectRecorder(store, SubjectRecorderOptions{})
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})

	mw := SubjectRecorderMiddleware("X-Forwarded-User", rec)(next)
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	// No header.
	mw.ServeHTTP(httptest.NewRecorder(), r)

	if calls := store.snapshot(); len(calls) != 0 {
		t.Fatalf("missing header must not record; got %+v", calls)
	}
}
