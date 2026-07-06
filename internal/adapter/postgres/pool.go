package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgxPool is the minimal subset of *pgxpool.Pool that the repository adapters
// depend on. Depending on this interface rather than the concrete pool keeps
// the repositories unit-testable with a scripted fake, mirroring the
// unlockQuerier seam precedent in internal/database/achievement. The exported
// constructors still accept a concrete *pgxpool.Pool, so no public signature or
// wiring changes: *pgxpool.Pool satisfies pgxPool.
type pgxPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Compile-time proof that the production pool implements the seam.
var _ pgxPool = (*pgxpool.Pool)(nil)
