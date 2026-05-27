package database

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

type recordTracer struct {
	starts int
	ends   int
}

func (r *recordTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	r.starts++
	return ctx
}
func (r *recordTracer) TraceQueryEnd(_ context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	r.ends++
}

func TestQueryBudgetCount_NoAttachReturnsZero(t *testing.T) {
	if got := QueryBudgetCount(context.Background()); got != 0 {
		t.Fatalf("expected 0 without attach, got %d", got)
	}
}

func TestQueryBudgetCount_CountsStarts(t *testing.T) {
	inner := &recordTracer{}
	tr := newQueryBudgetTracer(inner)
	ctx := AttachQueryBudgetCounter(context.Background())

	for i := 0; i < 3; i++ {
		tr.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "SELECT 1"})
		tr.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})
	}
	if got := QueryBudgetCount(ctx); got != 3 {
		t.Fatalf("expected 3 queries counted, got %d", got)
	}
	if inner.starts != 3 || inner.ends != 3 {
		t.Fatalf("inner tracer should still see all events: starts=%d ends=%d", inner.starts, inner.ends)
	}
}

func TestQueryBudgetCount_SurvivesWithoutCancel(t *testing.T) {
	tr := newQueryBudgetTracer(nil)
	ctx := AttachQueryBudgetCounter(context.Background())

	// Caller emits 1 query
	tr.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "SELECT 1"})

	// Background goroutine pattern: detach lifecycle but keep counter
	bgCtx := context.WithoutCancel(ctx)
	tr.TraceQueryStart(bgCtx, nil, pgx.TraceQueryStartData{SQL: "SELECT 2"})

	if got := QueryBudgetCount(ctx); got != 2 {
		t.Fatalf("WithoutCancel ctx should still share counter; got %d", got)
	}
}

func TestNewCompositeTracer_NonNil(t *testing.T) {
	tr := newCompositeTracer()
	if tr == nil {
		t.Fatal("composite tracer must not be nil")
	}
	// Ensure it still implements pgx.QueryTracer interface (compile-time guard).
	var _ pgx.QueryTracer = tr
}
