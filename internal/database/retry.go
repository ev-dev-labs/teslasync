package database

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog/log"
)

// DBRetryConfig returns retry settings tuned for DB flush operations.
// 3 attempts, 200ms → 500ms → 1s backoff with jitter.
func DBRetryConfig() dbRetryConfig {
	return dbRetryConfig{
		MaxAttempts: 3,
		InitialWait: 200 * time.Millisecond,
		MaxWait:     1 * time.Second,
		Multiplier:  2.5,
	}
}

type dbRetryConfig struct {
	MaxAttempts int
	InitialWait time.Duration
	MaxWait     time.Duration
	Multiplier  float64
}

// IsTransient returns true for errors that are likely to succeed on retry:
//   - connection reset/refused/timeout
//   - context deadline exceeded (but NOT context cancelled — that's intentional shutdown)
//   - Postgres Class 08 (connection exceptions)
//   - Postgres Class 53 (insufficient resources)
//   - Postgres Class 57 (operator intervention — e.g. restart)
func IsTransient(err error) bool {
	if err == nil {
		return false
	}

	// Context deadline = transient (server slow); context cancelled = intentional
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if errors.Is(err, context.Canceled) {
		return false
	}

	// pgx-specific connection errors
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && len(pgErr.Code) >= 2 {
		prefix := pgErr.Code[:2]
		switch prefix {
		case "08": // connection_exception
			return true
		case "53": // insufficient_resources
			return true
		case "57": // operator_intervention (e.g. admin_shutdown)
			return true
		}
	}

	// Network-level errors (connection refused, reset, etc.)
	// pgx wraps these — check the error string as fallback
	msg := err.Error()
	for _, substr := range []string{
		"connection refused",
		"connection reset",
		"broken pipe",
		"no such host",
		"i/o timeout",
		"connection timed out",
	} {
		if strings.Contains(msg, substr) {
			return true
		}
	}

	return false
}

// RetryOnTransient executes fn with retry only for transient DB errors.
// Non-transient errors (constraint violations, syntax errors) fail immediately.
func RetryOnTransient(ctx context.Context, name string, fn func(ctx context.Context) error) error {
	cfg := DBRetryConfig()
	var lastErr error
	wait := cfg.InitialWait

	for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
		lastErr = fn(ctx)
		if lastErr == nil {
			if attempt > 1 {
				log.Info().Str("operation", name).Int("attempt", attempt).Msg("DB operation succeeded after retry")
			}
			return nil
		}
		if !IsTransient(lastErr) {
			return lastErr // non-transient — fail immediately
		}
		if attempt == cfg.MaxAttempts {
			break
		}
		if ctx.Err() != nil {
			return lastErr
		}

		log.Warn().Err(lastErr).Str("operation", name).Int("attempt", attempt).Int("max", cfg.MaxAttempts).Dur("next_wait", wait).Msg("retrying DB operation after transient failure")

		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return lastErr
		}
		wait = time.Duration(float64(wait) * cfg.Multiplier)
		if wait > cfg.MaxWait {
			wait = cfg.MaxWait
		}
	}
	return lastErr
}
