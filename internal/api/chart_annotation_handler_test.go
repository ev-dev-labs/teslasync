package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
)

// fakeChartAnnotationRepo is a goroutine-safe in-memory implementation of
// chartAnnotationRepo. It satisfies the handler's tiny interface so tests
// don't need a real Postgres pool.
type fakeChartAnnotationRepo struct {
	mu     sync.Mutex
	rows   map[int64]*dashboardmodel.ChartAnnotation
	nextID int64

	listErr   error
	createErr error
	updateErr error
	deleteErr error
}

func newFakeChartAnnotationRepo() *fakeChartAnnotationRepo {
	return &fakeChartAnnotationRepo{
		rows:   map[int64]*dashboardmodel.ChartAnnotation{},
		nextID: 1,
	}
}

func (f *fakeChartAnnotationRepo) List(_ context.Context, filter dbadmin.ChartAnnotationFilter) ([]*dashboardmodel.ChartAnnotation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]*dashboardmodel.ChartAnnotation, 0, len(f.rows))
	for _, row := range f.rows {
		// Vehicle scoping is inclusive: include rows pinned to the requested
		// vehicle PLUS rows with vehicle_id IS NULL (fleet-wide).
		if filter.VehicleID != nil && row.VehicleID != nil && *row.VehicleID != *filter.VehicleID {
			continue
		}
		if filter.From != nil && row.OccurredAt.Before(*filter.From) {
			continue
		}
		if filter.To != nil && row.OccurredAt.After(*filter.To) {
			continue
		}
		if filter.Scope != "" {
			if len(row.Scope) > 0 {
				match := false
				for _, s := range row.Scope {
					if s == filter.Scope {
						match = true
						break
					}
				}
				if !match {
					continue
				}
			}
			// Empty row.Scope means "all charts" — fall through.
		}
		out = append(out, cloneChartAnnotationForTest(row))
	}
	return out, nil
}

func (f *fakeChartAnnotationRepo) GetByID(_ context.Context, id int64) (*dashboardmodel.ChartAnnotation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[id]
	if !ok {
		return nil, nil
	}
	return cloneChartAnnotationForTest(row), nil
}

func (f *fakeChartAnnotationRepo) Create(_ context.Context, a *dashboardmodel.ChartAnnotation) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createErr != nil {
		return f.createErr
	}
	a.ID = f.nextID
	f.nextID++
	now := time.Now().UTC()
	a.CreatedAt = now
	a.UpdatedAt = now
	if a.Scope == nil {
		a.Scope = []string{}
	}
	f.rows[a.ID] = cloneChartAnnotationForTest(a)
	return nil
}

func (f *fakeChartAnnotationRepo) Update(_ context.Context, id int64, patch dbadmin.ChartAnnotationUpdate) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErr != nil {
		return f.updateErr
	}
	row, ok := f.rows[id]
	if !ok {
		return pgx.ErrNoRows
	}
	if patch.OccurredAt != nil {
		row.OccurredAt = *patch.OccurredAt
	}
	if patch.Category != nil {
		row.Category = *patch.Category
	}
	if patch.Title != nil {
		row.Title = *patch.Title
	}
	if patch.ClearDescription {
		row.Description = nil
	} else if patch.Description != nil {
		v := *patch.Description
		row.Description = &v
	}
	if patch.Scope != nil {
		row.Scope = append([]string(nil), (*patch.Scope)...)
	}
	if patch.ClearColor {
		row.Color = nil
	} else if patch.Color != nil {
		v := *patch.Color
		row.Color = &v
	}
	row.UpdatedAt = time.Now().UTC()
	return nil
}

func (f *fakeChartAnnotationRepo) Delete(_ context.Context, id int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.rows[id]; !ok {
		return pgx.ErrNoRows
	}
	delete(f.rows, id)
	return nil
}

func cloneChartAnnotationForTest(in *dashboardmodel.ChartAnnotation) *dashboardmodel.ChartAnnotation {
	out := *in
	if in.UserID != nil {
		v := *in.UserID
		out.UserID = &v
	}
	if in.VehicleID != nil {
		v := *in.VehicleID
		out.VehicleID = &v
	}
	if in.Description != nil {
		v := *in.Description
		out.Description = &v
	}
	if in.Color != nil {
		v := *in.Color
		out.Color = &v
	}
	out.Scope = append([]string(nil), in.Scope...)
	return &out
}

func newChartAnnotationHandlerForTest(repo *fakeChartAnnotationRepo) *ChartAnnotationHandler {
	return &ChartAnnotationHandler{repo: repo}
}

func newChartAnnotationRequest(method, target, body string, idParam string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if idParam != "" {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", idParam)
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	}
	return req
}

// ── List ────────────────────────────────────────────────────────────────────

func TestChartAnnotationsList_EmptyReturnsArray(t *testing.T) {
	handler := newChartAnnotationHandlerForTest(newFakeChartAnnotationRepo())
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/annotations", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out []*dashboardmodel.ChartAnnotation
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out == nil || len(out) != 0 {
		t.Fatalf("want empty array, got %v", out)
	}
}

func TestChartAnnotationsList_FiltersByVehicleAndScope(t *testing.T) {
	repo := newFakeChartAnnotationRepo()
	v1, v2 := int64(1), int64(2)
	now := time.Now().UTC()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.ChartAnnotation{
		VehicleID: &v1, OccurredAt: now, Category: dashboardmodel.AnnotationCategoryMaintenance,
		Title: "Tire rotation", Scope: []string{"tire"},
	}))
	must(repo.Create(context.Background(), &dashboardmodel.ChartAnnotation{
		VehicleID: &v2, OccurredAt: now, Category: dashboardmodel.AnnotationCategoryUpgrade,
		Title: "Software update", Scope: []string{"battery", "efficiency"},
	}))
	must(repo.Create(context.Background(), &dashboardmodel.ChartAnnotation{
		// Fleet-wide annotation (vehicle_id IS NULL) should always show up.
		OccurredAt: now, Category: dashboardmodel.AnnotationCategoryCustom,
		Title: "Utility rate change", Scope: []string{"cost"},
	}))

	handler := newChartAnnotationHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/annotations?vehicle_id=1&scope=tire", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out []*dashboardmodel.ChartAnnotation
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(out) != 1 || out[0].Title != "Tire rotation" {
		t.Fatalf("want tire annotation, got %#v", out)
	}
}

func TestChartAnnotationsList_RejectsInvalidParams(t *testing.T) {
	handler := newChartAnnotationHandlerForTest(newFakeChartAnnotationRepo())
	tests := []struct {
		name string
		path string
	}{
		{"bad vehicle_id", "/annotations?vehicle_id=abc"},
		{"negative vehicle_id", "/annotations?vehicle_id=-1"},
		{"bad scope", "/annotations?scope=bogus"},
		{"bad from", "/annotations?from=garbage"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.List(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

// ── Create ──────────────────────────────────────────────────────────────────

func TestChartAnnotationsCreate_Success(t *testing.T) {
	repo := newFakeChartAnnotationRepo()
	handler := newChartAnnotationHandlerForTest(repo)
	body := `{
		"vehicle_id": 42,
		"occurred_at": "2024-06-15T00:00:00Z",
		"category": "maintenance",
		"title": "Tire rotation",
		"description": "Front to back",
		"scope": ["tire"]
	}`
	rec := httptest.NewRecorder()
	handler.Create(rec, newChartAnnotationRequest(http.MethodPost, "/annotations", body, ""))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var out dashboardmodel.ChartAnnotation
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.ID == 0 {
		t.Fatal("expected id to be assigned")
	}
	if out.Title != "Tire rotation" || out.Category != dashboardmodel.AnnotationCategoryMaintenance {
		t.Fatalf("unexpected payload: %#v", out)
	}
	if len(out.Scope) != 1 || out.Scope[0] != "tire" {
		t.Fatalf("scope = %v, want [tire]", out.Scope)
	}
}

func TestChartAnnotationsCreate_ValidationErrors(t *testing.T) {
	handler := newChartAnnotationHandlerForTest(newFakeChartAnnotationRepo())
	tests := []struct {
		name string
		body string
	}{
		{"missing occurred_at", `{"category":"custom","title":"x"}`},
		{"missing category", `{"occurred_at":"2024-01-01","title":"x"}`},
		{"unknown category", `{"occurred_at":"2024-01-01","category":"nope","title":"x"}`},
		{"missing title", `{"occurred_at":"2024-01-01","category":"custom"}`},
		{"empty title", `{"occurred_at":"2024-01-01","category":"custom","title":"   "}`},
		{"long title", `{"occurred_at":"2024-01-01","category":"custom","title":"` + strings.Repeat("x", 101) + `"}`},
		{"bad scope bucket", `{"occurred_at":"2024-01-01","category":"custom","title":"x","scope":["bogus"]}`},
		{"bad color", `{"occurred_at":"2024-01-01","category":"custom","title":"x","color":"red"}`},
		{"negative vehicle_id", `{"vehicle_id":-1,"occurred_at":"2024-01-01","category":"custom","title":"x"}`},
		{"invalid json", `{not-json`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.Create(rec, newChartAnnotationRequest(http.MethodPost, "/annotations", tc.body, ""))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestChartAnnotationsCreate_AcceptsDateOnlyTimestamp(t *testing.T) {
	repo := newFakeChartAnnotationRepo()
	handler := newChartAnnotationHandlerForTest(repo)
	body := `{"occurred_at":"2024-06-15","category":"milestone","title":"Day 1"}`
	rec := httptest.NewRecorder()
	handler.Create(rec, newChartAnnotationRequest(http.MethodPost, "/annotations", body, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

// ── Update ──────────────────────────────────────────────────────────────────

func TestChartAnnotationsUpdate_Success(t *testing.T) {
	repo := newFakeChartAnnotationRepo()
	now := time.Now().UTC()
	if err := repo.Create(context.Background(), &dashboardmodel.ChartAnnotation{
		OccurredAt: now, Category: dashboardmodel.AnnotationCategoryMilestone,
		Title: "Original", Scope: []string{"battery"},
	}); err != nil {
		t.Fatal(err)
	}
	handler := newChartAnnotationHandlerForTest(repo)

	body := `{"title":"Renamed","description":"more context"}`
	rec := httptest.NewRecorder()
	handler.Update(rec, newChartAnnotationRequest(http.MethodPatch, "/annotations/1", body, "1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out dashboardmodel.ChartAnnotation
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Title != "Renamed" {
		t.Fatalf("title = %q, want Renamed", out.Title)
	}
	if out.Description == nil || *out.Description != "more context" {
		t.Fatalf("description = %v", out.Description)
	}
}

func TestChartAnnotationsUpdate_NotFound(t *testing.T) {
	handler := newChartAnnotationHandlerForTest(newFakeChartAnnotationRepo())
	rec := httptest.NewRecorder()
	handler.Update(rec, newChartAnnotationRequest(http.MethodPatch, "/annotations/999", `{"title":"x"}`, "999"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestChartAnnotationsUpdate_BadID(t *testing.T) {
	handler := newChartAnnotationHandlerForTest(newFakeChartAnnotationRepo())
	rec := httptest.NewRecorder()
	handler.Update(rec, newChartAnnotationRequest(http.MethodPatch, "/annotations/0", `{"title":"x"}`, "0"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// ── Delete ──────────────────────────────────────────────────────────────────

func TestChartAnnotationsDelete_Success(t *testing.T) {
	repo := newFakeChartAnnotationRepo()
	if err := repo.Create(context.Background(), &dashboardmodel.ChartAnnotation{
		OccurredAt: time.Now().UTC(), Category: dashboardmodel.AnnotationCategoryCustom,
		Title: "x",
	}); err != nil {
		t.Fatal(err)
	}
	handler := newChartAnnotationHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Delete(rec, newChartAnnotationRequest(http.MethodDelete, "/annotations/1", "", "1"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
}

func TestChartAnnotationsDelete_NotFound(t *testing.T) {
	handler := newChartAnnotationHandlerForTest(newFakeChartAnnotationRepo())
	rec := httptest.NewRecorder()
	handler.Delete(rec, newChartAnnotationRequest(http.MethodDelete, "/annotations/999", "", "999"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// ── helpers tests ───────────────────────────────────────────────────────────

func TestParseAnnotationTime(t *testing.T) {
	if _, err := parseAnnotationTime("2024-06-15"); err != nil {
		t.Fatalf("date-only failed: %v", err)
	}
	if _, err := parseAnnotationTime("2024-06-15T12:34:56Z"); err != nil {
		t.Fatalf("RFC3339 failed: %v", err)
	}
	if _, err := parseAnnotationTime("garbage"); err == nil {
		t.Fatal("expected error for garbage input")
	}
}

func TestIsValidHexColor(t *testing.T) {
	good := []string{"#fff", "#FFFFFF", "#3b82f6", "#3b82f6ff"}
	for _, s := range good {
		if !isValidHexColor(s) {
			t.Errorf("expected %q to be valid", s)
		}
	}
	bad := []string{"", "fff", "#xyz", "#1234", "red", "#1234567"}
	for _, s := range bad {
		if isValidHexColor(s) {
			t.Errorf("expected %q to be invalid", s)
		}
	}
}

func TestIsValidScopeBucket(t *testing.T) {
	for _, s := range []string{"battery", "efficiency", "cost", "tire", "energy", "drivetrain", "mileage", "charging"} {
		if !isValidScopeBucket(s) {
			t.Errorf("expected %q to be valid", s)
		}
	}
	for _, s := range []string{"", "bogus", "BATTERY"} {
		if isValidScopeBucket(s) {
			t.Errorf("expected %q to be invalid", s)
		}
	}
}
