package v1

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/roadanomalysvc"
	"github.com/go-chi/chi/v5"
)

type anomalyStub struct {
	result roadanomalysvc.Result
	err    error
	calls  int
}

func (s *anomalyStub) Analyze(_ context.Context, id int64) (roadanomalysvc.Result, error) {
	s.calls++
	return s.result, s.err
}

func TestRoadAnomaliesGet(t *testing.T) {
	tests := []struct {
		name, path string
		status     string
		err        error
		want       int
		calls      int
	}{
		{"insufficient", "/drives/7/road-anomalies", "insufficient_data", nil, 200, 1},
		{"no candidates", "/drives/7/road-anomalies", "no_candidates", nil, 200, 1},
		{"candidates", "/drives/7/road-anomalies", "candidates", nil, 200, 1},
		{"invalid id", "/drives/x/road-anomalies", "", nil, 400, 0},
		{"zero id", "/drives/0/road-anomalies", "", nil, 400, 0},
		{"unexpected query", "/drives/7/road-anomalies?limit=10000", "", nil, 400, 0},
		{"missing drive", "/drives/7/road-anomalies", "", roadanomalysvc.ErrNotFound, 404, 1},
		{"oversize", "/drives/7/road-anomalies", "", roadanomalysvc.ErrWindowTooLarge, 422, 1},
		{"reader error", "/drives/7/road-anomalies", "", errors.New("private DB error"), 500, 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &anomalyStub{result: roadanomalysvc.Result{
				DriveID: 7, Status: roadanomalysvc.Status(tc.status),
				Reasons:     []string{"no_near_time_acceleration_with_fresh_speed_gps_and_lateral_context"},
				Limitations: []string{"Possible road anomaly only."},
				Candidates:  []roadanomalysvc.Candidate{},
			}, err: tc.err}
			if tc.status == "candidates" {
				svc.result.Candidates = []roadanomalysvc.Candidate{{
					Timestamp: time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC),
					Latitude:  37.1, Longitude: -122.1, SpeedMps: 15,
					Classification: "possible_road_anomaly",
				}}
			}
			r := chi.NewRouter()
			r.Get("/drives/{driveID}/road-anomalies", NewRoadAnomalyHandler(svc).Get)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != tc.want || svc.calls != tc.calls {
				t.Fatalf("status=%d calls=%d body=%s", rec.Code, svc.calls, rec.Body.String())
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tc.want == 200 {
				if body["drive_id"] == nil || body["status"] == nil || body["analyzed_samples"] == nil ||
					body["limitations"] == nil || body["candidates"] == nil || body["data"] != nil {
					t.Fatalf("unexpected direct JSON contract: %s", rec.Body.String())
				}
				var status string
				if err := json.Unmarshal(body["status"], &status); err != nil || status != tc.status {
					t.Fatalf("status=%q err=%v", status, err)
				}
				if tc.status == "candidates" {
					var candidates []map[string]json.RawMessage
					if err := json.Unmarshal(body["candidates"], &candidates); err != nil ||
						len(candidates) != 1 || candidates[0]["timestamp"] == nil || candidates[0]["ts"] != nil {
						t.Fatalf("candidates contract: %s err=%v", rec.Body.String(), err)
					}
				}
			}
			if tc.want == 500 && (body["error"] == nil || strings.Contains(rec.Body.String(), "private DB error")) {
				t.Fatalf("internal error leaked: %s", rec.Body.String())
			}
		})
	}
}
