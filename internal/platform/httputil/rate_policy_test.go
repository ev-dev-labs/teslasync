package httputil

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestRetryAfterSeconds(t *testing.T) {
	now := time.Date(2026, time.November, 15, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name, value, date string
		want              int64
	}{
		{"seconds", "37", "", 37},
		{"zero", "0", "", 0},
		{"missing", "", "", 60},
		{"malformed", "30seconds", "", 60},
		{"negative", "-10", "", 60},
		{"overflow", "999999999999999999999", "", 60},
		{"duration overflow", strconv.FormatInt(1<<62, 10), "", 60},
		{"date duration overflow", time.Date(9999, time.December, 31, 23, 59, 59, 0, time.UTC).Format(http.TimeFormat), "", 60},
		{"date", now.Add(31 * time.Second).Format(http.TimeFormat), "", 31},
		{"clock skew", now.Add(time.Hour + 20*time.Second).Format(http.TimeFormat), now.Add(time.Hour).Format(http.TimeFormat), 20},
		{"past date", now.Add(-time.Hour).Format(http.TimeFormat), "", 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := RetryAfterSeconds(tt.value, tt.date, now); got != tt.want {
				t.Fatalf("RetryAfterSeconds = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestUpstreamRateLimitCapture(t *testing.T) {
	ctx, capture := CaptureUpstreamRateLimit(context.Background())
	var wg sync.WaitGroup
	for _, seconds := range []string{"10", "90", "30"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			RecordUpstreamRateLimit(ctx, "tesla", http.Header{"Retry-After": {seconds}})
		}()
	}
	wg.Wait()
	source, retry := capture.Snapshot()
	if source != "tesla" || retry < 89 || retry > 90 {
		t.Fatalf("snapshot = (%q, %d), want tesla and longest retry", source, retry)
	}
	RecordUpstreamRateLimit(context.Background(), "tesla", http.Header{})
}
