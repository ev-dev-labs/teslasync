package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/config"
)

// DB wraps a pgx connection pool and provides repository methods.
type DB struct {
	Pool *pgxpool.Pool
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
	poolCfg.HealthCheckPeriod = 15 * time.Second

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

// Migrate applies pending database migrations from the given path
// (e.g. "file://migrations") using golang-migrate.
func (db *DB) Migrate(migrationsPath string) error {
	connStr := db.Pool.Config().ConnConfig.ConnString()
	return runMigrations(connStr, migrationsPath)
}

// Health checks database connectivity with a 3-second deadline.
// Returns nil if the database is reachable, or an error otherwise.
func (db *DB) Health(ctx context.Context) error {
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return db.Pool.Ping(checkCtx)
}

// Stats returns current connection pool statistics for monitoring.
func (db *DB) Stats() map[string]interface{} {
	s := db.Pool.Stat()
	return map[string]interface{}{
		"total_conns":    s.TotalConns(),
		"idle_conns":     s.IdleConns(),
		"acquired_conns": s.AcquiredConns(),
		"max_conns":      s.MaxConns(),
		"constructing":   s.ConstructingConns(),
	}
}
