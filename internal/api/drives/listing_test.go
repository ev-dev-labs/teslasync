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

	"github.com/ev-dev-labs/teslasync/internal/app/drivehistorysvc"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

type historyReaderFixture struct {
	rows          []*drivemodel.Drive
	limit, offset int
	start, end    time.Time
	rangeCalls    int
}

func (f *historyReaderFixture) HistoryCount(_ context.Context, _ int64, start, end time.Time) (int, error) {
	f.start, f.end = start, end
	return len(f.between(start, end)), nil
}

func (f *historyReaderFixture) HistoryPage(_ context.Context, _ int64, limit, offset int, start, end time.Time) ([]*drivemodel.Drive, error) {
	f.limit, f.offset = limit, offset
	rows := f.between(start, end)
	return rows[offset:min(len(rows), offset+limit)], nil
}

func (f *historyReaderFixture) HistoryRange(_ context.Context, _ int64, start, end time.Time) ([]*drivemodel.Drive, error) {
	f.rangeCalls++
	return f.between(start, end), nil
}

func (f *historyReaderFixture) between(start, end time.Time) []*drivemodel.Drive {
	rows := []*drivemodel.Drive{}
	for _, row := range f.rows {
		if !row.StartTs.Before(start) && row.StartTs.Before(end) {
			rows = append(rows, row)
		}
	}
	return rows
}

func TestDriveHistoryViewsAcrossPageLimit(t *testing.T) {
	const count = 1054
	start := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	reader := &historyReaderFixture{rows: []*drivemodel.Drive{{ID: count + 1, StartTs: end}}}
	for id := count; id > 0; id-- {
		reader.rows = append(reader.rows, &drivemodel.Drive{ID: int64(id), StartTs: start.Add(time.Minute * time.Duration(id)), DistanceM: 400})
	}
	reader.rows[count].DistanceM = 50000
	zero := float64(0)
	reader.rows[count].RegenEnergyWh = &zero
	reader.rows = append(reader.rows, &drivemodel.Drive{ID: count + 2, StartTs: start.Add(-time.Hour)})
	handler := &DriveHandler{historyRepo: reader}
	request := func(view, grid, limit, offset string, target any) {
		t.Helper()
		args := url.Values{
			"vehicle_id": {"42"}, "view": {view}, "grid": {grid}, "limit": {limit}, "offset": {offset},
			"timezone": {"UTC"}, "start": {start.Format(time.RFC3339)}, "end": {end.Format(time.RFC3339)},
			"prior_start": {start.AddDate(0, -1, 0).Format(time.RFC3339)}, "field": {"distance"},
		}
		rec := httptest.NewRecorder()
		handler.ListByVehicle(rec, httptest.NewRequest(http.MethodGet, "/drives?"+args.Encode(), nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", view, rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), target); err != nil {
			t.Fatalf("%s: %v", view, err)
		}
	}
	var page drivehistorysvc.Page
	request("page", "", "25", "1000", &page)
	if page.Total != count || page.Page != 41 || len(page.Items) != 25 || page.Items[0].ID != 54 ||
		page.Items[24].ID != 30 || reader.limit != 25 || reader.offset != 1000 || reader.rangeCalls != 0 ||
		!reader.start.Equal(start) || !reader.end.Equal(end) {
		t.Fatalf("unexpected page/count query: page=%d total=%d rows=%d reader=%+v", page.Page, page.Total, len(page.Items), reader)
	}
	request("page", "", "25", "5000", &page)
	if page.Page != 43 || len(page.Items) != 4 || page.Items[3].ID != 1 {
		t.Fatalf("did not clamp a stale URL to the final page: %+v", page)
	}
	request("page", `{"sort":"distance","minimum":{"distance":40000}}`, "25", "0", &page)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != 1 {
		t.Fatalf("filter missed the oldest match: %+v", page)
	}
	request("page", `{"sort":"distance"}`, "2", "0", &page)
	if page.Total != count || len(page.Items) != 2 || page.Items[0].ID != 1 || page.Items[1].ID != count {
		t.Fatalf("global sort or stable time/ID tie-break changed: %+v", page)
	}
	var overview drivehistorysvc.Overview
	request("overview", "", "25", "1000", &overview)
	if overview.Current.Count != count || overview.Prior == nil || overview.Prior.Count != 1 ||
		len(overview.Days) != 1 || overview.Days[0].Count != count || *overview.Current.LongestDistanceM != 50000 {
		t.Fatalf("overview did not use full active/prior ranges: %+v", overview)
	}
	var facets []drivehistorysvc.Facet
	request("values", "", "25", "1000", &facets)
	if len(facets) != 2 || facets[0].Value != float64(400) || facets[0].Count != count-1 || facets[1].Count != 1 {
		t.Fatalf("incorrect full-range values: %+v", facets)
	}
	var ids []int64
	request("ids", `{"values":{"distance":{"keys":[50000]}}}`, "", "", &ids)
	if len(ids) != 1 || ids[0] != 1 {
		t.Fatalf("matching IDs = %v; want oldest matching ID", ids)
	}
	request("ids", `{"values":{"regen":{"keys":[0]}}}`, "", "", &ids)
	if len(ids) != 1 || ids[0] != 1 {
		t.Fatalf("zero regeneration must not match missing readings: %v", ids)
	}
}

type rangeStatsReader struct {
	calls     int
	vehicleID int64
	start     time.Time
	end       time.Time
	err       error
}

func TestDriveListRejectsInvalidHistoryBoundsBeforeRepositoryRead(t *testing.T) {
	for _, query := range []string{
		"start=invalid", "end=invalid",
		"start=2026-06-03T12:00:00Z&end=2026-06-02T12:00:00Z",
	} {
		t.Run(query, func(t *testing.T) {
			h := &DriveHandler{}
			rec := httptest.NewRecorder()
			h.ListByVehicle(rec, httptest.NewRequest(http.MethodGet, "/drives?vehicle_id=42&"+query, nil))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
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
