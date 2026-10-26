package teslausage

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type usageReaderFake struct {
	err      error
	seenZone *string
}

func (f usageReaderFake) Cycles(_ context.Context, _ time.Time, limit, offset int) (*models.TeslaUsageResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &models.TeslaUsageResponse{History: make([]models.TeslaUsageCycle, limit), RateSource: "test"}, nil
}

func (f usageReaderFake) Series(_ context.Context, start, end time.Time, bucket string, limit, offset int, locations ...*time.Location) (*models.TeslaUsageSeriesResponse, error) {
	if f.seenZone != nil && len(locations) > 0 {
		*f.seenZone = locations[0].String()
	}
	if f.err != nil {
		return nil, f.err
	}
	return &models.TeslaUsageSeriesResponse{
		Start: start, End: end, Bucket: bucket,
		Points: []models.TeslaUsagePoint{{BucketStart: start, Signals: int64(limit + offset)}},
	}, nil
}

func TestTeslaUsageHandlerValidationAndErrors(t *testing.T) {
	for _, tc := range []struct {
		query  string
		status int
	}{
		{"?limit=0", 400}, {"?limit=25", 400}, {"?limit=abc", 400},
		{"?offset=-1", 400}, {"?offset=121", 400}, {"?limit=3&offset=2", 200},
	} {
		w := httptest.NewRecorder()
		(&TeslaUsageHandler{repo: usageReaderFake{}}).Get(w, httptest.NewRequest(http.MethodGet, "/api/v1/system/api-usage"+tc.query, nil))
		if w.Code != tc.status {
			t.Errorf("%s status = %d, want %d", tc.query, w.Code, tc.status)
		}
	}
	w := httptest.NewRecorder()
	(&TeslaUsageHandler{repo: usageReaderFake{err: errors.New("database unavailable")}}).Get(w, httptest.NewRequest(http.MethodGet, "/api/v1/system/api-usage", nil))
	if w.Code != 500 {
		t.Errorf("database failure status = %d, want 500", w.Code)
	}
}

func TestTeslaUsageHistoryValidatesRangeBucketAndBounds(t *testing.T) {
	base := "/api/v1/system/api-usage/history"
	for _, tc := range []struct {
		query  string
		status int
	}{
		{"", 400},
		{"?start=2026-01-01&end=2026-01-02&bucket=day", 400},
		{"?start=2026-09-01T00:00:00Z&end=2026-09-01T00:00:00Z&bucket=day", 400},
		{"?start=2026-01-01T00:00:00Z&end=2027-01-03T00:00:00Z&bucket=week", 400},
		{"?start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z&bucket=month", 400},
		{"?start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z&bucket=day&limit=367", 400},
		{"?start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z&bucket=day&offset=-1", 400},
		{"?start=2025-01-01T00:00:00-07:00&end=2025-01-02T00:00:00-07:00&bucket=week&limit=1&offset=2", 200},
	} {
		w := httptest.NewRecorder()
		(&TeslaUsageHandler{repo: usageReaderFake{}}).History(w, httptest.NewRequest(http.MethodGet, base+tc.query, nil))
		if w.Code != tc.status {
			t.Errorf("%s: status = %d, want %d; body=%s", tc.query, w.Code, tc.status, w.Body.String())
		}

	}
	w := httptest.NewRecorder()
	(&TeslaUsageHandler{repo: usageReaderFake{err: errors.New("down")}}).History(w, httptest.NewRequest(http.MethodGet,
		base+"?start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z&bucket=day", nil))
	if w.Code != 500 {
		t.Errorf("repository failure status = %d, want 500", w.Code)
	}
}

func TestTeslaUsageHistoryRejectsInvalidCalendars(t *testing.T) {
	for _, zone := range []string{"Local", "Mars/Olympus", strings.Repeat("x", 65)} {
		w := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet,
			"/api/v1/system/api-usage/history?start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z&bucket=day&timezone="+zone, nil)
		(&TeslaUsageHandler{repo: usageReaderFake{}}).History(w, request)
		if w.Code != http.StatusBadRequest {
			t.Errorf("timezone %q: status = %d, want 400", zone, w.Code)
		}
	}
}

func TestTeslaUsageHistoryForwardsCalendarAndExactInstants(t *testing.T) {
	for _, zone := range []string{"", "UTC", "America/Los_Angeles", "Asia/Tokyo"} {
		seen := ""
		w := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet,
			"/api/v1/system/api-usage/history?start=2024-03-10T00:00:00-08:00&end=2024-03-11T00:00:00-07:00&bucket=week&timezone="+zone, nil)
		(&TeslaUsageHandler{repo: usageReaderFake{seenZone: &seen}}).History(w, request)
		wantZone := zone
		if wantZone == "" {
			wantZone = "UTC"
		}
		var result models.TeslaUsageSeriesResponse
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || seen != wantZone || result.Start.Format(time.RFC3339) != "2024-03-10T08:00:00Z" ||
			result.End.Format(time.RFC3339) != "2024-03-11T07:00:00Z" || result.Bucket != "week" {
			t.Errorf("zone %q: status=%d, calendar=%q, interval=%+v", zone, w.Code, seen, result)
		}
	}
}

func TestTeslaUsageHistoryCapsCivilDaysAcrossFallDST(t *testing.T) {
	for _, tc := range []struct {
		end    string
		status int
	}{
		{"2024-11-05T08:00:00Z", 200},
		{"2024-11-05T08:00:01Z", 400},
	} {
		w := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet,
			"/api/v1/system/api-usage/history?start=2023-11-05T07:00:00Z&end="+tc.end+"&bucket=day&timezone=America/Los_Angeles", nil)
		(&TeslaUsageHandler{repo: usageReaderFake{}}).History(w, request)
		if w.Code != tc.status {
			t.Errorf("end %s: status=%d, want %d; body=%s", tc.end, w.Code, tc.status, w.Body.String())
		}
	}
}
