package database

// Query budget tracer for HTTP request accounting.
//
// queryBudgetTracer wraps another pgx.QueryTracer (here: otelpgx) and
// increments a per-context query counter. The chi middleware records
// the counter at request start, computes the delta at request end,
// and emits a structured warning when the count exceeds the route's
// declared budget.
//
// The counter lives in the context via a private key — every
// goroutine spawned with WithoutCancel(ctx) keeps the same counter,
// which is the correct semantic: a background fanout that issues 50
// queries should still surface as exceeding the budget of the
// originating request.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const slowQueryThreshold = time.Second

var (
	repositoryQueryDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "query_duration_seconds",
		Help:      "Duration of PostgreSQL queries observed through the shared pool.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"operation", "status"})
	repositorySlowQueries = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "slow_queries_total",
		Help:      "PostgreSQL queries taking at least one second.",
	}, []string{"operation"})
	repositoryReturnedRows = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "returned_rows_total",
		Help:      "Rows reported by PostgreSQL command tags where available.",
	}, []string{"operation"})
	databasePoolConnections = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "pool_connections",
		Help:      "Current PostgreSQL pool connection counts by bounded state.",
	}, []string{"state"})
	databasePoolUtilization = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "pool_utilization_ratio",
		Help:      "Fraction of configured PostgreSQL connections currently acquired.",
	})
	databasePoolEmptyAcquires = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "pool_empty_acquire_count",
		Help:      "Cumulative PostgreSQL pool acquires that had to wait for a connection.",
	})
	databasePoolCanceledAcquires = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "pool_canceled_acquire_count",
		Help:      "Cumulative PostgreSQL pool acquires canceled before a connection was obtained.",
	})
	databasePoolEmptyAcquireWait = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "pool_empty_acquire_wait_seconds",
		Help:      "Cumulative time spent waiting because the PostgreSQL pool had no idle connection.",
	})
	databasePoolAcquireDuration = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "database",
		Name:      "pool_acquire_duration_seconds",
		Help:      "Cumulative time spent acquiring PostgreSQL connections.",
	})
)

// queryBudgetCounter is a per-request atomic counter installed at the
// chi middleware boundary. The pgx tracer reads it via the context.
type queryBudgetCounter struct {
	count atomic.Int64
}

type queryBudgetCtxKey struct{}
type queryMetricsCtxKey struct{}
type queryPerformanceCtxKey struct{}

type queryMetrics struct {
	operation string
	startedAt time.Time
	debug     *queryPerformanceDetails
}

type queryPerformanceDetails struct {
	fingerprint string
	statement   string
}

// QueryPerformance is a debug-only per-query measurement. RowsScannedEstimate
// is nil because pgx does not expose scanned rows at execution time;
// capture those separately with EXPLAIN ANALYZE.
type QueryPerformance struct {
	Operation           string  `json:"operation"`
	Fingerprint         string  `json:"fingerprint"`
	Statement           string  `json:"statement"`
	DurationMS          float64 `json:"duration_ms"`
	RowsReturned        int64   `json:"rows_returned"`
	RowsScannedEstimate *int64  `json:"rows_scanned_estimate"`
}

// QueryPerformanceSnapshot is the aggregate database portion of one debug
// request measurement.
type QueryPerformanceSnapshot struct {
	QueryCount          int                `json:"query_count"`
	QueryTimeMS         float64            `json:"query_time_ms"`
	RowsReturned        int64              `json:"rows_returned"`
	RowsScannedEstimate *int64             `json:"rows_scanned_estimate"`
	Queries             []QueryPerformance `json:"queries"`
}

type queryPerformanceCollector struct {
	mu      sync.Mutex
	queries []QueryPerformance
}

// AttachQueryBudgetCounter installs a fresh counter in ctx. Called by
// the chi middleware. Safe to call when the http layer is bypassed
// (e.g. workers) — every pgx call that doesn't find a counter is a
// no-op, costing one map lookup.
func AttachQueryBudgetCounter(ctx context.Context) context.Context {
	return context.WithValue(ctx, queryBudgetCtxKey{}, &queryBudgetCounter{})
}

// QueryBudgetCount returns the number of queries observed against the
// counter in ctx. Returns 0 when no counter is attached.
func QueryBudgetCount(ctx context.Context) int64 {
	c, _ := ctx.Value(queryBudgetCtxKey{}).(*queryBudgetCounter)
	if c == nil {
		return 0
	}
	return c.count.Load()
}

// AttachQueryPerformanceCollector enables detailed query measurements for one
// explicitly opted-in debug request. Normal production requests do not attach
// a collector, so the tracer performs only a context lookup.
func AttachQueryPerformanceCollector(ctx context.Context) context.Context {
	return context.WithValue(ctx, queryPerformanceCtxKey{}, &queryPerformanceCollector{})
}

// QueryPerformanceMetrics returns a stable copy of the collected measurements.
func QueryPerformanceMetrics(ctx context.Context) QueryPerformanceSnapshot {
	collector, _ := ctx.Value(queryPerformanceCtxKey{}).(*queryPerformanceCollector)
	if collector == nil {
		return QueryPerformanceSnapshot{}
	}
	collector.mu.Lock()
	defer collector.mu.Unlock()

	snapshot := QueryPerformanceSnapshot{
		QueryCount: len(collector.queries),
		Queries:    append([]QueryPerformance(nil), collector.queries...),
	}
	for _, query := range snapshot.Queries {
		snapshot.QueryTimeMS += query.DurationMS
		snapshot.RowsReturned += query.RowsReturned
	}
	return snapshot
}

// queryBudgetTracer wraps another pgx.QueryTracer and increments the
// per-context counter on every TraceQueryStart.
type queryBudgetTracer struct {
	inner pgx.QueryTracer
}

func newQueryBudgetTracer(inner pgx.QueryTracer) *queryBudgetTracer {
	return &queryBudgetTracer{inner: inner}
}

// TraceQueryStart forwards to the inner tracer and increments the
// per-context counter.
func (t *queryBudgetTracer) TraceQueryStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if c, _ := ctx.Value(queryBudgetCtxKey{}).(*queryBudgetCounter); c != nil {
		c.count.Add(1)
	}
	if t.inner != nil {
		ctx = t.inner.TraceQueryStart(ctx, conn, data)
	}
	var debug *queryPerformanceDetails
	if _, enabled := ctx.Value(queryPerformanceCtxKey{}).(*queryPerformanceCollector); enabled {
		debug = &queryPerformanceDetails{
			fingerprint: queryFingerprint(data.SQL),
			statement:   normalizedQuery(data.SQL),
		}
	}
	return context.WithValue(ctx, queryMetricsCtxKey{}, queryMetrics{
		operation: queryOperation(data.SQL),
		startedAt: time.Now(),
		debug:     debug,
	})
}

// TraceQueryEnd forwards to the inner tracer and records low-cardinality
// repository metrics. Command-tag rows are the only portable row count pgx
// exposes at this boundary, so the metric deliberately reports rows only
// where PostgreSQL supplies them.
func (t *queryBudgetTracer) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryEndData) {
	if metric, ok := ctx.Value(queryMetricsCtxKey{}).(queryMetrics); ok {
		duration := time.Since(metric.startedAt)
		status := "success"
		if data.Err != nil {
			status = "error"
		}
		repositoryQueryDuration.WithLabelValues(metric.operation, status).Observe(duration.Seconds())
		if duration >= slowQueryThreshold {
			repositorySlowQueries.WithLabelValues(metric.operation).Inc()
		}
		if rows := data.CommandTag.RowsAffected(); rows > 0 {
			repositoryReturnedRows.WithLabelValues(metric.operation).Add(float64(rows))
		}
		if collector, ok := ctx.Value(queryPerformanceCtxKey{}).(*queryPerformanceCollector); ok && metric.debug != nil {
			collector.mu.Lock()
			collector.queries = append(collector.queries, QueryPerformance{
				Operation:    metric.operation,
				Fingerprint:  metric.debug.fingerprint,
				Statement:    metric.debug.statement,
				DurationMS:   float64(duration.Microseconds()) / 1000,
				RowsReturned: data.CommandTag.RowsAffected(),
			})
			collector.mu.Unlock()
		}
	}
	if t.inner != nil {
		t.inner.TraceQueryEnd(ctx, conn, data)
	}
}

func queryFingerprint(sql string) string {
	normalized := normalizedQuery(sql)
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:8])
}

func normalizedQuery(sql string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(sql)), " ")
}

func queryOperation(sql string) string {
	fields := strings.Fields(strings.TrimSpace(sql))
	if len(fields) == 0 {
		return "other"
	}
	switch strings.ToLower(fields[0]) {
	case "select", "insert", "update", "delete":
		return strings.ToLower(fields[0])
	default:
		return "other"
	}
}

// observePoolStats records pool pressure when a DB health or diagnostics
// surface inspects the pool. Labels are a fixed vocabulary so connection
// pressure is observable without attaching a tenant, route, or vehicle ID.
func observePoolStats(s *pgxpool.Stat) {
	if s == nil {
		return
	}
	databasePoolConnections.WithLabelValues("total").Set(float64(s.TotalConns()))
	databasePoolConnections.WithLabelValues("idle").Set(float64(s.IdleConns()))
	databasePoolConnections.WithLabelValues("acquired").Set(float64(s.AcquiredConns()))
	databasePoolConnections.WithLabelValues("max").Set(float64(s.MaxConns()))
	databasePoolConnections.WithLabelValues("constructing").Set(float64(s.ConstructingConns()))
	if max := s.MaxConns(); max > 0 {
		databasePoolUtilization.Set(float64(s.AcquiredConns()) / float64(max))
	} else {
		databasePoolUtilization.Set(0)
	}
	databasePoolEmptyAcquires.Set(float64(s.EmptyAcquireCount()))
	databasePoolCanceledAcquires.Set(float64(s.CanceledAcquireCount()))
	databasePoolEmptyAcquireWait.Set(s.EmptyAcquireWaitTime().Seconds())
	databasePoolAcquireDuration.Set(s.AcquireDuration().Seconds())
}

// newCompositeTracer returns the otelpgx + queryBudget composite that
// configurePoolTracing should install. Exported with lowercase name
// because configurePoolTracing is the only legitimate caller.
func newCompositeTracer() pgx.QueryTracer {
	inner := otelpgx.NewTracer(
		otelpgx.WithTracerAttributes(attribute.String("db.system", "postgresql")),
		otelpgx.WithSpanNameFunc(pgSpanName),
	)
	return newQueryBudgetTracer(inner)
}
