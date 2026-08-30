// Package metrics provides all Prometheus metric declarations for TeslaSync.
// This is a standalone package to avoid import cycles between api, polling,
// signal, and worker packages.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ── Telemetry ──────────────────────────────────────────────

var (
	TelemetrySignalsProcessed = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "telemetry_signals_processed_total",
		Help:      "Total telemetry signals processed by signal name",
	}, []string{"signal"})

	TelemetryMessagesReceived = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "telemetry_messages_received_total",
		Help:      "Total MQTT telemetry messages received",
	})

	TelemetryProcessingDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "telemetry_processing_duration_seconds",
		Help:      "Time to process a telemetry message batch",
		Buckets:   []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1},
	})

	ActiveStreamingVehicles = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "streaming_vehicles_active",
		Help:      "Number of vehicles currently streaming telemetry",
	})
)

// ── MQTT & SSE Connections ─────────────────────────────────

var (
	MQTTConnected = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "mqtt_connected",
		Help:      "Whether MQTT broker is connected (1=yes, 0=no)",
	})

	MQTTMessagesPublished = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "mqtt_messages_published_total",
		Help:      "Total MQTT messages published",
	})

	MQTTReconnects = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "mqtt_reconnects_total",
		Help:      "Total MQTT reconnection attempts",
	})

	MQTTPipelineConnected = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "mqtt_pipeline_connected",
		Help:      "Whether the dedicated Fleet Telemetry MQTT consumer is connected to the broker (1=yes, 0=no)",
	}, []string{"consumer"})

	MQTTPipelineSubscribed = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "mqtt_pipeline_subscribed",
		Help:      "Whether the dedicated Fleet Telemetry MQTT consumer has an acknowledged active subscription (1=yes, 0=no)",
	}, []string{"consumer"})

	MQTTPipelineSubscriptionAttempts = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "mqtt_pipeline_subscription_attempts_total",
		Help:      "Fleet Telemetry MQTT subscription attempts by trigger and result",
	}, []string{"trigger", "result"})

	MQTTPipelineSubscriptionLastSuccess = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "mqtt_pipeline_subscription_last_success_timestamp_seconds",
		Help:      "Unix timestamp of the last successful Fleet Telemetry MQTT SUBACK",
	}, []string{"consumer"})

	MQTTPipelineLivenessUnhealthySeconds = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "mqtt_pipeline_liveness_unhealthy_seconds",
		Help:      "Seconds the Fleet Telemetry consumer has been unhealthy while the broker is independently reachable",
	}, []string{"consumer"})

	MQTTTelemetryEventTime = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "mqtt_telemetry_event_time_total",
		Help:      "Fleet Telemetry messages by bounded event-time outcome: source, receipt_fallback, rejected_missing, or rejected_invalid",
	}, []string{"outcome"})

	MQTTTelemetryReplayLag = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "mqtt_telemetry_replay_lag_seconds",
		Help:      "Elapsed seconds between Tesla source emission and MQTT receipt",
		Buckets:   []float64{0.1, 1, 5, 30, 60, 300, 3600, 21600, 86400, 604800, 2592000},
	})

	SSEConnectionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "sse_connections_active",
		Help:      "Number of active SSE client connections",
	})

	SSEEventsSent = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "sse_events_sent_total",
		Help:      "Total SSE events sent by event type",
	}, []string{"event_type"})

	SSEEventsDropped = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "sse_events_dropped_total",
		Help:      "Total SSE events dropped due to full client buffer",
	}, []string{"event_type"})

	SSEConnectionsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "sse_connections_total",
		Help:      "Total SSE connections established since startup",
	})

	SSEBroadcastDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "sse_broadcast_duration_seconds",
		Help:      "Time spent broadcasting SSE events to all clients",
		Buckets:   []float64{0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1},
	})

	SSEBytesSent = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "sse_bytes_sent_total",
		Help:      "Total bytes sent via SSE connections",
	})

	SSEClientBufferSaturationRatio = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "sse_client_buffer_saturation_ratio",
		Help:      "Highest current occupancy ratio among connected SSE client buffers, from 0 (empty) to 1 (full)",
	})
)
