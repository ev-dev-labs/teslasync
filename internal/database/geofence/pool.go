package geofence

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// geofencePool is the minimal pgxpool subset the GeofenceRepo needs.
//
// It is declared locally so unit tests can supply an in-memory fake without
// adding pgxmock or standing up PostgreSQL — the same seam the admin, vehicle,
// signal, and drive repos use elsewhere in this tree. NewGeofenceRepo still
// accepts a *database.DB and stores its concrete *pgxpool.Pool; only the field
// type is widened to this interface, so no exported signature changes.
//
// Begin is included because BulkDelete runs its DELETE inside a transaction.
// The compile-time assertion below guards against drift if a future pgx
// release changes one of these method signatures.
type geofencePool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

var _ geofencePool = (*pgxpool.Pool)(nil)
