package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// DBTX is an interface satisfied by both *pgxpool.Pool and pgx.Tx,
// allowing repos to work inside or outside a transaction.
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// DB wraps a pgx connection pool and provides repository methods.
type DB struct {
	Pool         *pgxpool.Pool
	WriteBreaker *DBCircuitBreaker
}

// New creates a new database connection pool from the given config, verifies
// connectivity with a 10-second ping, and returns the wrapped pool. The caller
// should defer DB.Close to release connections on shutdown.
func New(ctx context.Context, cfg config.DatabaseConfig) (*DB, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}

	poolCfg.MaxConns = int32(cfg.MaxConns)
	poolCfg.MinConns = int32(cfg.MinConns)
	poolCfg.MaxConnLifetime = cfg.ConnMaxLifetime
	poolCfg.MaxConnIdleTime = cfg.ConnMaxIdleTime
	poolCfg.HealthCheckPeriod = cfg.HealthCheckPeriod

	configurePoolTracing(poolCfg)

	// Validate new connections by setting per-connection statement_timeout as safety net
	stmtTimeout := cfg.StatementTimeout
	poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, fmt.Sprintf("SET statement_timeout = '%dms'", stmtTimeout))
		if err != nil {
			log.Warn().Err(err).Msg("failed to set statement_timeout on new connection")
		}
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// Verify connectivity with a deadline
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	stats := pool.Stat()
	observePoolStats(stats)
	log.Info().
		Str("host", cfg.Host).
		Int("max_conns", cfg.MaxConns).
		Int32("total_conns", stats.TotalConns()).
		Int32("idle_conns", stats.IdleConns()).
		Int("connect_timeout_s", cfg.ConnectTimeout).
		Int("statement_timeout_ms", cfg.StatementTimeout).
		Dur("health_check_period", cfg.HealthCheckPeriod).
		Msg("database connected")
	return &DB{
		Pool:         pool,
		WriteBreaker: NewDBCircuitBreaker("writes"),
	}, nil
}

func configurePoolTracing(poolCfg *pgxpool.Config) {
	if poolCfg == nil || poolCfg.ConnConfig == nil {
		return
	}
	poolCfg.ConnConfig.Tracer = newCompositeTracer()
}

func pgSpanName(stmt string) string {
	op := strings.ToLower(strings.Fields(strings.TrimSpace(stmt) + " query")[0])
	return "pg." + op
}

// Close shuts down the connection pool.
func (db *DB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
	}
}

// Migrate applies pending database migrations from the given path
// (e.g. "file://migrations") using golang-migrate.
// Uses MigrationDSN() which excludes statement_timeout so pg_advisory_lock
// can wait indefinitely without being killed.
func (db *DB) Migrate(migrationsPath string, cfg config.DatabaseConfig) error {
	return runMigrations(cfg.MigrationDSN(), migrationsPath)
}

// Health checks database connectivity with a 3-second deadline.
// Returns nil if the database is reachable, or an error otherwise.
func (db *DB) Health(ctx context.Context) error {
	ctx, span := tracing.DBSpan(ctx, "ping", "")
	defer span.End()
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	err := db.Pool.Ping(checkCtx)
	observePoolStats(db.Pool.Stat())
	if err != nil {
		tracing.EndSpan(span, err)
	}
	return err
}

// WithTx executes fn within a database transaction.
// It commits on success and rolls back on error or panic.
func (db *DB) WithTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	ctx, span := tracing.TxSpan(ctx, "transaction")
	defer span.End()

	tx, err := db.Pool.Begin(ctx)
	observePoolStats(db.Pool.Stat())
	if err != nil {
		tracing.EndSpan(span, err)
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		tracing.EndSpan(span, err)
		return err
	}

	return tx.Commit(ctx)
}

// Stats returns current connection pool statistics for monitoring.
func (db *DB) Stats() map[string]interface{} {
	s := db.Pool.Stat()
	observePoolStats(s)
	return map[string]interface{}{
		"total_conns":    s.TotalConns(),
		"idle_conns":     s.IdleConns(),
		"acquired_conns": s.AcquiredConns(),
		"max_conns":      s.MaxConns(),
		"constructing":   s.ConstructingConns(),
	}
}

// PoolStats returns extended connection pool health information including
// acquire counters useful for diagnosing connection exhaustion.
func (db *DB) PoolStats() map[string]interface{} {
	s := db.Pool.Stat()
	observePoolStats(s)
	return map[string]interface{}{
		"total_conns":            s.TotalConns(),
		"idle_conns":             s.IdleConns(),
		"acquired_conns":         s.AcquiredConns(),
		"constructing_conns":     s.ConstructingConns(),
		"max_conns":              s.MaxConns(),
		"acquire_count":          s.AcquireCount(),
		"acquire_duration_ms":    s.AcquireDuration().Milliseconds(),
		"empty_acquire_count":    s.EmptyAcquireCount(),
		"empty_acquire_wait_ms":  s.EmptyAcquireWaitTime().Milliseconds(),
		"canceled_acquire_count": s.CanceledAcquireCount(),
	}
}
