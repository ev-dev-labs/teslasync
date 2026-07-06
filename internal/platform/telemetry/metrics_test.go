package telemetry

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// counterValue reads the scalar value of a single Counter child.
func counterValue(t *testing.T, c prometheus.Counter) float64 {
	t.Helper()
	var pb dto.Metric
	if err := c.Write(&pb); err != nil {
		t.Fatalf("counter Write: %v", err)
	}
	if pb.GetCounter() == nil {
		return 0
	}
	return pb.GetCounter().GetValue()
}

// histogram reads the dto.Histogram backing a single Observer child.
func histogram(t *testing.T, o prometheus.Observer) *dto.Histogram {
	t.Helper()
	m, ok := o.(prometheus.Metric)
	if !ok {
		t.Fatalf("observer %T does not implement prometheus.Metric", o)
	}
	var pb dto.Metric
	if err := m.Write(&pb); err != nil {
		t.Fatalf("histogram Write: %v", err)
	}
	return pb.GetHistogram()
}

func TestNewMetrics_FieldsNonNil(t *testing.T) {
	m := newMetrics(prometheus.NewRegistry())
	if m == nil {
		t.Fatal("newMetrics returned nil")
	}
	checks := []struct {
		name string
		ptr  any
	}{
		{"HTTPRequestsTotal", m.HTTPRequestsTotal},
		{"HTTPRequestDuration", m.HTTPRequestDuration},
		{"TeslaAPICallsTotal", m.TeslaAPICallsTotal},
		{"TeslaAPICallDuration", m.TeslaAPICallDuration},
		{"FSMTransitionsTotal", m.FSMTransitionsTotal},
		{"CacheHitsTotal", m.CacheHitsTotal},
		{"CacheMissesTotal", m.CacheMissesTotal},
	}
	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			switch v := c.ptr.(type) {
			case *prometheus.CounterVec:
				if v == nil {
					t.Fatalf("%s is nil", c.name)
				}
			case *prometheus.HistogramVec:
				if v == nil {
					t.Fatalf("%s is nil", c.name)
				}
			default:
				t.Fatalf("%s has unexpected type %T", c.name, c.ptr)
			}
		})
	}
}

func TestNewMetrics_FamiliesRegistered(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := newMetrics(reg)

	// A Vec produces no gatherable series until at least one child exists, so
	// exercise every metric with a representative label set first.
	m.HTTPRequestsTotal.WithLabelValues("GET", "/v", "200").Inc()
	m.HTTPRequestDuration.WithLabelValues("GET", "/v").Observe(0.01)
	m.TeslaAPICallsTotal.WithLabelValues("wake_up", "ok").Inc()
	m.TeslaAPICallDuration.WithLabelValues("wake_up").Observe(0.02)
	m.FSMTransitionsTotal.WithLabelValues("drive", "P", "D", "shift").Inc()
	m.CacheHitsTotal.WithLabelValues("redis").Inc()
	m.CacheMissesTotal.WithLabelValues("redis").Inc()

	families, err := reg.Gather()
	if err != nil {
		t.Fatalf("Gather: %v", err)
	}
	byName := make(map[string]*dto.MetricFamily, len(families))
	for _, f := range families {
		byName[f.GetName()] = f
	}

	cases := []struct {
		name       string
		help       string
		typ        dto.MetricType
		labelCount int
	}{
		{"teslasync_http_requests_total", "Total HTTP requests", dto.MetricType_COUNTER, 3},
		{"teslasync_http_request_duration_seconds", "HTTP request duration in seconds", dto.MetricType_HISTOGRAM, 2},
		{"teslasync_tesla_api_calls_total", "Total Tesla API calls", dto.MetricType_COUNTER, 2},
		{"teslasync_tesla_api_call_duration_seconds", "Tesla API call duration in seconds", dto.MetricType_HISTOGRAM, 1},
		{"teslasync_fsm_transitions_total", "Total FSM state transitions", dto.MetricType_COUNTER, 4},
		{"teslasync_cache_hits_total", "Total cache hits", dto.MetricType_COUNTER, 1},
		{"teslasync_cache_misses_total", "Total cache misses", dto.MetricType_COUNTER, 1},
	}
	if len(cases) != len(families) {
		t.Errorf("gathered %d families, expected exactly %d (isolated registry should hold only our metrics)", len(families), len(cases))
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, ok := byName[tc.name]
			if !ok {
				t.Fatalf("metric family %q was not registered", tc.name)
			}
			if f.GetHelp() != tc.help {
				t.Errorf("help=%q, want %q", f.GetHelp(), tc.help)
			}
			if f.GetType() != tc.typ {
				t.Errorf("type=%v, want %v", f.GetType(), tc.typ)
			}
			metrics := f.GetMetric()
			if len(metrics) == 0 {
				t.Fatalf("family %q has no series", tc.name)
			}
			if got := len(metrics[0].GetLabel()); got != tc.labelCount {
				t.Errorf("label count=%d, want %d", got, tc.labelCount)
			}
		})
	}
}

func TestNewMetrics_CounterIncrements(t *testing.T) {
	m := newMetrics(prometheus.NewRegistry())

	cases := []struct {
		name   string
		child  prometheus.Counter
		incBy  int
		expect float64
	}{
		{
			name:   "http requests once",
			child:  m.HTTPRequestsTotal.WithLabelValues("GET", "/a", "200"),
			incBy:  1,
			expect: 1,
		},
		{
			name:   "tesla api calls thrice",
			child:  m.TeslaAPICallsTotal.WithLabelValues("charge_start", "ok"),
			incBy:  3,
			expect: 3,
		},
		{
			name:   "fsm transitions twice",
			child:  m.FSMTransitionsTotal.WithLabelValues("charge", "idle", "charging", "plug"),
			incBy:  2,
			expect: 2,
		},
		{
			name:   "cache hits five",
			child:  m.CacheHitsTotal.WithLabelValues("redis"),
			incBy:  5,
			expect: 5,
		},
		{
			name:   "cache misses zero stays zero",
			child:  m.CacheMissesTotal.WithLabelValues("in_mem"),
			incBy:  0,
			expect: 0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for i := 0; i < tc.incBy; i++ {
				tc.child.Inc()
			}
			if got := counterValue(t, tc.child); got != tc.expect {
				t.Errorf("counter value=%v, want %v", got, tc.expect)
			}
		})
	}
}

func TestNewMetrics_LabelSeriesAreIndependent(t *testing.T) {
	m := newMetrics(prometheus.NewRegistry())

	hit := m.CacheHitsTotal.WithLabelValues("redis")
	miss := m.CacheHitsTotal.WithLabelValues("in_mem")
	hit.Inc()
	hit.Inc()
	miss.Inc()

	if got := counterValue(t, hit); got != 2 {
		t.Errorf("redis series=%v, want 2", got)
	}
	if got := counterValue(t, miss); got != 1 {
		t.Errorf("in_mem series=%v, want 1 (label sets must not share state)", got)
	}
}

func TestNewMetrics_HistogramObservations(t *testing.T) {
	m := newMetrics(prometheus.NewRegistry())

	cases := []struct {
		name      string
		obs       prometheus.Observer
		samples   []float64
		wantCount uint64
		wantSum   float64
	}{
		{
			name:      "http duration three samples",
			obs:       m.HTTPRequestDuration.WithLabelValues("POST", "/drives"),
			samples:   []float64{0.1, 0.2, 0.3},
			wantCount: 3,
			wantSum:   0.6,
		},
		{
			name:      "tesla api duration single sample",
			obs:       m.TeslaAPICallDuration.WithLabelValues("vehicle_data"),
			samples:   []float64{1.5},
			wantCount: 1,
			wantSum:   1.5,
		},
		{
			name:      "zero-valued observation still counts",
			obs:       m.HTTPRequestDuration.WithLabelValues("GET", "/health"),
			samples:   []float64{0},
			wantCount: 1,
			wantSum:   0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, s := range tc.samples {
				tc.obs.Observe(s)
			}
			h := histogram(t, tc.obs)
			if h == nil {
				t.Fatal("no histogram data written")
			}
			if h.GetSampleCount() != tc.wantCount {
				t.Errorf("sample count=%d, want %d", h.GetSampleCount(), tc.wantCount)
			}
			if diff := h.GetSampleSum() - tc.wantSum; diff > 1e-9 || diff < -1e-9 {
				t.Errorf("sample sum=%v, want %v", h.GetSampleSum(), tc.wantSum)
			}
		})
	}
}

func TestNewMetrics_IsolatedRegistriesDoNotCollide(t *testing.T) {
	// Registering the same metric names twice against the SAME registry panics;
	// registry injection lets each caller (and each test) stay isolated. This
	// must not panic.
	first := newMetrics(prometheus.NewRegistry())
	second := newMetrics(prometheus.NewRegistry())

	first.CacheHitsTotal.WithLabelValues("redis").Inc()
	if got := counterValue(t, second.CacheHitsTotal.WithLabelValues("redis")); got != 0 {
		t.Errorf("second registry saw %v, want 0 — registries must not share series", got)
	}
}

func TestNewMetrics_SameRegistryDuplicatePanics(t *testing.T) {
	reg := prometheus.NewRegistry()
	newMetrics(reg) // first registration succeeds

	defer func() {
		if recover() == nil {
			t.Error("expected duplicate registration on the same registry to panic")
		}
	}()
	newMetrics(reg) // duplicate names on same registry must panic (promauto contract)
}

// TestNewMetrics_DefaultRegistryAndHandler is the ONLY test that invokes the
// public NewMetrics(), which registers against the process-global default
// registry. Prometheus panics on duplicate registration, so this must remain a
// single call for the whole package test binary. It doubles as the Handler()
// integration check: the scrape output must surface the series we just wrote.
func TestNewMetrics_DefaultRegistryAndHandler(t *testing.T) {
	m := NewMetrics()
	if m == nil {
		t.Fatal("NewMetrics returned nil")
	}
	m.HTTPRequestsTotal.WithLabelValues("GET", "/handler-probe", "200").Inc()

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()

	h := Handler()
	if h == nil {
		t.Fatal("Handler returned nil")
	}
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("scrape status=%d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/plain") {
		t.Errorf("Content-Type=%q, want prometheus text exposition", ct)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "teslasync_http_requests_total") {
		t.Error("scrape missing teslasync_http_requests_total family")
	}
	if !strings.Contains(body, `endpoint="/handler-probe"`) {
		t.Error("scrape missing the incremented series label")
	}
}

func TestHandler_MethodsAndReuse(t *testing.T) {
	// Handler must be usable across verbs and repeated construction without
	// panicking or returning nil.
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/metrics", nil)
			rec := httptest.NewRecorder()
			Handler().ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Errorf("status=%d, want 200", rec.Code)
			}
		})
	}
}
