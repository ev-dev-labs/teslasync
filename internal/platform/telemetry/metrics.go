package telemetry

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics holds the Prometheus metrics used across the application.
type Metrics struct {
	HTTPRequestsTotal    *prometheus.CounterVec
	HTTPRequestDuration  *prometheus.HistogramVec
	TeslaAPICallsTotal   *prometheus.CounterVec
	TeslaAPICallDuration *prometheus.HistogramVec
	FSMTransitionsTotal  *prometheus.CounterVec
	CacheHitsTotal       *prometheus.CounterVec
	CacheMissesTotal     *prometheus.CounterVec
}

// NewMetrics creates and registers all application metrics with the default
// Prometheus registry. It must be called at most once per process because
// Prometheus panics on duplicate metric registration.
func NewMetrics() *Metrics {
	return newMetrics(prometheus.DefaultRegisterer)
}

// newMetrics builds and registers the metric set against the supplied
// registerer. Splitting registration behind an injectable Registerer keeps
// NewMetrics a thin default-registry wrapper while letting tests use an
// isolated *prometheus.Registry, avoiding the global duplicate-registration
// panic and cross-test metric bleed.
func newMetrics(reg prometheus.Registerer) *Metrics {
	factory := promauto.With(reg)
	return &Metrics{
		HTTPRequestsTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "teslasync_http_requests_total",
			Help: "Total HTTP requests",
		}, []string{"method", "endpoint", "status_code"}),

		HTTPRequestDuration: factory.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "teslasync_http_request_duration_seconds",
			Help:    "HTTP request duration in seconds",
			Buckets: prometheus.DefBuckets,
		}, []string{"method", "endpoint"}),

		TeslaAPICallsTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "teslasync_tesla_api_calls_total",
			Help: "Total Tesla API calls",
		}, []string{"endpoint", "status"}),

		TeslaAPICallDuration: factory.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "teslasync_tesla_api_call_duration_seconds",
			Help:    "Tesla API call duration in seconds",
			Buckets: prometheus.DefBuckets,
		}, []string{"endpoint"}),

		FSMTransitionsTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "teslasync_fsm_transitions_total",
			Help: "Total FSM state transitions",
		}, []string{"fsm", "from", "to", "event"}),

		CacheHitsTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "teslasync_cache_hits_total",
			Help: "Total cache hits",
		}, []string{"cache"}),

		CacheMissesTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "teslasync_cache_misses_total",
			Help: "Total cache misses",
		}, []string{"cache"}),
	}
}

// Handler returns the Prometheus metrics HTTP handler.
func Handler() http.Handler {
	return promhttp.Handler()
}
