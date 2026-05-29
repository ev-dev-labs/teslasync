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
	"sync/atomic"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel/attribute"
)

// queryBudgetCounter is a per-request atomic counter installed at the
// chi middleware boundary. The pgx tracer reads it via the context.
type queryBudgetCounter struct {
	count atomic.Int64
}

type queryBudgetCtxKey struct{}

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
		return t.inner.TraceQueryStart(ctx, conn, data)
	}
	return ctx
}

// TraceQueryEnd forwards to the inner tracer.
func (t *queryBudgetTracer) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryEndData) {
	if t.inner != nil {
		t.inner.TraceQueryEnd(ctx, conn, data)
	}
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
