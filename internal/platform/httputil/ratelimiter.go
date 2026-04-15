package httputil

import (
	"context"
	"math"
	"net/http"
	"sync"
	"time"
)

// RateLimiter implements a token bucket algorithm for outbound rate limiting.
type RateLimiter struct {
	rate     float64 // tokens per second
	burst    int     // max burst size
	tokens   float64
	lastTime time.Time
	mu       sync.Mutex
}

// NewRateLimiter creates a rate limiter with given rate (req/s) and burst.
func NewRateLimiter(ratePerSecond float64, burst int) *RateLimiter {
	return &RateLimiter{
		rate:     ratePerSecond,
		burst:    burst,
		tokens:   float64(burst),
		lastTime: time.Now(),
	}
}

// refill adds tokens based on elapsed time since last refill.
func (rl *RateLimiter) refill() {
	now := time.Now()
	elapsed := now.Sub(rl.lastTime).Seconds()
	rl.tokens = math.Min(float64(rl.burst), rl.tokens+elapsed*rl.rate)
	rl.lastTime = now
}

// Allow returns true immediately if a token is available (non-blocking).
func (rl *RateLimiter) Allow() bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	rl.refill()
	if rl.tokens >= 1 {
		rl.tokens--
		return true
	}
	return false
}

// Wait blocks until a token is available or ctx is cancelled.
func (rl *RateLimiter) Wait(ctx context.Context) error {
	for {
		rl.mu.Lock()
		rl.refill()
		if rl.tokens >= 1 {
			rl.tokens--
			rl.mu.Unlock()
			return nil
		}
		// Calculate how long until next token is available
		deficit := 1.0 - rl.tokens
		waitDur := time.Duration(deficit / rl.rate * float64(time.Second))
		rl.mu.Unlock()

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(waitDur):
			// Loop back to try again
		}
	}
}

// RateLimitedTransport wraps http.RoundTripper with rate limiting.
type RateLimitedTransport struct {
	Base    http.RoundTripper
	Limiter *RateLimiter
}

// RoundTrip implements http.RoundTripper with rate limiting.
func (t *RateLimitedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.Limiter != nil {
		if err := t.Limiter.Wait(req.Context()); err != nil {
			return nil, err
		}
	}

	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(req)
}
