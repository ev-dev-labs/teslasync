package database

import (
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Compile-time interface checks: verify DBTX is satisfied by both
// *pgxpool.Pool (used outside transactions) and pgx.Tx (used inside).
var (
	_ DBTX = (*pgxpool.Pool)(nil)
	_ DBTX = (pgx.Tx)(nil)
)
