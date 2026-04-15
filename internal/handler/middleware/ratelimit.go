package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// RateLimitConfig configures rate limiting behavior.
type RateLimitConfig struct {
	// RequestsPerWindow is the max number of requests allowed in the window.
	RequestsPerWindow int
	// Window is the sliding window duration.
	Window time.Duration
	// KeyFunc extracts the rate limit key from the request (e.g., user ID, IP).
	KeyFunc func(r *http.Request) string
}

// DefaultRateLimitConfig returns sensible defaults for global rate limiting.
func DefaultRateLimitConfig() RateLimitConfig {
	return RateLimitConfig{
		RequestsPerWindow: 1000,
		Window:            1 * time.Minute,
		KeyFunc: func(r *http.Request) string {
			// Use user from context if available, otherwise remote addr
			if claims, ok := UserFromContext(r.Context()); ok {
				return claims.UserID
			}
			return r.RemoteAddr
		},
	}
}

// RateLimit returns middleware that enforces rate limiting using a Redis sliding window.
func RateLimit(rdb *redis.Client, cfg RateLimitConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if rdb == nil {
				next.ServeHTTP(w, r)
				return
			}

			key := fmt.Sprintf("ratelimit:%s:%s", cfg.KeyFunc(r), r.URL.Path)
			ctx := r.Context()

			count, err := incrementSlidingWindow(ctx, rdb, key, cfg.Window)
			if err != nil {
				// On Redis error, allow the request (graceful degradation)
				next.ServeHTTP(w, r)
				return
			}

			// Set rate limit headers
			remaining := cfg.RequestsPerWindow - int(count)
			if remaining < 0 {
				remaining = 0
			}
			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", cfg.RequestsPerWindow))
			w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))

			if int(count) > cfg.RequestsPerWindow {
				w.Header().Set("Retry-After", fmt.Sprintf("%d", int(cfg.Window.Seconds())))
				httputil.RespondError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// incrementSlidingWindow implements a Redis sliding window counter.
func incrementSlidingWindow(ctx context.Context, rdb *redis.Client, key string, window time.Duration) (int64, error) {
	now := time.Now().UnixMicro()
	windowStart := now - window.Microseconds()

	pipe := rdb.Pipeline()

	// Remove entries outside the window
	pipe.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("%d", windowStart))

	// Add current request
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: now})

	// Count requests in window
	countCmd := pipe.ZCard(ctx, key)

	// Set TTL on the key
	pipe.Expire(ctx, key, window)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("executing rate limit pipeline: %w", err)
	}

	return countCmd.Val(), nil
}
