package activity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	dbactivity "github.com/ev-dev-labs/teslasync/internal/database/activity"
	activitymodel "github.com/ev-dev-labs/teslasync/internal/models/activity"
)

// fakeActivityRepo is a canned in-memory stand-in for activityRepository so
// Handler.List can be exercised without a live Postgres pool.
type fakeActivityRepo struct {
	items []activitymodel.Item
	total int64
	err   error

	gotFilters []dbactivity.Filters
}

func (f *fakeActivityRepo) List(_ context.Context, filters dbactivity.Filters) ([]activitymodel.Item, int64, error) {
	f.gotFilters = append(f.gotFilters, filters)
	if f.err != nil {
		return nil, 0, f.err
	}
	return f.items, f.total, nil
}

func newTestHandler(repo *fakeActivityRepo) *Handler {
	return &Handler{repo: repo}
}

func TestHandler_List_DefaultsAndEnvelope(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	repo := &fakeActivityRepo{
		items: []activitymodel.Item{
			{ID: "drives:1", Kind: activitymodel.KindDrive, OccurredAt: now, Title: "Drive", Summary: "12 min", Status: "completed", SourceTable: "drives", SourceID: 1},
		},
		total: 1,
	}
	h := newTestHandler(repo)

	req := httptest.NewRequest(http.MethodGet, "/activity", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var out activitymodel.ListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if out.Total != 1 || len(out.Items) != 1 {
		t.Fatalf("expected 1 item / total=1, got %+v", out)
	}
	if out.Limit != 50 || out.Offset != 0 {
		t.Errorf("expected default limit=50 offset=0, got limit=%d offset=%d", out.Limit, out.Offset)
	}
	if out.GeneratedAt.IsZero() {
		t.Errorf("expected generated_at to be set")
	}
	if len(repo.gotFilters) != 1 {
		t.Fatalf("expected exactly one repo call, got %d", len(repo.gotFilters))
	}
	if repo.gotFilters[0].VehicleID != nil {
		t.Errorf("expected nil vehicle_id filter by default, got %v", *repo.gotFilters[0].VehicleID)
	}
}

func TestHandler_List_NilItemsBecomeEmptyArray(t *testing.T) {
	t.Parallel()
	repo := &fakeActivityRepo{items: nil, total: 0}
	h := newTestHandler(repo)

	req := httptest.NewRequest(http.MethodGet, "/activity", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"items":[]`) {
		t.Errorf("expected items to serialize as [] not null, got %s", got)
	}
}

func TestHandler_List_InvalidVehicleID(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"abc", "0", "-5"} {
		repo := &fakeActivityRepo{}
		h := newTestHandler(repo)
		req := httptest.NewRequest(http.MethodGet, "/activity?vehicle_id="+raw, nil)
		rec := httptest.NewRecorder()
		h.List(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("vehicle_id=%q: expected 400, got %d", raw, rec.Code)
		}
		if len(repo.gotFilters) != 0 {
			t.Errorf("vehicle_id=%q: expected no repo call on validation failure", raw)
		}
	}
}

func TestHandler_List_ValidVehicleIDPropagates(t *testing.T) {
	t.Parallel()
	repo := &fakeActivityRepo{}
	h := newTestHandler(repo)
	req := httptest.NewRequest(http.MethodGet, "/activity?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.gotFilters) != 1 || repo.gotFilters[0].VehicleID == nil || *repo.gotFilters[0].VehicleID != 7 {
		t.Fatalf("expected vehicle_id=7 to propagate to repo filters, got %+v", repo.gotFilters)
	}
}

func TestHandler_List_KindFilter_CommaAndRepeated(t *testing.T) {
	t.Parallel()
	cases := []string{
		"/activity?kind=drive,charging",
		"/activity?kind=drive&kind=charging",
		"/activity?kind=charging&kind=drive,drive",
	}
	for _, url := range cases {
		repo := &fakeActivityRepo{}
		h := newTestHandler(repo)
		req := httptest.NewRequest(http.MethodGet, url, nil)
		rec := httptest.NewRecorder()
		h.List(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d: %s", url, rec.Code, rec.Body.String())
		}
		got := repo.gotFilters[0].Kinds
		if len(got) != 2 {
			t.Fatalf("%s: expected 2 distinct kinds, got %v", url, got)
		}
	}
}

func TestHandler_List_InvalidKindRejected(t *testing.T) {
	t.Parallel()
	repo := &fakeActivityRepo{}
	h := newTestHandler(repo)
	req := httptest.NewRequest(http.MethodGet, "/activity?kind=bogus", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid kind, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.gotFilters) != 0 {
		t.Errorf("expected no repo call when kind validation fails")
	}
}

func TestHandler_List_InvalidDateRejected(t *testing.T) {
	t.Parallel()
	for _, url := range []string{
		"/activity?start=not-a-date",
		"/activity?end=not-a-date",
		"/activity?start=2026-02-01&end=2026-01-01",
	} {
		repo := &fakeActivityRepo{}
		h := newTestHandler(repo)
		req := httptest.NewRequest(http.MethodGet, url, nil)
		rec := httptest.NewRecorder()
		h.List(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d: %s", url, rec.Code, rec.Body.String())
		}
		if len(repo.gotFilters) != 0 {
			t.Errorf("%s: expected no repo call on date validation failure", url)
		}
	}
}

func TestHandler_List_PaginationValidation(t *testing.T) {
	t.Parallel()
	for _, url := range []string{
		"/activity?limit=0",
		"/activity?limit=501",
		"/activity?limit=not-a-number",
		"/activity?offset=-1",
		"/activity?offset=not-a-number",
	} {
		repo := &fakeActivityRepo{}
		h := newTestHandler(repo)
		req := httptest.NewRequest(http.MethodGet, url, nil)
		rec := httptest.NewRecorder()
		h.List(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d: %s", url, rec.Code, rec.Body.String())
		}
		if len(repo.gotFilters) != 0 {
			t.Errorf("%s: expected no repo call on pagination validation failure", url)
		}
	}
}

func TestHandler_List_PaginationEnvelopeMatchesQuery(t *testing.T) {
	t.Parallel()
	repo := &fakeActivityRepo{}
	h := newTestHandler(repo)
	req := httptest.NewRequest(http.MethodGet, "/activity?limit=500&offset=25", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var out activitymodel.ListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Limit != 500 || out.Offset != 25 {
		t.Fatalf("response pagination = %d/%d, want 500/25", out.Limit, out.Offset)
	}
	if got := repo.gotFilters[0]; got.Limit != 500 || got.Offset != 25 {
		t.Fatalf("repo pagination = %d/%d, want 500/25", got.Limit, got.Offset)
	}
}

func TestHandler_List_RepoErrorIsInternalServerError(t *testing.T) {
	t.Parallel()
	repo := &fakeActivityRepo{err: errors.New("boom")}
	h := newTestHandler(repo)
	req := httptest.NewRequest(http.MethodGet, "/activity", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_RepoImplementsPort(t *testing.T) {
	t.Parallel()
	var _ activityRepository = (*dbactivity.Repo)(nil)
}
