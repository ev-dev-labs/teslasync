package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// redCounterValue reads the float64 scalar of a CounterVec child for the
// given label combination. Returns 0 when the child has not yet been
// observed. Named distinctly from counterValue() in
// api_call_log_middleware_test.go to avoid same-package collisions.
func redCounterValue(t *testing.T, cv *prometheus.CounterVec, lvs ...string) float64 {
	t.Helper()
	c, err := cv.GetMetricWithLabelValues(lvs...)
	if err != nil {
		t.Fatalf("GetMetricWithLabelValues(%v): %v", lvs, err)
	}
	var pb dto.Metric
	if err := c.Write(&pb); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if pb.GetCounter() == nil {
		return 0
	}
	return pb.GetCounter().GetValue()
}

// redHistogramSampleCount reads the histogram's sample count for the given
// label combination (method,route).
func redHistogramSampleCount(t *testing.T, lvs ...string) uint64 {
	t.Helper()
	obs, err := redHTTPRequestDurationSeconds.GetMetricWithLabelValues(lvs...)
	if err != nil {
		t.Fatalf("histogram GetMetricWithLabelValues(%v): %v", lvs, err)
	}
	m, ok := obs.(prometheus.Metric)
	if !ok {
		t.Fatalf("observer does not implement prometheus.Metric: %T", obs)
	}
	var pb dto.Metric
	if err := m.Write(&pb); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if pb.GetHistogram() == nil {
		return 0
	}
	return pb.GetHistogram().GetSampleCount()
}

func TestStatusClass(t *testing.T) {
	cases := []struct {
		status int
		want   string
	}{
		{100, "1xx"},
		{200, "2xx"},
		{201, "2xx"},
		{301, "3xx"},
		{400, "4xx"},
		{404, "4xx"},
		{500, "5xx"},
		{503, "5xx"},
		{0, "5xx"},
		{99, "5xx"},
		{600, "5xx"},
	}
	for _, tc := range cases {
		if got := statusClass(tc.status); got != tc.want {
			t.Errorf("statusClass(%d)=%q want %q", tc.status, got, tc.want)
		}
	}
}

func TestRouteLabel_UsesChiPattern(t *testing.T) {
	r := chi.NewRouter()
	r.Use(MetricsMiddleware)

	var observed string
	r.Get("/api/v1/widgets/{widgetID}", func(w http.ResponseWriter, r *http.Request) {
		observed = routeLabel(r)
		w.WriteHeader(http.StatusOK)
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/widgets/42")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	if observed != "/api/v1/widgets/{widgetID}" {
		t.Errorf("routeLabel=%q want chi pattern", observed)
	}
}

func TestRouteLabel_UnroutedFallsBackToNormalizedPath(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/random/unrouted/path", nil)
	if got := routeLabel(req); got != "/random/unrouted/path" {
		t.Errorf("routeLabel(unrouted)=%q want pass-through", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/drives/123456", nil)
	if got := routeLabel(req); got != "/api/v1/drives/:id" {
		t.Errorf("routeLabel(unrouted dynamic)=%q want normalized", got)
	}
}

// TestMetricsMiddleware_HappyPath exercises a 2xx response and asserts that
// http_requests_total is incremented exactly once for {GET, route, 2xx} and
// http_request_errors_total is NOT incremented.
func TestMetricsMiddleware_HappyPath(t *testing.T) {
	const route = "/test/happy/{id}"
	const method = http.MethodGet

	beforeReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "2xx")
	beforeErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "2xx")
	beforeDur := redHistogramSampleCount(t, method, route)

	r := chi.NewRouter()
	r.Use(MetricsMiddleware)
	r.Get(route, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/test/happy/abc")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d", resp.StatusCode)
	}

	afterReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "2xx")
	afterErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "2xx")
	afterDur := redHistogramSampleCount(t, method, route)

	if afterReq-beforeReq != 1 {
		t.Errorf("http_requests_total delta=%v want 1", afterReq-beforeReq)
	}
	if afterErr-beforeErr != 0 {
		t.Errorf("http_request_errors_total delta=%v want 0", afterErr-beforeErr)
	}
	if afterDur-beforeDur != 1 {
		t.Errorf("http_request_duration_seconds sample_count delta=%d want 1", afterDur-beforeDur)
	}
}

// TestMetricsMiddleware_ErrorPath exercises a 5xx response and asserts that
// BOTH http_requests_total{...status_class=5xx} AND
// http_request_errors_total{...status_class=5xx} are incremented exactly once.
func TestMetricsMiddleware_ErrorPath(t *testing.T) {
	const route = "/test/boom/{id}"
	const method = http.MethodPost

	beforeReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "5xx")
	beforeErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "5xx")
	beforeDur := redHistogramSampleCount(t, method, route)

	r := chi.NewRouter()
	r.Use(MetricsMiddleware)
	r.Post(route, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/test/boom/xyz", "application/json", nil)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status=%d", resp.StatusCode)
	}

	afterReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "5xx")
	afterErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "5xx")
	afterDur := redHistogramSampleCount(t, method, route)

	if afterReq-beforeReq != 1 {
		t.Errorf("http_requests_total delta=%v want 1", afterReq-beforeReq)
	}
	if afterErr-beforeErr != 1 {
		t.Errorf("http_request_errors_total delta=%v want 1", afterErr-beforeErr)
	}
	if afterDur-beforeDur != 1 {
		t.Errorf("http_request_duration_seconds sample_count delta=%d want 1", afterDur-beforeDur)
	}
}

// TestMetricsMiddleware_ClientErrorIsNotErrorBucket asserts that a 4xx
// response increments http_requests_total{...4xx} but does NOT increment
// http_request_errors_total — that counter is reserved for 5xx server errors.
func TestMetricsMiddleware_ClientErrorIsNotErrorBucket(t *testing.T) {
	const route = "/test/forbidden"
	const method = http.MethodGet

	beforeReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "4xx")
	beforeErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "4xx")

	r := chi.NewRouter()
	r.Use(MetricsMiddleware)
	r.Get(route, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Get(srv.URL + route)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	afterReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "4xx")
	afterErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "4xx")

	if afterReq-beforeReq != 1 {
		t.Errorf("http_requests_total delta=%v want 1", afterReq-beforeReq)
	}
	if afterErr-beforeErr != 0 {
		t.Errorf("http_request_errors_total delta=%v want 0 (4xx is not an error bucket)", afterErr-beforeErr)
	}
}

// failingHandler returns a handler that panics; the inline recover converts
// the panic to a 500 so the test does not depend on RecoveryMiddleware
// (the production chain would also catch this).
func failingHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				http.Error(w, "recovered", http.StatusInternalServerError)
			}
		}()
		panic(errors.New("intentional panic"))
	})
}

// TestMetricsMiddleware_RecordsAfterPanic asserts that even when the inner
// handler panics, MetricsMiddleware's deferred record fires and the request
// is counted as 5xx.
func TestMetricsMiddleware_RecordsAfterPanic(t *testing.T) {
	const route = "/test/panic"
	const method = http.MethodGet

	beforeReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "5xx")
	beforeErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "5xx")

	r := chi.NewRouter()
	r.Use(MetricsMiddleware)
	r.Get(route, failingHandler().ServeHTTP)

	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Get(srv.URL + route)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status=%d", resp.StatusCode)
	}

	afterReq := redCounterValue(t, redHTTPRequestsTotal, method, route, "5xx")
	afterErr := redCounterValue(t, redHTTPRequestErrorsTotal, method, route, "5xx")

	if afterReq-beforeReq != 1 {
		t.Errorf("http_requests_total delta=%v want 1 after panic", afterReq-beforeReq)
	}
	if afterErr-beforeErr != 1 {
		t.Errorf("http_request_errors_total delta=%v want 1 after panic", afterErr-beforeErr)
	}
}
