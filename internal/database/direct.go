package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// NewDirectConn opens a single persistent connection directly to PostgreSQL,
// bypassing any connection pooler (PgBouncer). Use this for session-level
// features that cannot safely multiplex over a transaction-pooled pool:
//
//   - LISTEN / NOTIFY (requires a persistent backend connection)
//   - Advisory locks held across multiple statements
//   - Temporary tables
//
// The returned *pgx.Conn is not concurrency-safe; callers own its lifecycle
// and must Close it on shutdown.
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
		Msg("direct PostgreSQL connection established (bypasses pooler)")
	return conn, nil
}

// ListenOn issues LISTEN on the given channel and dispatches every received
// notification payload to handler. Blocks until ctx is cancelled or the
// connection fails. Must be called with a connection returned by
// NewDirectConn — pooled connections cannot reliably receive notifications.
func ListenOn(ctx context.Context, conn *pgx.Conn, channel string, handler func(payload string)) error {
	if _, err := conn.Exec(ctx, "LISTEN "+pgx.Identifier{channel}.Sanitize()); err != nil {
		return fmt.Errorf("listen %q: %w", channel, err)
	}
	log.Info().Str("channel", channel).Msg("listening for PostgreSQL notifications")

	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("wait for notification: %w", err)
		}
		handler(notification.Payload)
	}
}
