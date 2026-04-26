// Package metrics provides all Prometheus metric declarations for TeslaSync.
// This is a standalone package to avoid import cycles between api, polling,
// signal, and worker packages.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ── App Info & Startup ─────────────────────────────────────

var (
	AppInfo = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "app_info",
		Help:      "Application build information (always 1)",
	}, []string{"version", "go_version", "commit"})

	UptimeSeconds = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "uptime_seconds",
		Help:      "Seconds since application startup",
	})

	MigrationVersion = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "migration_version",
		Help:      "Current database migration version",
	})

	StartupDuration = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "startup_duration_seconds",
		Help:      "Time from process start to HTTP server ready",
	})
)

// ── HTTP ───────────────────────────────────────────────────

var (
	HTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "http_requests_total",
		Help:      "Total HTTP requests by method, path, and status code",
	}, []string{"method", "path", "status"})

	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "http_request_duration_seconds",
		Help:      "HTTP request duration in seconds",
		Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	}, []string{"method", "path"})

	HTTPResponseSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "http_response_size_bytes",
		Help:      "HTTP response size in bytes",
		Buckets:   []float64{100, 1000, 10000, 100000, 1000000},
	}, []string{"method", "path"})
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

// ── Database ───────────────────────────────────────────────

var (
	DBQueryDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "db_query_duration_seconds",
		Help:      "Database query duration by operation and table",
		Buckets:   []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 5},
	}, []string{"operation", "table"})

	DBConnectionPoolSize = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "db_pool_connections",
		Help:      "Database connection pool stats",
	}, []string{"state"})

	DBTransactionsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "db_transactions_total",
		Help:      "Total database transactions by result",
	}, []string{"result"})

	WriteBufferDroppedTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "signal_write_buffer_dropped_total",
		Help:      "Total number of entries dropped from write buffer due to overflow",
	}, []string{"buffer_name"})
)

// ── Alerts & Notifications ─────────────────────────────────

var (
	AlertsEvaluated = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "alerts_evaluated_total",
		Help:      "Total alert rule evaluations",
	})

	AlertsFired = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "alerts_fired_total",
		Help:      "Total alerts fired by severity",
	}, []string{"severity"})

	NotificationsSent = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "notifications_sent_total",
		Help:      "Total notifications sent by channel type and result",
	}, []string{"channel_type", "result"})

	// CEP Rule Engine metrics
	CEPRulesEvaluated = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_evaluated_total",
		Help:      "Total CEP rule evaluations (conditions checked)",
	})

	CEPRulesFired = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_fired_total",
		Help:      "CEP rules fired by rule name and severity",
	}, []string{"rule_name", "severity"})

	CEPRulesCooldownSkipped = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_cooldown_skipped_total",
		Help:      "CEP rule evaluations skipped due to cooldown",
	})

	CEPEvalDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "cep_eval_duration_seconds",
		Help:      "Time to evaluate all CEP rules for a signal batch",
		Buckets:   []float64{.0001, .0005, .001, .005, .01, .05, .1},
	})

	CEPActiveRules = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "cep_active_rules",
		Help:      "Number of enabled CEP rules currently loaded",
	})

	NotificationsDispatched = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "notifications_dispatched_total",
		Help:      "Notifications dispatched to worker by channel type",
	}, []string{"channel_type"})
)

// ── API Errors ─────────────────────────────────────────────

var (
	APIErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "api_errors_total",
		Help:      "Total API errors by error code and category",
	}, []string{"code", "category"})

	TeslaAPICallsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "tesla_api_calls_total",
		Help:      "Total Tesla Fleet API calls by endpoint and result",
	}, []string{"endpoint", "result"})
)

// ── Vehicles ───────────────────────────────────────────────

var (
	VehiclesRegistered = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "vehicles_registered",
		Help:      "Total number of registered vehicles",
	})

	VehicleStateGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "vehicles_by_state",
		Help:      "Number of vehicles by state (online, asleep, offline, driving, charging)",
	}, []string{"state"})
)

// ── Geocoding & Addresses ──────────────────────────────────

var (
	GeocodingTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "geocoding_total",
		Help:      "Total geocoding operations by result",
	}, []string{"result"}) // success, failure, cached, geofence

	GeocodingDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "geocoding_duration_seconds",
		Help:      "Reverse geocoding API call duration",
		Buckets:   []float64{.05, .1, .25, .5, 1, 2.5, 5, 10},
	})

	AddressBackfillRemaining = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "address_backfill_remaining",
		Help:      "Drives still needing address geocoding",
	})

	AddressBackfillCompleted = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "address_backfill_completed_total",
		Help:      "Total addresses backfilled since startup",
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
)

// ── Polling & Workers ──────────────────────────────────────

var (
	PollCycleDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "poll_cycle_duration_seconds",
		Help:      "Duration of a vehicle poll cycle",
		Buckets:   []float64{.1, .25, .5, 1, 2.5, 5, 10, 30},
	})

	PollsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "polls_total",
		Help:      "Total vehicle polls by result",
	}, []string{"result"}) // success, error, skipped

	PollsSaved = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "polls_saved_total",
		Help:      "Total polls avoided by optimization strategy",
	}, []string{"reason"}) // fleet_telemetry, idle, prediction, sleep

	ExportJobsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "export_jobs_total",
		Help:      "Total export jobs by status",
	}, []string{"status"}) // pending, running, completed, failed

	MaintenanceRuns = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "maintenance_runs_total",
		Help:      "Total maintenance worker runs",
	})
)

// ── Cache ──────────────────────────────────────────────────

var (
	CacheOperations = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cache_operations_total",
		Help:      "Cache operations by cache type and result",
	}, []string{"cache", "result"}) // cache=redis|memory|places, result=hit|miss

	CacheEntries = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "cache_entries",
		Help:      "Current number of entries in each cache",
	}, []string{"cache"})

	CacheEvictions = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cache_evictions_total",
		Help:      "Total cache evictions by cache type",
	}, []string{"cache"})
)

// ── Auth & Security ────────────────────────────────────────

var (
	AuthAttempts = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "auth_attempts_total",
		Help:      "Total authentication attempts by result",
	}, []string{"result"}) // success, failure

	TokenRefreshes = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "token_refreshes_total",
		Help:      "Total Tesla token refresh attempts by result",
	}, []string{"result"}) // success, failure

	RateLimitExceeded = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "rate_limit_exceeded_total",
		Help:      "Total requests that exceeded rate limits",
	}, []string{"endpoint"})
)

// ── Circuit Breaker ────────────────────────────────────────

var (
	DBCircuitBreakerState = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "db_circuit_breaker_state",
		Help:      "DB circuit breaker state: 0=closed, 1=half-open, 2=open",
	}, []string{"breaker"})
)

// ── Data Freshness & Pipeline ──────────────────────────────

var (
	VehicleLastSeen = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "vehicle_last_seen_seconds",
		Help:      "Seconds since last telemetry received per vehicle",
	}, []string{"vehicle_id"})

	SignalStoreEntries = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "signal_store_entries",
		Help:      "Total entries in the live signal store",
	})

	SignalFlushDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "signal_flush_duration_seconds",
		Help:      "Duration to flush signals from store to database",
		Buckets:   []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1},
	})
)

// ── Business ───────────────────────────────────────────────

var (
	TotalDistanceKm = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "total_distance_km",
		Help:      "Cumulative distance driven across all vehicles (km)",
	})

	TotalEnergyKwh = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "total_energy_kwh",
		Help:      "Cumulative energy added across all charges (kWh)",
	})

	TotalDrives = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "total_drives",
		Help:      "Lifetime count of completed drives",
	})

	TotalCharges = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "total_charges",
		Help:      "Lifetime count of completed charge sessions",
	})

	GeofenceEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "geofence_events_total",
		Help:      "Total geofence events by type",
	}, []string{"type"}) // enter, exit
)

// ── FSM Dispatch ───────────────────────────────────────────

var (
	// FSMDispatchTotal tracks every FSM dispatch attempt by outcome.
	// Labels: "ok", "error", "timeout", "panic"
	FSMDispatchTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "fsm_dispatch_total",
		Help:      "Total FSM dispatch attempts by outcome",
	}, []string{"outcome"})

	// FSMReconcileTotal tracks periodic reconciliation attempts by result.
	// Labels: "corrected", "already_correct", "skipped_confidence", "skipped_fresh", "error"
	FSMReconcileTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "fsm_reconcile_total",
		Help:      "FSM reconciliation attempts by result",
	}, []string{"result"})
)

// ── Reliability ────────────────────────────────────────────

var (
	// PanicsRecovered counts panics caught by recovery wrappers (safeGo,
	// MQTT batch flush timer, etc.). Any non-zero rate indicates a bug.
	PanicsRecovered = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "panics_recovered_total",
		Help:      "Total panics caught by recovery wrappers, labeled by location",
	}, []string{"location"})
)
