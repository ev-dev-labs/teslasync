package auth

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestAppTokenSubjectRoundTrip(t *testing.T) {
	t.Parallel()

	if _, ok := AppTokenSubjectFromContext(t.Context()); ok {
		t.Fatal("empty context must not carry a PAT subject")
	}
	ctx := WithAppTokenSubject(t.Context(), "alice@example.com")
	subject, ok := AppTokenSubjectFromContext(ctx)
	if !ok || subject != "alice@example.com" {
		t.Fatalf("got (%q, %v), want (alice@example.com, true)", subject, ok)
	}
	if _, ok := AppTokenSubjectFromContext(WithAppTokenSubject(t.Context(), "")); ok {
		t.Fatal("empty subject must not read back as present")
	}
}

func TestSessionTrackerSkipsPATRequests(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	mw := Middleware(testHeader, store, SessionTrackerOptions{})

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles", nil)
	req.Header.Set(testHeader, "alice@example.com")
	// No session cookie AND an app-token flag: without the skip this mints a
	// session row on every request.
	req = req.WithContext(WithAppTokenSubject(req.Context(), "alice@example.com"))

	rec := httptest.NewRecorder()
	mw(next).ServeHTTP(rec, req)

	if rec.Code != http.StatusTeapot {
		t.Fatalf("got status %d, want passthrough to next handler", rec.Code)
	}
	if calls := atomic.LoadInt32(&store.createCalls); calls != 0 {
		t.Fatalf("minted %d session rows for an app-token request, want 0", calls)
	}
	if setCookie := rec.Header().Get("Set-Cookie"); setCookie != "" {
		t.Fatalf("set session cookie %q for an app-token request, want none", setCookie)
	}
}
