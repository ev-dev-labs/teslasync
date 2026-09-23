package notification

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
)

type fakeReportStore struct {
	from, until time.Time
	err         error
}

func (f *fakeReportStore) GetReport(_ context.Context, from, until time.Time) (*dbnotif.Report, error) {
	f.from, f.until = from, until
	if f.err != nil {
		return nil, f.err
	}
	return &dbnotif.Report{From: from.Format(time.DateOnly), To: until.AddDate(0, 0, -1).Format(time.DateOnly),
		Triggered: 1, Deliveries: 2, UncorrelatedDeliveries: 0,
		BySource: []dbnotif.ReportKeyCount{}, ByType: []dbnotif.ReportKeyCount{},
		BySeverity: []dbnotif.ReportKeyCount{}, ByChannel: []dbnotif.ReportKeyCount{},
		ByStatus: []dbnotif.ReportKeyCount{}, Daily: []dbnotif.ReportDay{}}, nil
}

func TestGetReportRange(t *testing.T) {
	store := &fakeReportStore{}
	h := &Handler{report: store}
	rec := httptest.NewRecorder()
	h.GetReport(rec, httptest.NewRequest(http.MethodGet,
		"/api/v1/notifications/report?from=2020-01-01&to=2020-01-03", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if got := store.from.Format(time.DateOnly); got != "2020-01-01" {
		t.Fatalf("from = %s", got)
	}
	if got := store.until.Format(time.DateOnly); got != "2020-01-04" {
		t.Fatalf("exclusive until = %s", got)
	}
	var result dbnotif.Report
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Triggered != 1 || result.Deliveries != 2 {
		t.Fatalf("report = %+v", result)
	}
}

func TestGetReportDefaultThirtyDays(t *testing.T) {
	store := &fakeReportStore{}
	before := time.Now().UTC().Format(time.DateOnly)
	rec := httptest.NewRecorder()
	(&Handler{report: store}).GetReport(rec,
		httptest.NewRequest(http.MethodGet, "/api/v1/notifications/report", nil))
	after := time.Now().UTC().Format(time.DateOnly)
	if rec.Code != http.StatusOK || store.until.AddDate(0, 0, -1).Format(time.DateOnly) != after {
		t.Fatalf("unexpected default range status=%d until=%v today=%s", rec.Code, store.until, after)
	}
	if before == after {
		days := store.until.Sub(store.from).Hours() / 24
		if days != 30 {
			t.Fatalf("default includes %.0f days, want 30", days)
		}
	}
}

func TestGetReportRejectsInvalidRanges(t *testing.T) {
	for _, query := range []string{
		"?from=2026-02-30", "?to=2020-01-01&from=2020-01-02",
		"?from=2000-01-01&to=2025-01-01", "?from=2026-01-01T00:00:00Z",
	} {
		store := &fakeReportStore{}
		rec := httptest.NewRecorder()
		(&Handler{report: store}).GetReport(rec, httptest.NewRequest(http.MethodGet,
			"/api/v1/notifications/report"+query, nil))
		if rec.Code != http.StatusBadRequest || !store.from.IsZero() {
			t.Fatalf("%s: status %d, repo called %v", query, rec.Code, store.from)
		}
	}
}

func TestGetReportFailure(t *testing.T) {
	rec := httptest.NewRecorder()
	(&Handler{report: &fakeReportStore{err: errors.New("unavailable")}}).GetReport(rec,
		httptest.NewRequest(http.MethodGet, "/api/v1/notifications/report", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
}
