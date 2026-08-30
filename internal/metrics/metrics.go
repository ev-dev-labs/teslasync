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

	// Alert rule engine metrics. Prometheus names retain their legacy series.
	AlertRulesEvaluated = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_evaluated_total",
		Help:      "Total alert rule evaluations",
	})

	AlertRulesFired = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_fired_total",
		Help:      "Alert rules fired by rule name and severity",
	}, []string{"rule_name", "severity"})

	AlertRulesCooldownSkipped = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_cooldown_skipped_total",
		Help:      "Alert rule evaluations skipped due to cooldown",
	})

	AlertRulesSnoozeSkipped = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_snooze_skipped_total",
		Help:      "Alert rule evaluations skipped because the rule is snoozed",
	})

	// AlertRulesMaxFiresCapHit counts rule evaluations suppressed because
	// the rule already hit its `max_fires_per_resolution` cap and the
	// condition has not yet resolved; a falling edge clears the counter.
	AlertRulesMaxFiresCapHit = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_max_fires_cap_hit_total",
		Help:      "Alert rule evaluations suppressed because the per-resolution fire cap was reached",
	})

	// AlertRulesHourlyCapHit counts rule evaluations suppressed by the
	// engine-level safety cap that limits a (rule, vehicle) pair to a
	// fixed number of fires per rolling 1h window. The cap defaults to 4
	// and is overridable by tests via RuleEngine.SetMaxFiresPerHour.
	AlertRulesHourlyCapHit = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "cep_rules_hourly_cap_hit_total",
		Help:      "Alert rule evaluations suppressed because the engine-level hourly fire cap was reached",
	})

	// AlertRulesEscalated counts repeat-mode alert fires promoted to the
	// rule's `escalation_severity` after the condition stays unresolved
	// for at least `escalation_after_min` minutes. It increments once per
	// dispatched escalated alert, not per evaluation or cap-suppressed
	// evaluation.
	AlertRulesEscalated = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "alert_rules_escalated_total",
		Help:      "Alert rule fires promoted to the escalation severity after the configured duration",
	})

	AlertRuleEvalDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "cep_eval_duration_seconds",
		Help:      "Time to evaluate all alert rules for a signal batch",
		Buckets:   []float64{.0001, .0005, .001, .005, .01, .05, .1},
	})

	ActiveAlertRules = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "cep_active_rules",
		Help:      "Number of enabled alert rules currently loaded",
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
	}, []string{"result"}) // success, error, budget_limited, budget_unavailable

	PollsSaved = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "polls_saved_total",
		Help:      "Total polls avoided by optimization strategy",
	}, []string{"reason"}) // fleet_telemetry, idle, prediction, sleep, budget

	PollingBudgetPausedVehicles = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "polling_budget_paused_vehicles",
		Help:      "Current fleet vehicles whose Fleet API polling is paused until the daily budget resets",
	})

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
