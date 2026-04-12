package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// Idempotency returns middleware that supports idempotency keys per §6.5.
// State-mutating requests (POST, PUT, PATCH, DELETE) with an Idempotency-Key header
// will have their results cached for the given TTL.
func Idempotency(rdb *redis.Client, ttl time.Duration) func(http.Handler) http.Handler {
	if ttl == 0 {
		ttl = 24 * time.Hour
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only apply to state-mutating methods
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			key := r.Header.Get("Idempotency-Key")
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}

			cacheKey := fmt.Sprintf("idempotency:%s:%s", r.URL.Path, key)
			ctx := r.Context()

			// Check for cached response
			if rdb != nil {
				cached, err := rdb.Get(ctx, cacheKey).Bytes()
				if err == nil {
					var resp cachedResponse
					if json.Unmarshal(cached, &resp) == nil {
						w.Header().Set("Content-Type", "application/json")
						w.Header().Set("X-Idempotency-Replay", "true")
						w.WriteHeader(resp.StatusCode)
						w.Write(resp.Body)
						return
					}
				}
			}

			// Execute and cache the response
			rec := &idempotencyRecorder{ResponseWriter: w, statusCode: http.StatusOK}
			next.ServeHTTP(rec, r)

			// Cache the response
			if rdb != nil {
				resp := cachedResponse{
					StatusCode: rec.statusCode,
					Body:       rec.body,
				}
				if data, err := json.Marshal(resp); err == nil {
					rdb.Set(context.Background(), cacheKey, data, ttl)
				}
			}
		})
	}
}

type cachedResponse struct {
	StatusCode int    `json:"status_code"`
	Body       []byte `json:"body"`
}

type idempotencyRecorder struct {
	http.ResponseWriter
	statusCode int
	body       []byte
	written    bool
}

func (r *idempotencyRecorder) WriteHeader(code int) {
	if !r.written {
		r.statusCode = code
		r.written = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *idempotencyRecorder) Write(b []byte) (int, error) {
	if !r.written {
		r.statusCode = http.StatusOK
		r.written = true
	}
	r.body = append(r.body, b...)
	return r.ResponseWriter.Write(b)
}

// Ensure httputil is used (avoid unused import)
var _ = httputil.RespondError
