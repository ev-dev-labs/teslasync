package admin

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// adminPool is the minimal pgxpool subset the admin repositories need.
//
// It is declared locally so unit tests can supply an in-memory fake without
// adding pgxmock or spinning up PostgreSQL — the same seam the vehicle,
// signal, and drive repos use elsewhere in this tree. The constructors still
// accept a *database.DB and store its concrete *pgxpool.Pool; only the field
// type is widened to this interface, so no exported signature changes.
//
// The compile-time assertion below guards against drift if a future pgx
// release changes one of these method signatures.
type adminPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

var _ adminPool = (*pgxpool.Pool)(nil)
