package analysis

import (
	"context"
	"encoding/json"
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

func TestRespondAnalysisWritesPayloadNotEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/physics/ledger", nil)
	respondAnalysis(rec, req, "api.physics.test", func(context.Context) (map[string]string, error) {
		return map[string]string{"kind": "range"}, nil
	})
	if rec.Code != 200 {
		t.Fatalf("status=%d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if _, wrapped := body["data"]; wrapped {
		t.Fatalf("payload wrapped in data envelope: %v", body)
	}
	if body["kind"] != "range" {
		t.Fatalf("kind=%v body=%v", body["kind"], body)
	}
}
