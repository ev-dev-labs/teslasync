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
	location    *time.Location
	err         error
}

func (f *fakeReportStore) GetReport(_ context.Context, from, until time.Time, location *time.Location) (*dbnotif.Report, error) {
	f.from, f.until, f.location = from, until, location
	if f.err != nil {
		return nil, f.err
	}
	return &dbnotif.Report{From: from.Format(time.DateOnly), To: until.AddDate(0, 0, -1).Format(time.DateOnly),
		FromInstant: from.UTC().Format(time.RFC3339Nano), ToExclusive: until.UTC().Format(time.RFC3339Nano), Timezone: location.String(),
		Triggered: 1, Deliveries: 2, OutboundHTTPCalls: 3, UncorrelatedDeliveries: 0,
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
	if result.Triggered != 1 || result.Deliveries != 2 || result.OutboundHTTPCalls != 3 {
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

func TestGetReportPreservesHeaderInstantBounds(t *testing.T) {
	store := &fakeReportStore{}
	rec := httptest.NewRecorder()
	(&Handler{report: store}).GetReport(rec, httptest.NewRequest(http.MethodGet,
		"/api/v1/notifications/report?from_instant=2026-09-19T00%3A00%3A00-07%3A00&to_exclusive=2026-09-26T00%3A00%3A00-07%3A00", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if got := store.from.UTC().Format(time.RFC3339); got != "2026-09-19T07:00:00Z" {
		t.Fatalf("start = %s", got)
	}
	if got := store.until.UTC().Format(time.RFC3339); got != "2026-09-26T07:00:00Z" {
		t.Fatalf("exclusive end = %s", got)
	}
	if store.location != time.UTC {
		t.Fatalf("default location = %v, want UTC", store.location)
	}
}

func TestGetReportUsesSelectedTimezone(t *testing.T) {
	store := &fakeReportStore{}
	rec := httptest.NewRecorder()
	(&Handler{report: store}).GetReport(rec, httptest.NewRequest(http.MethodGet,
		"/api/v1/notifications/report?from_instant=2026-09-19T07%3A00%3A00Z&to_exclusive=2026-09-26T07%3A00%3A00Z&timezone=America%2FLos_Angeles", nil))
	if rec.Code != http.StatusOK || store.location.String() != "America/Los_Angeles" {
		t.Fatalf("timezone request: status %d, location %v", rec.Code, store.location)
	}
	var result dbnotif.Report
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Timezone != "America/Los_Angeles" {
		t.Fatalf("response timezone = %q", result.Timezone)
	}
}

func TestGetReportAllTimeRange(t *testing.T) {
	store := &fakeReportStore{}
	rec := httptest.NewRecorder()
	(&Handler{report: store}).GetReport(rec, httptest.NewRequest(http.MethodGet,
		"/api/v1/notifications/report?from=2015-01-01&to=2026-09-23", nil))
	if rec.Code != http.StatusOK || store.from.Format(time.DateOnly) != "2015-01-01" {
		t.Fatalf("all-time range: status %d, from %v", rec.Code, store.from)
	}
}

func TestGetReportRejectsInvalidRanges(t *testing.T) {
	for _, query := range []string{
		"?from=2026-02-30", "?to=2020-01-01&from=2020-01-02",
		"?from=1900-01-01&to=2025-01-01", "?from=2026-01-01T00:00:00Z",
		"?from_instant=2026-09-19T00:00:00Z", "?to_exclusive=2026-09-26T00:00:00Z",
		"?from=2026-09-19&from_instant=2026-09-19T00:00:00Z&to_exclusive=2026-09-26T00:00:00Z",
		"?from_instant=2026-09-26T00:00:00Z&to_exclusive=2026-09-19T00:00:00Z",
		"?timezone=Invalid/Zone",
		"?timezone=",
		"?timezone=Local",
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
