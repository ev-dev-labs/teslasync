package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultWriteLimit is the authenticated write-route backstop. Individual
// sensitive routes retain their lower limits; this only bounds endpoints that
// have not declared a focused limit yet.
const DefaultWriteLimit = 120

// WriteRateLimiter bounds unsafe requests by client IP in fixed windows. It is
// intended as a route-group safety net, not a substitute for the narrower
// limits required on credential and destructive endpoints.
type WriteRateLimiter struct {
	mu              sync.Mutex
	limit           int
	window          time.Duration
	now             func() time.Time
	clients         map[string]writeRateWindow
	maxKeys         int
	lastTrim        time.Time
	principalHeader string
}

type writeRateWindow struct {
	start time.Time
	count int
}

type peerAddressKey struct{}

// CapturePeerAddress records the transport peer before chi's RealIP middleware
// consumes potentially spoofable XFF/True-Client-IP headers. It must be
// registered before RealIP at the router boundary.
func CapturePeerAddress(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), peerAddressKey{}, r.RemoteAddr)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// NewWriteRateLimiter builds a bounded per-IP unsafe-request limiter. Invalid
// limits use the secure default; a zero window defaults to one minute.
// principalHeader is the ForwardAuth identity header read after authentication;
// an empty value falls back to the captured transport peer.
func NewWriteRateLimiter(limit int, window time.Duration, principalHeader string) *WriteRateLimiter {
	if limit <= 0 {
		limit = DefaultWriteLimit
	}
	if window <= 0 {
		window = time.Minute
	}
	return &WriteRateLimiter{
		limit:           limit,
		window:          window,
		now:             time.Now,
		clients:         make(map[string]writeRateWindow),
		maxKeys:         10_000,
		principalHeader: strings.TrimSpace(principalHeader),
	}
}

// Middleware applies the limiter only to unsafe HTTP methods.
func (l *WriteRateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isUnsafeMethod(r.Method) || l.allow(l.keyForRequest(r)) {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", strconv.Itoa(int(l.window.Seconds())))
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": "write request rate limit exceeded",
			"code":  "WRITE_RATE_LIMITED",
		})
	})
}

func (l *WriteRateLimiter) allow(key string) bool {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.lastTrim.IsZero() || now.Sub(l.lastTrim) >= l.window {
		for client, state := range l.clients {
			if now.Sub(state.start) >= l.window {
				delete(l.clients, client)
			}
		}
		l.lastTrim = now
	}

	state, exists := l.clients[key]
	if !exists {
		if len(l.clients) >= l.maxKeys {
			l.evictOldest()
		}
		l.clients[key] = writeRateWindow{start: now, count: 1}
		return true
	}
	if now.Sub(state.start) >= l.window {
		l.clients[key] = writeRateWindow{start: now, count: 1}
		return true
	}
	if state.count >= l.limit {
		return false
	}
	state.count++
	l.clients[key] = state
	return true
}

func (l *WriteRateLimiter) evictOldest() {
	var (
		oldestKey string
		oldest    time.Time
	)
	for key, state := range l.clients {
		if oldestKey == "" || state.start.Before(oldest) {
			oldestKey = key
			oldest = state.start
		}
	}
	if oldestKey != "" {
		delete(l.clients, oldestKey)
	}
}

func (l *WriteRateLimiter) keyForRequest(r *http.Request) string {
	if l.principalHeader != "" {
		if principal := strings.TrimSpace(r.Header.Get(l.principalHeader)); principal != "" {
			sum := sha256.Sum256([]byte(principal))
			return "principal:" + hex.EncodeToString(sum[:])
		}
	}
	return "peer:" + peerIP(r)
}

func peerIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	remote := r.RemoteAddr
	if captured, ok := r.Context().Value(peerAddressKey{}).(string); ok {
		remote = captured
	}
	host, _, err := net.SplitHostPort(remote)
	if err == nil {
		return host
	}
	return strings.TrimSpace(remote)
}
