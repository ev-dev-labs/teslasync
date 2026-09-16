package v1

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestAnalysisWindow(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		query string
		valid bool
	}{
		{"?vehicle_id=1", true},
		{"?vehicle_id=0", false},
		{"?vehicle_id=1&start=nope", false},
		{"?vehicle_id=1&start=2026-01-02&end=2026-01-01", false},
		{"?vehicle_id=1&start=2025-01-01&end=2026-01-01", false},
		{"?vehicle_id=1&start=2025-12-01&end=2025-12-15", true},
	} {
		t.Run(tc.query, func(t *testing.T) {
			id, from, to, err := analysisWindow(httptest.NewRequest("GET", "/science"+tc.query, nil), now, 7*24*time.Hour, 30*24*time.Hour)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			if tc.query == "?vehicle_id=1" && (id != 1 || !to.Equal(now) || !from.Equal(now.Add(-7*24*time.Hour))) {
				t.Fatal("default range changed")
			}
			if tc.query == "?vehicle_id=1&start=2025-12-01&end=2025-12-15" && to.Sub(from) != 15*24*time.Hour-time.Second {
				t.Fatal("window silently cropped")
			}
		})
	}
}
