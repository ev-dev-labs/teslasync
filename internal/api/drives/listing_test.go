package drives

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

type rangeStatsReader struct {
	calls     int
	vehicleID int64
	start     time.Time
	end       time.Time
	err       error
}

func (f *rangeStatsReader) GetStatsInRange(ctx context.Context, vehicleID int64, start, end time.Time) (drivedb.DrivingStats, error) {
	f.calls++
	f.vehicleID, f.start, f.end = vehicleID, start, end
	return drivedb.DrivingStats{Count: 125, DistanceM: 8765000, DurationS: 123456}, f.err
}

func TestDrivingStatsExactRange(t *testing.T) {
	for _, tc := range []struct {
		name, start, end, wantStart, wantEnd string
	}{
		{"rolling_subsecond", "2024-03-10T15:42:19.125Z", "2024-03-11T15:42:19.125Z", "2024-03-10T15:42:19.125Z", "2024-03-11T15:42:19.125Z"},
		{"spring_DST", "2024-03-10T00:00:00-08:00", "2024-03-11T00:00:00-07:00", "2024-03-10T08:00:00Z", "2024-03-11T07:00:00Z"},
		{"fall_DST", "2024-11-03T00:00:00-07:00", "2024-11-04T00:00:00-08:00", "2024-11-03T07:00:00Z", "2024-11-04T08:00:00Z"},
		{"fractional_precision", "2024-01-31T23:59:59.999999Z", "2024-02-01T00:00:00Z", "2024-01-31T23:59:59.999999Z", "2024-02-01T00:00:00Z"},
		{"calendar_full_final_day", "2024-01-01", "2024-01-31", "2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z"},
		{"lower_only", "2024-01-01", "", "2024-01-01T00:00:00Z", ""},
		{"upper_only", "", "2024-01-31", "", "2024-02-01T00:00:00Z"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &rangeStatsReader{}
			unbounded := &fakeDrivingStatsReader{}
			h := &DriveHandler{statsRepo: unbounded, statsRangeRepo: reader}
			params := url.Values{"vehicle_id": {"42"}, "start": {tc.start}, "end": {tc.end}}
			rec := httptest.NewRecorder()
			h.Stats(rec, httptest.NewRequest(http.MethodGet, "/drives/stats?"+params.Encode(), nil))
			if rec.Code != http.StatusOK || reader.calls != 1 || reader.vehicleID != 42 || unbounded.vehicleID != 0 {
				t.Fatalf("status=%d calls=%d vehicle=%d unbounded=%d body=%s", rec.Code, reader.calls, reader.vehicleID, unbounded.vehicleID, rec.Body.String())
			}
			for _, bound := range []struct {
				got  time.Time
				want string
			}{{reader.start, tc.wantStart}, {reader.end, tc.wantEnd}} {
				if bound.want == "" {
					if !bound.got.IsZero() {
						t.Fatalf("absent bound became %s", bound.got)
					}
				} else {
					want, err := time.Parse(time.RFC3339Nano, bound.want)
					if err != nil || !bound.got.Equal(want) {
						t.Fatalf("bound=%s want=%s err=%v", bound.got, want, err)
					}
				}
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["total_drives"] != float64(125) || body["total_distance_km"] != float64(8765) || body["total_duration_s"] != float64(123456) || body["regen_energy_wh"] != nil {
				t.Fatalf("full-range metric/null contract changed: %v", body)
			}
		})
	}
}

func TestDrivingStatsInvalidRangeDoesNotRead(t *testing.T) {
	for _, tc := range []struct{ name, start, end string }{
		{"bad_start", "invalid", "2024-02-01T00:00:00Z"},
		{"bad_end", "2024-01-01T00:00:00Z", "invalid"},
		{"invalid_calendar", "2024-02-30", ""},
		{"reversed", "2024-02-02T00:00:00Z", "2024-02-01T00:00:00Z"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &rangeStatsReader{}
			h := &DriveHandler{statsRangeRepo: reader}
			params := url.Values{"vehicle_id": {"42"}, "start": {tc.start}, "end": {tc.end}}
			rec := httptest.NewRecorder()
			h.Stats(rec, httptest.NewRequest(http.MethodGet, "/drives/stats?"+params.Encode(), nil))
			if rec.Code != http.StatusBadRequest || reader.calls != 0 {
				t.Fatalf("status=%d calls=%d body=%s", rec.Code, reader.calls, rec.Body.String())
			}
		})
	}
}

func TestDrivingStatsBoundedRepositoryFailure(t *testing.T) {
	reader := &rangeStatsReader{err: errors.New("private database detail")}
	h := &DriveHandler{statsRangeRepo: reader}
	rec := httptest.NewRecorder()
	h.Stats(rec, httptest.NewRequest(http.MethodGet, "/drives/stats?vehicle_id=42&start=2024-01-01", nil))
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusInternalServerError || body["error"] != "failed to get driving stats" || body["code"] != "INTERNAL_ERROR" || len(body) != 2 {
		t.Fatalf("repository failure status=%d body=%s", rec.Code, rec.Body.String())
	}
}
