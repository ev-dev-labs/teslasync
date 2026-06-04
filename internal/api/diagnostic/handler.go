package diagnostic

// Aggregated self-test / diagnostic endpoint.
//
// POST /api/v1/system/diagnostic returns a single DiagnosticReport
// covering the ~10 health signals operators currently have to correlate
// across SystemHealth + ApiLogs + ApiUsage + DBHealth + MqttStatus +
// FleetApi pages. The endpoint is read-only — it never mutates state,
// only probes — so it lives on the existing /system route table behind
// the parent ForwardAuth middleware. No sudo step-up is required.
//
// The report's overall_status is the worst of any individual check's
// status with the standard severity ladder ok < warn < fail. Individual
// checks are run concurrently with a per-check timeout so a single hung
// dependency cannot stall the whole report past the 5 s page budget.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sony/gobreaker"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// Diagnostic status constants for individual checks. Kept lowercase so
// they round-trip cleanly through JSON without case-mapping in the SPA.
const (
	DiagnosticStatusOK   = "ok"
	DiagnosticStatusWarn = "warn"
	DiagnosticStatusFail = "fail"
)

// Diagnostic overall-status constants. The SPA renders these as a single
// hero badge; severity ladder matches the per-check ladder.
const (
	DiagnosticOverallOK       = "ok"
	DiagnosticOverallDegraded = "degraded"
	DiagnosticOverallDown     = "down"
)

// defaultDiagnosticPerCheckTimeout caps each check's wall time. Picked so
// 10 checks running concurrently can collectively beat the 5 s page
// budget even if one stalls — wg.Wait() returns the moment all
// checks finish OR all per-check timeouts fire.
const defaultDiagnosticPerCheckTimeout = 4 * time.Second

var processStartTime = time.Now()

// DiagnosticCheck is one row in a DiagnosticReport. Status is an enum
// (ok|warn|fail). Detail is human-readable; Remediation is optional and
// guides the operator to the next action when Status != ok. DurationMs
// is measured by the runner — checks may set it explicitly to override
// (used by checks that internally batch sub-probes).
type DiagnosticCheck struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Detail      string `json:"detail"`
	Remediation string `json:"remediation,omitempty"`
	DurationMs  int64  `json:"duration_ms"`
}

// DiagnosticReport is the JSON contract for POST /system/diagnostic. The
// SPA renders OverallStatus as a hero badge and Checks as a list of
// cards. GeneratedAt is UTC RFC3339 — the SPA formats it in the user's
// local TZ.
type DiagnosticReport struct {
	GeneratedAt   time.Time         `json:"generated_at"`
	OverallStatus string            `json:"overall_status"`
	Checks        []DiagnosticCheck `json:"checks"`
}

// DiagnosticCheckFn is the unit of work the runner executes. Each check
// receives a derived context with the per-check timeout already applied,
// so individual implementations don't need to wire their own timeouts.
type DiagnosticCheckFn func(ctx context.Context) DiagnosticCheck

// diagnosticPinger is the narrow surface a redis pinger needs to satisfy
// for the redis check. The production *redis.Client implements it
// directly; tests can stub it without dragging in a Redis dependency.
type diagnosticPinger interface {
	Ping(ctx context.Context) *redis.StatusCmd
}

// Handler runs a fixed, ordered list of DiagnosticCheckFn and
// aggregates them into a DiagnosticReport. Construct it once at router
// wire-up; the closure captures the production dependencies.
type Handler struct {
	checks          []DiagnosticCheckFn
	perCheckTimeout time.Duration
	now             func() time.Time
}

// NewHandler wires the production check set against live
// dependencies. Any nil dependency is tolerated — the affected check
// degrades to a "warn" or "fail" with a clear remediation message
// rather than crashing the report.
//
// cfg is currently unused beyond informational labels; reserved for
// future per-deployment thresholds (e.g. signal_log staleness budget).
func NewHandler(
	db *database.DB,
	tc *tesla.Client,
	mqttClient *mqtt.Client,
	cacheStore *cache.Store,
	health *resilience.HealthMonitor,
	cfg *config.Config,
) *Handler {
	h := &Handler{
		perCheckTimeout: defaultDiagnosticPerCheckTimeout,
		now:             func() time.Time { return time.Now().UTC() },
	}
	var pinger diagnosticPinger
	if cacheStore != nil {
		if rdb := cacheStore.Underlying(); rdb != nil {
			pinger = rdb
		}
	}
	// cfg is currently unused beyond the constructor signature. Kept on
	// the parameter list so future per-deployment thresholds (e.g. a
	// custom signal_log staleness budget) can be threaded through
	// without changing every call-site.
	_ = cfg
	h.checks = []DiagnosticCheckFn{
		dbConnectivityCheck(db),
		dbMigrationVersionCheck(db),
		signalLogFreshnessCheck(db),
		teslaTokenCheck(tc),
		teslaCircuitBreakerCheck(tc),
		mqttConnectedCheck(mqttClient),
		redisPingCheck(pinger),
		healthMonitorCheck(health),
		runtimeGoroutineCheck(),
		uptimeCheck(),
	}
	return h
}

// NewHandlerWithChecks is the test-only constructor that
// accepts a pre-built check list. The default constructor wires the
// production set; tests pass deterministic stubs to exercise the
// runner's aggregation, timeout, and ordering semantics in isolation
// from the live dependencies.
func NewHandlerWithChecks(checks []DiagnosticCheckFn, perCheckTimeout time.Duration) *Handler {
	h := &Handler{
		checks:          checks,
		perCheckTimeout: perCheckTimeout,
		now:             func() time.Time { return time.Now().UTC() },
	}
	if h.perCheckTimeout <= 0 {
		h.perCheckTimeout = defaultDiagnosticPerCheckTimeout
	}
	return h
}

// Run executes every registered check concurrently with the per-check
// timeout, preserves the original check order in the output, and
// derives OverallStatus from the worst individual status. Safe to call
// repeatedly; each call gets a fresh GeneratedAt timestamp.
func (h *Handler) Run(ctx context.Context) DiagnosticReport {
	if h == nil {
		return DiagnosticReport{
			GeneratedAt:   time.Now().UTC(),
			OverallStatus: DiagnosticOverallDown,
		}
	}
	n := len(h.checks)
	results := make([]DiagnosticCheck, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i, fn := range h.checks {
		i, fn := i, fn
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, h.perCheckTimeout)
			defer cancel()
			start := time.Now()
			var res DiagnosticCheck
			func() {
				defer func() {
					if rec := recover(); rec != nil {
						res = DiagnosticCheck{
							ID:          fmt.Sprintf("check.%d", i),
							Name:        "unknown",
							Status:      DiagnosticStatusFail,
							Detail:      fmt.Sprintf("panic: %v", rec),
							Remediation: "Inspect server logs for the stack trace and report this as a bug.",
						}
					}
				}()
				res = fn(cctx)
			}()
			if res.DurationMs == 0 {
				res.DurationMs = time.Since(start).Milliseconds()
			}
			results[i] = res
		}()
	}
	wg.Wait()

	overall := DiagnosticOverallOK
	for _, c := range results {
		if c.Status == DiagnosticStatusFail {
			overall = DiagnosticOverallDown
			break
		}
		if c.Status == DiagnosticStatusWarn && overall == DiagnosticOverallOK {
			overall = DiagnosticOverallDegraded
		}
	}
	return DiagnosticReport{
		GeneratedAt:   h.now(),
		OverallStatus: overall,
		Checks:        results,
	}
}

// ServeHTTP fulfils POST /system/diagnostic. The handler is method-
// strict — anything other than POST returns 405 — so the SPA can't
// accidentally trigger a long-running diagnostic from a GET preview.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	report := h.Run(r.Context())
	// Drop any provided body to avoid leaving bytes on the wire when the
	// SPA accidentally sends one. The endpoint takes no parameters.
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&struct{}{})
	}
	httpx.WriteJSON(w, http.StatusOK, report)
}

// ── Production check implementations ────────────────────────────────

// dbConnectivityCheck pings the database with a SELECT 1 round trip.
// Failure here masks every downstream check that touches the DB, so the
// remediation is intentionally specific.
func dbConnectivityCheck(db *database.DB) DiagnosticCheckFn {
	return func(ctx context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "db.connectivity", Name: "Database connectivity"}
		if db == nil {
			c.Status = DiagnosticStatusFail
			c.Detail = "database handle is nil"
			c.Remediation = "Restart the API process — the DB pool failed to initialize at startup."
			return c
		}
		if err := db.Health(ctx); err != nil {
			c.Status = DiagnosticStatusFail
			c.Detail = err.Error()
			c.Remediation = "Check Postgres connectivity, network, and credentials. Inspect docker logs teslasync-timescaledb."
			return c
		}
		c.Status = DiagnosticStatusOK
		c.Detail = "SELECT 1 succeeded"
		return c
	}
}

// dbMigrationVersionCheck reads the schema_migrations row. A "dirty"
// flag means a migration crashed mid-apply and the schema is in an
// indeterminate state — that is always a fail. Missing row means
// migrations have never run; treated as a fail too.
func dbMigrationVersionCheck(db *database.DB) DiagnosticCheckFn {
	return func(ctx context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "db.migration_version", Name: "Database migration version"}
		if db == nil || db.Pool == nil {
			c.Status = DiagnosticStatusFail
			c.Detail = "database handle is nil"
			c.Remediation = "Restart the API process; verify DATABASE_* env vars are set."
			return c
		}
		var version uint
		var dirty bool
		err := db.Pool.QueryRow(ctx, "SELECT version, dirty FROM schema_migrations LIMIT 1").Scan(&version, &dirty)
		if err != nil {
			c.Status = DiagnosticStatusFail
			c.Detail = fmt.Sprintf("read schema_migrations: %v", err)
			c.Remediation = "Run migrations: cmd/teslasync auto-applies on startup; check startup logs for migration errors."
			return c
		}
		if dirty {
			c.Status = DiagnosticStatusFail
			c.Detail = fmt.Sprintf("schema_migrations.dirty = true at version %d", version)
			c.Remediation = "A migration crashed mid-apply. Manually fix the schema then UPDATE schema_migrations SET dirty=false."
			return c
		}
		c.Status = DiagnosticStatusOK
		c.Detail = fmt.Sprintf("at version %d (clean)", version)
		return c
	}
}

// signalLogFreshnessCheck reads max(ts) from signal_log. Telemetry that
// has stopped flowing for >10 minutes is the canonical "no telemetry"
// symptom that operators chase across SystemHealth + MqttStatus today.
// Threshold matches the existing fleet-telemetry-healthy banner.
func signalLogFreshnessCheck(db *database.DB) DiagnosticCheckFn {
	return func(ctx context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "telemetry.signal_log_freshness", Name: "Telemetry freshness (signal_log)"}
		if db == nil || db.Pool == nil {
			c.Status = DiagnosticStatusFail
			c.Detail = "database handle is nil"
			c.Remediation = "DB connectivity check explains the upstream cause."
			return c
		}
		var lastTS *time.Time
		err := db.Pool.QueryRow(ctx, "SELECT MAX(ts) FROM signal_log").Scan(&lastTS)
		if err != nil {
			c.Status = DiagnosticStatusFail
			c.Detail = fmt.Sprintf("query signal_log: %v", err)
			c.Remediation = "Check that signal_log hypertable exists; run pending migrations."
			return c
		}
		if lastTS == nil {
			c.Status = DiagnosticStatusWarn
			c.Detail = "signal_log is empty"
			c.Remediation = "Telemetry has never been ingested on this install. Check Fleet Telemetry config and MQTT broker."
			return c
		}
		age := time.Since(*lastTS)
		switch {
		case age <= 5*time.Minute:
			c.Status = DiagnosticStatusOK
			c.Detail = fmt.Sprintf("most recent signal %s ago", age.Round(time.Second))
		case age <= 30*time.Minute:
			c.Status = DiagnosticStatusWarn
			c.Detail = fmt.Sprintf("most recent signal %s ago", age.Round(time.Second))
			c.Remediation = "Telemetry is stale. Verify the vehicle is awake and the Fleet Telemetry stream is connected."
		default:
			c.Status = DiagnosticStatusFail
			c.Detail = fmt.Sprintf("most recent signal %s ago", age.Round(time.Second))
			c.Remediation = "No telemetry for >30 min. Check MQTT broker status, Fleet Telemetry config, and Tesla token validity."
		}
		return c
	}
}

// teslaTokenCheck probes whether the Tesla Fleet API client currently
// has a valid (non-expired) access token. A no-token state blocks every
// vehicle command + token-refresh cycle.
func teslaTokenCheck(tc *tesla.Client) DiagnosticCheckFn {
	return func(_ context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "tesla.token_valid", Name: "Tesla Fleet API token"}
		if tc == nil {
			c.Status = DiagnosticStatusFail
			c.Detail = "tesla client is nil"
			c.Remediation = "Restart the API process; verify TESLA_CLIENT_ID and TESLA_CLIENT_SECRET are set."
			return c
		}
		if !tc.HasValidToken() {
			c.Status = DiagnosticStatusFail
			c.Detail = "no valid token"
			c.Remediation = "Reconnect the Tesla account at /tesla-account or run the OAuth callback flow."
			return c
		}
		c.Status = DiagnosticStatusOK
		c.Detail = "valid token cached"
		return c
	}
}

// teslaCircuitBreakerCheck reports the breaker state. half-open is a
// degraded state — the breaker is probing the upstream — so we surface
// it as warn rather than fail.
func teslaCircuitBreakerCheck(tc *tesla.Client) DiagnosticCheckFn {
	return func(_ context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "tesla.circuit_breaker", Name: "Tesla API circuit breaker"}
		if tc == nil {
			c.Status = DiagnosticStatusWarn
			c.Detail = "tesla client is nil; cannot read breaker state"
			return c
		}
		state := tc.CircuitBreakerState()
		switch state {
		case gobreaker.StateClosed.String():
			c.Status = DiagnosticStatusOK
			c.Detail = "breaker closed"
		case gobreaker.StateHalfOpen.String():
			c.Status = DiagnosticStatusWarn
			c.Detail = "breaker half-open (probing upstream)"
			c.Remediation = "Tesla API is recovering from previous failures. No action required if traffic is otherwise normal."
		case gobreaker.StateOpen.String():
			c.Status = DiagnosticStatusFail
			c.Detail = "breaker open (upstream calls short-circuited)"
			c.Remediation = "Tesla API is failing repeatedly. Check Tesla service status and recent /system/status output."
		default:
			c.Status = DiagnosticStatusWarn
			c.Detail = fmt.Sprintf("unknown breaker state %q", state)
		}
		return c
	}
}

// mqttConnectedCheck probes the MQTT broker connection. Disconnected
// MQTT means inbound telemetry isn't flowing — fail.
func mqttConnectedCheck(client *mqtt.Client) DiagnosticCheckFn {
	return func(_ context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "mqtt.connected", Name: "MQTT broker connection"}
		if client == nil {
			c.Status = DiagnosticStatusWarn
			c.Detail = "MQTT disabled"
			c.Remediation = "MQTT_ENABLED=false in this deployment. If you expected telemetry streaming, enable MQTT and restart."
			return c
		}
		if !client.IsConnected() {
			c.Status = DiagnosticStatusFail
			c.Detail = "broker not connected"
			c.Remediation = "Check the mosquitto container logs and MQTT_HOST / MQTT_PORT env vars."
			return c
		}
		c.Status = DiagnosticStatusOK
		c.Detail = "broker connected"
		return c
	}
}

// redisPingCheck pings Redis. When cache is in in-memory fallback mode
// we surface that as warn (the install works but missed cross-pod
// features); a real Redis failure to PING is a fail.
func redisPingCheck(pinger diagnosticPinger) DiagnosticCheckFn {
	return func(ctx context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "redis.ping", Name: "Redis cache"}
		if pinger == nil {
			c.Status = DiagnosticStatusWarn
			c.Detail = "Redis disabled (in-memory fallback active)"
			c.Remediation = "Enable Redis (REDIS_ENABLED=true) for cross-pod live state, SSE fanout, and signal cache features."
			return c
		}
		if err := pinger.Ping(ctx).Err(); err != nil {
			c.Status = DiagnosticStatusFail
			c.Detail = fmt.Sprintf("PING: %v", err)
			c.Remediation = "Check the Redis container logs and REDIS_HOST / REDIS_PORT env vars."
			return c
		}
		c.Status = DiagnosticStatusOK
		c.Detail = "PING ok"
		return c
	}
}

// healthMonitorCheck mirrors the resilience HealthMonitor's overall
// summary into the report. Useful as a single "everything else"
// pulse — components like worker tick freshness register themselves
// via health.RecordSuccess/RecordFailure.
func healthMonitorCheck(health *resilience.HealthMonitor) DiagnosticCheckFn {
	return func(_ context.Context) DiagnosticCheck {
		c := DiagnosticCheck{ID: "system.health_monitor", Name: "Resilience HealthMonitor summary"}
		if health == nil {
			c.Status = DiagnosticStatusWarn
			c.Detail = "health monitor not configured"
			return c
		}
		switch health.OverallStatus() {
		case resilience.StatusHealthy:
			c.Status = DiagnosticStatusOK
			c.Detail = "all monitored components healthy"
		case resilience.StatusDegraded:
			c.Status = DiagnosticStatusWarn
			c.Detail = "one or more monitored components degraded"
			c.Remediation = "Open /system-status to see which component is degraded and why."
		case resilience.StatusUnhealthy:
			c.Status = DiagnosticStatusFail
			c.Detail = "one or more monitored components unhealthy"
			c.Remediation = "Open /system-status to see which component failed and inspect its last_error."
		default:
			c.Status = DiagnosticStatusWarn
			c.Detail = "unknown overall status"
		}
		return c
	}
}

// runtimeGoroutineCheck is informational. We surface the count so
// operators can spot a goroutine leak; threshold is generous since
// telemetry + SSE legitimately use many. Fails only at >10000 — well
// past anything healthy.
func runtimeGoroutineCheck() DiagnosticCheckFn {
	return func(_ context.Context) DiagnosticCheck {
		n := runtime.NumGoroutine()
		c := DiagnosticCheck{ID: "runtime.goroutines", Name: "Go runtime goroutines"}
		switch {
		case n > 10000:
			c.Status = DiagnosticStatusFail
			c.Detail = fmt.Sprintf("%d goroutines (suspected leak)", n)
			c.Remediation = "Capture a goroutine pprof: curl /debug/pprof/goroutine?debug=2 and inspect for accumulating stacks."
		case n > 2000:
			c.Status = DiagnosticStatusWarn
			c.Detail = fmt.Sprintf("%d goroutines (elevated)", n)
			c.Remediation = "Likely fine for a busy install. Watch the trend; capture a pprof if it keeps climbing."
		default:
			c.Status = DiagnosticStatusOK
			c.Detail = fmt.Sprintf("%d goroutines", n)
		}
		return c
	}
}

// uptimeCheck reports process uptime. Always ok — surfaced so the
// report carries enough context for support escalation without a
// separate /version round trip.
func uptimeCheck() DiagnosticCheckFn {
	return func(_ context.Context) DiagnosticCheck {
		uptime := time.Since(processStartTime).Round(time.Second)
		return DiagnosticCheck{
			ID:         "runtime.uptime",
			Name:       "Process uptime",
			Status:     DiagnosticStatusOK,
			Detail:     uptime.String(),
			DurationMs: 0,
		}
	}
}
