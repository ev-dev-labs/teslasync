package httputil

import (
	"fmt"
	"sync"
	"time"
)

// CircuitState represents the state of a circuit breaker.
type CircuitState int

const (
	CircuitClosed   CircuitState = iota // Normal operation
	CircuitOpen                         // Failing, reject requests
	CircuitHalfOpen                     // Testing with one probe
)

func (s CircuitState) String() string {
	switch s {
	case CircuitClosed:
		return "closed"
	case CircuitOpen:
		return "open"
	case CircuitHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// CircuitBreakerConfig configures the circuit breaker behavior.
type CircuitBreakerConfig struct {
	// FailureThreshold: number of consecutive failures before opening the circuit.
	FailureThreshold int
	// ResetTimeout: duration to wait before transitioning from open to half-open.
	ResetTimeout time.Duration
	// HalfOpenMaxRequests: max concurrent requests in half-open state (probe).
	HalfOpenMaxRequests int
}

// DefaultCircuitBreakerConfig returns sensible defaults.
func DefaultCircuitBreakerConfig() CircuitBreakerConfig {
	return CircuitBreakerConfig{
		FailureThreshold:    5,
		ResetTimeout:        30 * time.Second,
		HalfOpenMaxRequests: 1,
	}
}

// CircuitBreaker implements the circuit breaker pattern.
type CircuitBreaker struct {
	mu               sync.Mutex
	name             string
	config           CircuitBreakerConfig
	state            CircuitState
	failures         int
	successes        int
	lastFailureTime  time.Time
	halfOpenRequests int
}

// NewCircuitBreaker creates a new circuit breaker.
func NewCircuitBreaker(name string, cfg CircuitBreakerConfig) *CircuitBreaker {
	return &CircuitBreaker{
		name:   name,
		config: cfg,
		state:  CircuitClosed,
	}
}

// Execute runs fn through the circuit breaker.
// Returns ErrCircuitOpen if the circuit is open.
func (cb *CircuitBreaker) Execute(fn func() error) error {
	if err := cb.beforeRequest(); err != nil {
		return err
	}

	err := fn()
	cb.afterRequest(err)
	return err
}

// State returns the current circuit state.
func (cb *CircuitBreaker) State() CircuitState {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	// Check if we should transition from open to half-open
	if cb.state == CircuitOpen && time.Since(cb.lastFailureTime) > cb.config.ResetTimeout {
		cb.state = CircuitHalfOpen
		cb.halfOpenRequests = 0
	}
	return cb.state
}

// ErrCircuitOpen is returned when the circuit breaker is open.
var ErrCircuitOpen = fmt.Errorf("circuit breaker is open")

func (cb *CircuitBreaker) beforeRequest() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case CircuitClosed:
		return nil
	case CircuitOpen:
		// Check if enough time has passed to try half-open
		if time.Since(cb.lastFailureTime) > cb.config.ResetTimeout {
			cb.state = CircuitHalfOpen
			cb.halfOpenRequests = 0
			return nil
		}
		return fmt.Errorf("%s: %w", cb.name, ErrCircuitOpen)
	case CircuitHalfOpen:
		if cb.halfOpenRequests >= cb.config.HalfOpenMaxRequests {
			return fmt.Errorf("%s: %w (half-open probe in progress)", cb.name, ErrCircuitOpen)
		}
		cb.halfOpenRequests++
		return nil
	}
	return nil
}

func (cb *CircuitBreaker) afterRequest(err error) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err == nil {
		cb.onSuccess()
	} else {
		cb.onFailure()
	}
}

func (cb *CircuitBreaker) onSuccess() {
	switch cb.state {
	case CircuitHalfOpen:
		// Probe succeeded — close the circuit
		cb.successes++
		cb.state = CircuitClosed
		cb.failures = 0
		cb.successes = 0
	case CircuitClosed:
		cb.failures = 0
	}
}

func (cb *CircuitBreaker) onFailure() {
	switch cb.state {
	case CircuitClosed:
		cb.failures++
		if cb.failures >= cb.config.FailureThreshold {
			cb.state = CircuitOpen
			cb.lastFailureTime = time.Now()
		}
	case CircuitHalfOpen:
		// Probe failed — back to open
		cb.state = CircuitOpen
		cb.lastFailureTime = time.Now()
	}
}
