package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// NewDirectConn opens a single, non-pooled connection that bypasses
// PgBouncer (when configured) and talks to PostgreSQL directly.
//
// Use this for code paths that require a persistent session and would
// break under PgBouncer transaction pooling:
//
//   - LISTEN / NOTIFY  (notification channel is bound to the backend)
//   - Advisory locks held across multiple queries
//   - Temporary tables that must outlive a single statement
//   - Anything relying on session-level SET / SET LOCAL
//
// Callers own the connection and must Close() it on shutdown.
func NewDirectConn(ctx context.Context, cfg config.DatabaseConfig) (*pgx.Conn, error) {
	connCfg, err := pgx.ParseConfig(cfg.DirectDSN())
	if err != nil {
		return nil, fmt.Errorf("parse direct dsn: %w", err)
	}

	conn, err := pgx.ConnectConfig(ctx, connCfg)
	if err != nil {
		return nil, fmt.Errorf("direct connect: %w", err)
	}

	log.Info().
		Str("host", connCfg.Host).
		Uint16("port", connCfg.Port).
		Msg("direct PostgreSQL connection established (bypasses PgBouncer)")

	return conn, nil
}
