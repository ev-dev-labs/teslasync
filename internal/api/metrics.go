package api

import (
	"fmt"
	"net/http"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	vehiclesPolled = promauto.NewCounter(prometheus.CounterOpts{
		Name: "teslasync_vehicles_polled_total",
		Help: "Total number of vehicle polls",
	})
	pollErrors = promauto.NewCounter(prometheus.CounterOpts{
		Name: "teslasync_poll_errors_total",
		Help: "Total number of poll errors",
	})
	activeVehicles = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "teslasync_active_vehicles",
		Help: "Number of active vehicles",
	})
	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "teslasync_http_request_duration_seconds",
		Help:    "HTTP request duration in seconds",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path", "status"})
	alertsCreated = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "teslasync_alerts_created_total",
		Help: "Total alerts created by type",
	}, []string{"type", "severity"})
	chargingEnergy = promauto.NewCounter(prometheus.CounterOpts{
		Name: "teslasync_charging_energy_kwh_total",
		Help: "Total charging energy in kWh",
	})
	requestSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "teslasync_http_request_size_bytes",
		Help:    "HTTP request size in bytes",
		Buckets: []float64{100, 1000, 10000, 100000, 1000000},
	}, []string{"method"})
	responseSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "teslasync_http_response_size_bytes",
		Help:    "HTTP response size in bytes",
		Buckets: []float64{100, 1000, 10000, 100000, 1000000},
	}, []string{"method"})
)

// MetricsMiddleware records HTTP request duration and request/response sizes.
func MetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		if r.ContentLength > 0 {
			requestSize.WithLabelValues(r.Method).Observe(float64(r.ContentLength))
		}

		next.ServeHTTP(ww, r)

		duration := time.Since(start).Seconds()
		httpRequestDuration.WithLabelValues(r.Method, r.URL.Path, fmt.Sprintf("%d", ww.Status())).Observe(duration)
		responseSize.WithLabelValues(r.Method).Observe(float64(ww.BytesWritten()))
	})
}
