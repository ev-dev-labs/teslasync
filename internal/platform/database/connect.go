package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
)

// DBTX is an interface satisfied by both *pgxpool.Pool and pgx.Tx,
// allowing repositories to work inside or outside a transaction.
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// pinger is the minimal pgxpool subset Health needs. It is declared locally so
// unit tests can drive the ping success/failure branches with an in-memory fake
// instead of a live PostgreSQL — the same interface seam used by the sibling
// repositories in internal/database/*. *pgxpool.Pool satisfies it in production.
type pinger interface {
	Ping(ctx context.Context) error
}

// txBeginner is the minimal pgxpool subset WithTx needs to open a transaction.
// Declared locally for the same testability reason as pinger; *pgxpool.Pool
// satisfies it in production.
type txBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Compile-time guards so a future pgx release that changes one of these method
// signatures fails loudly here rather than at an injection site.
var (
	_ pinger     = (*pgxpool.Pool)(nil)
	_ txBeginner = (*pgxpool.Pool)(nil)
)

// DB wraps a pgx connection pool.
type DB struct {
	Pool *pgxpool.Pool
}

// MustConnect creates a new database connection pool from the given config.
// It fatally exits if the connection cannot be established.
func MustConnect(ctx context.Context, cfg config.DatabaseConfig) *DB {
	db, err := Connect(ctx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	return db
}

// Connect creates a new database connection pool and verifies connectivity.
func Connect(ctx context.Context, cfg config.DatabaseConfig) (*DB, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parsing database DSN: %w", err)
	}

	poolCfg.MaxConns = int32(cfg.MaxConns)
	poolCfg.MinConns = int32(cfg.MinConns)
	poolCfg.MaxConnLifetime = cfg.ConnMaxLifetime
	poolCfg.MaxConnIdleTime = cfg.ConnMaxIdleTime
	poolCfg.HealthCheckPeriod = 15 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("creating connection pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	stats := pool.Stat()
	log.Info().
		Str("host", cfg.Host).
		Int("max_conns", cfg.MaxConns).
		Int32("idle_conns", stats.IdleConns()).
		Msg("database connected")

	return &DB{Pool: pool}, nil
}

// Close shuts down the connection pool.
func (db *DB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
	}
}

// Health checks database connectivity with a 3-second deadline.
func (db *DB) Health(ctx context.Context) error {
	return healthPing(ctx, db.Pool)
}

// healthPing pings p under a 3-second deadline derived from ctx. Extracted so
// the timeout/error behaviour can be unit tested against a fake pinger.
func healthPing(ctx context.Context, p pinger) error {
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return p.Ping(checkCtx)
}

// WithTx executes fn within a database transaction.
// It commits on success and rolls back on error or panic.
func (db *DB) WithTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return withTx(ctx, db.Pool, fn)
}

// withTx runs fn inside a transaction opened from pool, committing on success
// and rolling back on error or panic. Extracted so every branch (begin error,
// fn error, panic, commit) can be unit tested against a fake txBeginner.
func withTx(ctx context.Context, pool txBeginner, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("beginning transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}

	return tx.Commit(ctx)
}

// Stats returns current connection pool statistics.
func (db *DB) Stats() map[string]interface{} {
	s := db.Pool.Stat()
	return map[string]interface{}{
		"total_conns":    s.TotalConns(),
		"idle_conns":     s.IdleConns(),
		"acquired_conns": s.AcquiredConns(),
		"max_conns":      s.MaxConns(),
	}
}
