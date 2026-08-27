package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// Tests that complement the metrics_test.go middleware coverage.

func TestSecurityHeadersPresence(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	headers := []struct {
		name string
		want string
	}{
		{"X-Content-Type-Options", "nosniff"},
		{"X-Frame-Options", "DENY"},
		{"X-XSS-Protection", "0"},
		{"Referrer-Policy", "strict-origin-when-cross-origin"},
		{"Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"},
	}

	for _, h := range headers {
		t.Run(h.name, func(t *testing.T) {
			got := w.Header().Get(h.name)
			if got != h.want {
				t.Errorf("%s = %q, want %q", h.name, got, h.want)
			}
		})
	}
}

func TestSecurityHeadersCSPPresent(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	csp := w.Header().Get("Content-Security-Policy")
	if csp != apiContentSecurityPolicy {
		t.Errorf("Content-Security-Policy = %q, want %q", csp, apiContentSecurityPolicy)
	}
}

func TestRecoveryMiddlewareCatchesPanic(t *testing.T) {
	handler := Recovery(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}))

	req := httptest.NewRequest("GET", "/panic", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}

func TestRecoveryMiddlewareNoEffect(t *testing.T) {
	handler := Recovery(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("fine"))
	}))

	req := httptest.NewRequest("GET", "/ok", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestLoggerMiddlewareCallsNext(t *testing.T) {
	called := false
	handler := Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if !called {
		t.Error("inner handler was not called")
	}
}

func TestTracingAddsMatchedRoute(t *testing.T) {
	previous := otel.GetTracerProvider()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		_ = provider.Shutdown(t.Context())
		otel.SetTracerProvider(previous)
	})

	router := chi.NewRouter()
	router.Use(Tracing)
	router.Get("/api/v1/widgets/{widgetID}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/widgets/42", nil)
	response := httptest.NewRecorder()
	WithMatchedRoute(router).ServeHTTP(response, request)

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	if got := spans[0].Name(); got != "GET /api/v1/widgets/{widgetID}" {
		t.Errorf("span name = %q, want matched route", got)
	}
	for _, attr := range spans[0].Attributes() {
		if string(attr.Key) == "http.route" && attr.Value.AsString() == "/api/v1/widgets/{widgetID}" {
			return
		}
	}
	t.Error("span is missing the matched http.route attribute")
}
