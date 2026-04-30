package database

import (
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// DBCircuitBreaker wraps gobreaker for database write operations.
// Opens after consecutive transient failures, preventing goroutine accumulation
// during Postgres outages.
type DBCircuitBreaker struct {
	cb *gobreaker.CircuitBreaker
}

// NewDBCircuitBreaker creates a circuit breaker for DB writes.
//
// Behavior:
//   - Closed (normal): all writes go through
//   - Open (after 5 consecutive transient failures): writes fail-fast for 15s
//   - Half-Open (after 15s): allows 1 probe write; success closes, failure re-opens
//
// Only transient/connectivity errors trip the breaker. Non-transient errors
// (constraint violations, syntax errors) pass through without affecting state.
func NewDBCircuitBreaker(name string) *DBCircuitBreaker {
	fullName := fmt.Sprintf("db-%s", name)
	cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
		Name:        fullName,
		MaxRequests: 1,               // half-open: let 1 request through to probe
		Interval:    30 * time.Second, // rolling window for failure count
		Timeout:     15 * time.Second, // how long to stay open before half-open
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= config.CBFailureThreshold
		},
		IsSuccessful: func(err error) bool {
			if err == nil {
				return true
			}
			// Only transient/connectivity errors count as breaker failures.
			// Non-transient errors (constraint violations, data issues) should
			// not trip the breaker — they won't resolve by waiting.
			return !IsTransient(err)
		},
		OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
			metrics.DBCircuitBreakerState.WithLabelValues(name).Set(float64(to))
			log.Warn().
				Str("breaker", name).
				Str("from", from.String()).
				Str("to", to.String()).
				Msg("DB circuit breaker state change")
		},
	})

	// Initialize gauge to closed (0) so Prometheus has a sample from startup
	metrics.DBCircuitBreakerState.WithLabelValues(fullName).Set(0)

	return &DBCircuitBreaker{cb: cb}
}

// Execute runs fn through the circuit breaker.
// Returns gobreaker.ErrOpenState if the breaker is open (fast-fail).
func (b *DBCircuitBreaker) Execute(fn func() error) error {
	_, err := b.cb.Execute(func() (interface{}, error) {
		return nil, fn()
	})
	return err
}

// State returns the current circuit breaker state.
func (b *DBCircuitBreaker) State() gobreaker.State {
	return b.cb.State()
}

// Counts returns the current failure/success counts.
func (b *DBCircuitBreaker) Counts() gobreaker.Counts {
	return b.cb.Counts()
}
