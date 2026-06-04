// Package metrics defines business SLI gauges and counters.
//
// These metrics track business-critical observability signals beyond the
// generic HTTP RED metrics. Each metric has a documented source and update
// path; helper functions in this file are the canonical way to mutate them
// so wiring stays consistent across packages.
//
// See the business SLI runbook for label vocabulary, recording rules,
// and burn-rate alert templates.
package metrics

import (
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ── Business SLI metrics ───────────────────────────────────

var (
	// TelemetryLagSeconds records the time elapsed (in seconds) between the
	// most recently received signal for a vehicle and the current wall-clock
	// time. It is updated by the periodic refresher started via
	// StartTelemetryLagRefresher() — each tick walks the registered
	// "last seen" timestamps and writes (now - lastSeen) per vehicle.
	//
	// SLO: telemetry_lag_seconds < 60 for any vehicle that is online.
	TelemetryLagSeconds = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "telemetry_lag_seconds",
		Help:      "Seconds since the most recently received telemetry signal for the vehicle. Updated every refresh-interval tick.",
	}, []string{"vehicle_id"})

	// FSMStateCorrectnessRatio is a per-vehicle gauge in [0,1] reflecting
	// the agreement ratio between the FSM's current state and the most
	// recent raw signal (Gear, ChargeState, etc.) for the same vehicle.
	// 1.0 = perfectly consistent on the last reconciliation pass; 0.0 = no
	// raw signal observed yet or fully inconsistent.
	//
	// Source: periodic reconciliation pass — see SetFSMStateCorrectness.
	// SLO: fsm_state_correctness_ratio >= 0.99 over a rolling 5-min window.
	FSMStateCorrectnessRatio = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "fsm_state_correctness_ratio",
		Help:      "Per-vehicle agreement ratio between FSM state and the most recent raw signal. 1.0 = consistent.",
	}, []string{"vehicle_id"})

	// NormalizePipelineThroughput is the moving rate (signals/sec) of
	// the normalize.Pipeline measured over the most recent observation
	// window. Written by SetNormalizePipelineThroughput from the pipeline
	// itself.
	//
	// SLO: > expected baseline (per-deployment) during prod load tests.
	NormalizePipelineThroughput = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "normalize_pipeline_throughput_signals_per_second",
		Help:      "Throughput of the normalize.Pipeline in signals per second over the most recent observation window.",
	})

	// MQTTConsumerBacklog is the number of MQTT messages received but not
	// yet processed end-to-end (decode + route + side effects). Incremented
	// by IncMQTTConsumerBacklog() at receive, decremented by
	// DecMQTTConsumerBacklog() once the pipeline returns. Unbounded growth
	// here is the leading indicator of consumer saturation.
	//
	// SLO: mqtt_consumer_backlog < 100 sustained.
	MQTTConsumerBacklog = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "mqtt_consumer_backlog",
		Help:      "MQTT messages received but not yet fully processed by the pipeline. Leading indicator of consumer saturation.",
	})

	// TeslaAPICircuitBreakerState reflects the current circuit-breaker
	// state per upstream Tesla API endpoint:
	//   0 = closed (normal traffic)
	//   1 = open (failing fast)
	//   2 = half-open (probing)
	// Written by SetTeslaAPICircuitBreakerState from the resilience layer.
	//
	// SLO: tesla_api_circuit_breaker_state == 0 during business hours.
	TeslaAPICircuitBreakerState = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "tesla_api_circuit_breaker_state",
		Help:      "Tesla API circuit breaker state per endpoint (0=closed, 1=open, 2=half-open).",
	}, []string{"endpoint"})
)

// ── Helper update APIs ─────────────────────────────────────

// CircuitBreakerState enumerates the three legal values for the
// TeslaAPICircuitBreakerState gauge.
type CircuitBreakerState int

const (
	CircuitBreakerClosed   CircuitBreakerState = 0
	CircuitBreakerOpen     CircuitBreakerState = 1
	CircuitBreakerHalfOpen CircuitBreakerState = 2
)

// SetTeslaAPICircuitBreakerState updates the breaker state gauge for the
// given upstream Tesla API endpoint.
func SetTeslaAPICircuitBreakerState(endpoint string, state CircuitBreakerState) {
	TeslaAPICircuitBreakerState.WithLabelValues(endpoint).Set(float64(state))
}

// SetFSMStateCorrectness writes the per-vehicle FSM-vs-signal agreement
// ratio. Callers should clamp `ratio` to [0,1].
func SetFSMStateCorrectness(vehicleID string, ratio float64) {
	if ratio < 0 {
		ratio = 0
	} else if ratio > 1 {
		ratio = 1
	}
	FSMStateCorrectnessRatio.WithLabelValues(vehicleID).Set(ratio)
}

// SetNormalizePipelineThroughput writes the current pipeline throughput
// (signals/sec).
func SetNormalizePipelineThroughput(signalsPerSecond float64) {
	NormalizePipelineThroughput.Set(signalsPerSecond)
}

// IncMQTTConsumerBacklog records that one new MQTT message has entered
// the consumer queue.
func IncMQTTConsumerBacklog() {
	MQTTConsumerBacklog.Inc()
}

// DecMQTTConsumerBacklog records that one MQTT message has finished
// processing (success or failure).
func DecMQTTConsumerBacklog() {
	MQTTConsumerBacklog.Dec()
}

// ── Telemetry-lag refresher ────────────────────────────────

var lastSignalSeen sync.Map // key: vehicleID (string), value: time.Time

// RecordSignalReceived stamps the per-vehicle "last seen" timestamp used
// by the TelemetryLagSeconds refresher. Call this from the ingest hot
// path (signal store / live state writer) on every successful sample.
func RecordSignalReceived(vehicleID string, ts time.Time) {
	if vehicleID == "" {
		return
	}
	lastSignalSeen.Store(vehicleID, ts)
}

// refreshTelemetryLag walks every recorded vehicle and writes
// (now - lastSeen) seconds to the gauge. Exported only for tests; the
// production path is the goroutine started by StartTelemetryLagRefresher.
func refreshTelemetryLag(now time.Time) {
	lastSignalSeen.Range(func(k, v any) bool {
		vehicleID, _ := k.(string)
		ts, _ := v.(time.Time)
		if vehicleID == "" {
			return true
		}
		lag := now.Sub(ts).Seconds()
		if lag < 0 {
			lag = 0
		}
		TelemetryLagSeconds.WithLabelValues(vehicleID).Set(lag)
		return true
	})
}

// StartTelemetryLagRefresher launches a goroutine that ticks every
// `interval` and updates the TelemetryLagSeconds gauge for every vehicle
// known to RecordSignalReceived. The goroutine exits when `stop` closes.
//
// Intended to be started once during application bootstrap.
func StartTelemetryLagRefresher(interval time.Duration, stop <-chan struct{}) {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case now := <-t.C:
				refreshTelemetryLag(now)
			}
		}
	}()
}
