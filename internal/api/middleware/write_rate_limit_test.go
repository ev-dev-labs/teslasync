package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func TestWriteRateLimiter(t *testing.T) {
	now := time.Date(2026, time.August, 26, 12, 0, 0, 0, time.UTC)
	limiter := NewWriteRateLimiter(2, time.Minute, "")
	limiter.now = func() time.Time { return now }
	handler := limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	request := func(method, remote string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "https://app.example.test/api/v1/settings", nil)
		req.RemoteAddr = remote
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res
	}

	if got := request(http.MethodPost, "198.51.100.10:1234").Code; got != http.StatusNoContent {
		t.Fatalf("first write status = %d, want %d", got, http.StatusNoContent)
	}
	if got := request(http.MethodPost, "198.51.100.10:1235").Code; got != http.StatusNoContent {
		t.Fatalf("second write status = %d, want %d", got, http.StatusNoContent)
	}
	limited := request(http.MethodPost, "198.51.100.10:1236")
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("third write status = %d, want %d", limited.Code, http.StatusTooManyRequests)
	}
	if got := limited.Header().Get("Retry-After"); got != "60" {
		t.Fatalf("Retry-After = %q, want 60", got)
	}
	if got := request(http.MethodGet, "198.51.100.10:1237").Code; got != http.StatusNoContent {
		t.Fatalf("GET status = %d, want %d", got, http.StatusNoContent)
	}
	if got := request(http.MethodPost, "203.0.113.1:9999").Code; got != http.StatusNoContent {
		t.Fatalf("other client status = %d, want %d", got, http.StatusNoContent)
	}

	now = now.Add(time.Minute)
	if got := request(http.MethodPost, "198.51.100.10:1238").Code; got != http.StatusNoContent {
		t.Fatalf("new window status = %d, want %d", got, http.StatusNoContent)
	}
}

func TestWriteRateLimiter_IgnoresSpoofedForwardedClientHeaders(t *testing.T) {
	limiter := NewWriteRateLimiter(1, time.Minute, "")
	router := chi.NewRouter()
	router.Use(CapturePeerAddress)
	router.Use(chimw.RealIP)
	router.Use(limiter.Middleware)
	router.Post("/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })

	request := func(xff, trueClientIP string) int {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "10.0.0.8:4000" // The actual reverse-proxy transport peer.
		req.Header.Set("X-Forwarded-For", xff)
		req.Header.Set("True-Client-IP", trueClientIP)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res.Code
	}

	if got := request("198.51.100.1", "198.51.100.1"); got != http.StatusNoContent {
		t.Fatalf("first spoofed request = %d, want %d", got, http.StatusNoContent)
	}
	if got := request("203.0.113.2", "203.0.113.2"); got != http.StatusTooManyRequests {
		t.Fatalf("second spoofed request = %d, want %d", got, http.StatusTooManyRequests)
	}
}

func TestWriteRateLimiter_SeparatesAuthenticatedPrincipals(t *testing.T) {
	limiter := NewWriteRateLimiter(1, time.Minute, "X-Forwarded-User")
	handler := limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	request := func(principal string) int {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "198.51.100.10:1234"
		req.Header.Set("X-Forwarded-User", principal)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res.Code
	}

	if got := request("alice"); got != http.StatusNoContent {
		t.Fatalf("alice first request = %d, want %d", got, http.StatusNoContent)
	}
	if got := request("bob"); got != http.StatusNoContent {
		t.Fatalf("bob request = %d, want %d", got, http.StatusNoContent)
	}
	if got := request("alice"); got != http.StatusTooManyRequests {
		t.Fatalf("alice second request = %d, want %d", got, http.StatusTooManyRequests)
	}
}

func TestWriteRateLimiter_EvictsOldestKeyWhenSaturated(t *testing.T) {
	limiter := NewWriteRateLimiter(1, time.Minute, "")
	limiter.maxKeys = 1
	handler := limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	request := func(remote string) int {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = remote
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res.Code
	}

	if got := request("198.51.100.1:1"); got != http.StatusNoContent {
		t.Fatalf("first key = %d, want %d", got, http.StatusNoContent)
	}
	if got := request("198.51.100.2:1"); got != http.StatusNoContent {
		t.Fatalf("new key while saturated = %d, want %d", got, http.StatusNoContent)
	}
	if got := len(limiter.clients); got != 1 {
		t.Fatalf("tracked client keys = %d, want bounded size 1", got)
	}
	if got := request("198.51.100.1:1"); got != http.StatusNoContent {
		t.Fatalf("evicted key may re-enter = %d, want %d", got, http.StatusNoContent)
	}
}
