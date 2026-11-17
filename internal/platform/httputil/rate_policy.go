package httputil

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const (
	RateLimitBucketHeader      = "X-RateLimit-Bucket"
	RateLimitScopeHeader       = "X-RateLimit-Scope"
	RateLimitMethodsHeader     = "X-RateLimit-Methods"
	RateLimitSourceHeader      = "X-RateLimit-Source"
	RateLimitEnforcementHeader = "X-RateLimit-Enforcement"
	RateLimitLimitedHeader     = "X-RateLimit-Limited"
)

// RateLimitPolicy describes the requests sharing an enforced quota. Bucket is
// opaque: neither identities nor upstream tokens belong in response metadata.
type RateLimitPolicy struct {
	Bucket      string
	Scope       string
	Methods     string
	Source      string
	Enforcement string
}

func (p RateLimitPolicy) SetHeaders(h http.Header) {
	h.Set(RateLimitBucketHeader, p.Bucket)
	h.Set(RateLimitScopeHeader, p.Scope)
	h.Set(RateLimitMethodsHeader, p.Methods)
	h.Set(RateLimitSourceHeader, p.Source)
	h.Set(RateLimitEnforcementHeader, p.Enforcement)
}

// NewRateLimitBucket keys opaque identifiers to this limiter's lifetime, matching
// process-local enforcement without exposing guessable hashes of IPs or users.
func NewRateLimitBucket() func(string) string {
	secret := []byte(rand.Text())
	return func(key string) string {
		mac := hmac.New(sha256.New, secret)
		_, _ = mac.Write([]byte(key))
		return hex.EncodeToString(mac.Sum(nil)[:16])
	}
}

// RetryAfterSeconds accepts both HTTP forms. Date removes upstream clock skew;
// invalid values fall back conservatively without overflowing time.Duration.
func RetryAfterSeconds(value, serverDate string, now time.Time) int64 {
	const maxSeconds = math.MaxInt64 / int64(time.Second)
	if n, err := strconv.ParseUint(value, 10, 63); err == nil && value != "" &&
		n <= uint64(maxSeconds) {
		return int64(n)
	}
	if deadline, err := http.ParseTime(value); err == nil {
		reference := now
		if date, dateErr := http.ParseTime(serverDate); dateErr == nil {
			reference = date
		}
		if seconds := int64(math.Ceil(deadline.Sub(reference).Seconds())); seconds <= maxSeconds {
			return max(0, seconds)
		}
	}
	return 60
}

type upstreamRateLimitKey struct{}

// UpstreamRateLimitCapture carries response timing back through an existing
// client signature. Parallel upstream calls never touch the HTTP writer.
type UpstreamRateLimitCapture struct {
	mu        sync.Mutex
	source    string
	expiresAt time.Time
}

func CaptureUpstreamRateLimit(ctx context.Context) (context.Context, *UpstreamRateLimitCapture) {
	capture := &UpstreamRateLimitCapture{}
	return context.WithValue(ctx, upstreamRateLimitKey{}, capture), capture
}

func RecordUpstreamRateLimit(ctx context.Context, source string, headers http.Header) {
	capture, ok := ctx.Value(upstreamRateLimitKey{}).(*UpstreamRateLimitCapture)
	if !ok {
		return
	}
	now := time.Now().UTC()
	expiresAt := now.Add(time.Duration(RetryAfterSeconds(
		headers.Get("Retry-After"), headers.Get("Date"), now,
	)) * time.Second)
	capture.mu.Lock()
	defer capture.mu.Unlock()
	if capture.source == "" || expiresAt.After(capture.expiresAt) {
		capture.source = source
		capture.expiresAt = expiresAt
	}
}

func (c *UpstreamRateLimitCapture) Snapshot() (source string, retryAfterSec int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.source, max(0, int64(math.Ceil(time.Until(c.expiresAt).Seconds())))
}
