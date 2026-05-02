// Package metrics provides all Prometheus metric declarations for TeslaSync.
// This is a standalone package to avoid import cycles between api, polling,
// signal, and worker packages.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ── Sessions ───────────────────────────────────────────────

var (
	DriveSessionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "drive_sessions_active",
		Help:      "Number of currently active drive sessions",
	})

	DriveSessionsCompleted = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "drive_sessions_completed_total",
		Help:      "Total drive sessions completed",
	})

	ChargeSessionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "charge_sessions_active",
		Help:      "Number of currently active charge sessions",
	})

	ChargeSessionsCompleted = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "charge_sessions_completed_total",
		Help:      "Total charge sessions completed",
	})

	TelemetryBufferSize = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "telemetry_buffer_size",
		Help:      "Number of telemetry readings buffered for retry during DB outages",
	}, []string{"type"})

	TelemetryBufferDropped = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "telemetry_buffer_dropped_total",
		Help:      "Total telemetry readings dropped due to buffer overflow",
	}, []string{"type"})
)
