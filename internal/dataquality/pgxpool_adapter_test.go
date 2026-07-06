// White-box tests for NewScorerFromPool. The nil-pool guard is verified
// directly; the non-nil path builds a real *pgxpool.Pool from a valid DSN
// (pgx v5 defaults MinConns to 0, so New establishes no connection — no
// database or network is touched) and asserts the scorer is wired to a
// pgxPoolAdapter around that pool with the same window-defaulting rule as
// NewScorer. The adapter's Query/Scan/Next/Close/Err methods are thin
// pass-throughs to pgx and are exercised by integration tests against a
// live database, not here.

package dataquality

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newIdlePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	// Valid DSN so ParseConfig succeeds; MinConns defaults to 0 so New
	// returns immediately without dialing. Close stops the background
	// health-check goroutine.
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:5432/db?sslmode=disable")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestNewScorerFromPool_NilReturnsNil(t *testing.T) {
	if got := NewScorerFromPool(nil, 60); got != nil {
		t.Errorf("NewScorerFromPool(nil, 60) = %+v, want nil", got)
	}
	if got := NewScorerFromPool(nil, 0); got != nil {
		t.Errorf("NewScorerFromPool(nil, 0) = %+v, want nil", got)
	}
}

func TestNewScorerFromPool_WiresAdapter(t *testing.T) {
	pool := newIdlePool(t)

	s := NewScorerFromPool(pool, 45)
	if s == nil {
		t.Fatal("NewScorerFromPool returned nil for a non-nil pool")
	}
	if s.windowMins != 45 {
		t.Errorf("windowMins = %d, want 45", s.windowMins)
	}
	adapter, ok := s.pool.(*pgxPoolAdapter)
	if !ok {
		t.Fatalf("scorer.pool is %T, want *pgxPoolAdapter", s.pool)
	}
	if adapter.pool != pool {
		t.Error("adapter does not wrap the provided pool")
	}
	// Snapshot must proceed past the not-configured guard because the
	// Querier is non-nil (it would attempt a real query, so we don't
	// call it here — only assert the interface is populated).
	if s.pool == nil {
		t.Error("scorer.pool must be non-nil so Snapshot does not short-circuit")
	}
}

// Window defaulting must match NewScorer: values <= 0 collapse to 60.
func TestNewScorerFromPool_WindowDefaulting(t *testing.T) {
	pool := newIdlePool(t)
	tests := []struct {
		name string
		in   int
		want int
	}{
		{"zero defaults", 0, 60},
		{"negative defaults", -10, 60},
		{"custom kept", 90, 90},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewScorerFromPool(pool, tt.in)
			if s == nil {
				t.Fatal("unexpected nil scorer")
			}
			if s.windowMins != tt.want {
				t.Errorf("windowMins = %d, want %d", s.windowMins, tt.want)
			}
		})
	}
}
