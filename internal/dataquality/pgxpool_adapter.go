package dataquality

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgxPoolAdapter wraps a *pgxpool.Pool so it satisfies the narrow
// Querier interface used by the Scorer's tests. Keeping the adapter
// in its own file lets the package's unit tests stay decoupled from
// the real pgxpool API.
type pgxPoolAdapter struct {
	pool *pgxpool.Pool
}

// NewScorerFromPool wires a Scorer against a real *pgxpool.Pool.
// windowMins follows the same default-60 rule as NewScorer.
func NewScorerFromPool(pool *pgxpool.Pool, windowMins int) *Scorer {
	if pool == nil {
		return nil
	}
	return NewScorer(&pgxPoolAdapter{pool: pool}, windowMins)
}

func (a *pgxPoolAdapter) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	rows, err := a.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return &pgxRowsAdapter{rows: rows}, nil
}

type pgxRowsAdapter struct {
	rows pgx.Rows
}

func (a *pgxRowsAdapter) Next() bool             { return a.rows.Next() }
func (a *pgxRowsAdapter) Scan(dest ...any) error { return a.rows.Scan(dest...) }
func (a *pgxRowsAdapter) Close()                 { a.rows.Close() }
func (a *pgxRowsAdapter) Err() error             { return a.rows.Err() }
