package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeDashboardLayoutRepo is a goroutine-safe in-memory implementation of
// dashboardLayoutRepo. It satisfies the handler's tiny interface so tests
// don't need a real Postgres pool.
type fakeDashboardLayoutRepo struct {
	mu     sync.Mutex
	rows   map[int64]*models.DashboardLayout
	nextID int64

	listErr   error
	getErr    error
	createErr error
	updateErr error
	deleteErr error
	applyErr  error
}

func newFakeDashboardLayoutRepo() *fakeDashboardLayoutRepo {
	return &fakeDashboardLayoutRepo{
		rows:   map[int64]*models.DashboardLayout{},
		nextID: 1,
	}
}

func (f *fakeDashboardLayoutRepo) List(_ context.Context, userID *int64, vehicleID *int64) ([]*models.DashboardLayout, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]*models.DashboardLayout, 0, len(f.rows))
	for _, row := range f.rows {
		if userID != nil && row.UserID != nil && *row.UserID != *userID {
			continue
		}
		if vehicleID != nil && row.VehicleID != nil && *row.VehicleID != *vehicleID {
			continue
		}
		out = append(out, cloneDashboardLayoutForTest(row))
	}
	return out, nil
}

func (f *fakeDashboardLayoutRepo) GetByID(_ context.Context, id int64) (*models.DashboardLayout, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.getErr != nil {
		return nil, f.getErr
	}
	row, ok := f.rows[id]
	if !ok {
		return nil, nil
	}
	return cloneDashboardLayoutForTest(row), nil
}

func (f *fakeDashboardLayoutRepo) Create(_ context.Context, l *models.DashboardLayout) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createErr != nil {
		return f.createErr
	}
	l.ID = f.nextID
	f.nextID++
	now := time.Now().UTC()
	l.CreatedAt = now
	l.UpdatedAt = now
	f.rows[l.ID] = cloneDashboardLayoutForTest(l)
	return nil
}

func (f *fakeDashboardLayoutRepo) Update(_ context.Context, id int64, name string, layout []byte, isDefault bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErr != nil {
		return f.updateErr
	}
	row, ok := f.rows[id]
	if !ok {
		return pgx.ErrNoRows
	}
	row.Name = name
	row.Layout = json.RawMessage(append([]byte(nil), layout...))
	row.IsDefault = isDefault
	row.UpdatedAt = time.Now().UTC()
	return nil
}

func (f *fakeDashboardLayoutRepo) Delete(_ context.Context, id int64) error {
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

func (f *fakeDashboardLayoutRepo) SetDefault(_ context.Context, id int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.applyErr != nil {
		return f.applyErr
	}
	target, ok := f.rows[id]
	if !ok {
		return pgx.ErrNoRows
	}
	for _, row := range f.rows {
		if row.ID == target.ID {
			continue
		}
		sameUser := samePtrInt64(row.UserID, target.UserID)
		sameVehicle := samePtrInt64(row.VehicleID, target.VehicleID)
		if sameUser && sameVehicle {
			row.IsDefault = false
		}
	}
	target.IsDefault = true
	return nil
}

func samePtrInt64(a, b *int64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func cloneDashboardLayoutForTest(in *models.DashboardLayout) *models.DashboardLayout {
	out := *in
	if in.UserID != nil {
		v := *in.UserID
		out.UserID = &v
	}
	if in.VehicleID != nil {
		v := *in.VehicleID
		out.VehicleID = &v
	}
	if in.Layout != nil {
		out.Layout = json.RawMessage(append([]byte(nil), in.Layout...))
	}
	return &out
}

func newDashboardLayoutHandlerForTest(repo *fakeDashboardLayoutRepo) *DashboardLayoutHandler {
	return &DashboardLayoutHandler{repo: repo}
}

func newDashboardLayoutRequest(method, target, body string, idParam string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if idParam != "" {
		ctx := chi.NewRouteContext()
		ctx.URLParams.Add("id", idParam)
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, ctx))
	}
	return req
}

// ── List ────────────────────────────────────────────────────────────────────

func TestDashboardLayoutList_EmptyReturnsArray(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/dashboard/layouts", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out []*models.DashboardLayout
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out == nil || len(out) != 0 {
		t.Fatalf("expected empty array, got %v", out)
	}
}

func TestDashboardLayoutList_FiltersByVehicle(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	v1 := int64(1)
	v2 := int64(2)
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "global", Layout: json.RawMessage(`{}`)})
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "v1", VehicleID: &v1, Layout: json.RawMessage(`{}`)})
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "v2", VehicleID: &v2, Layout: json.RawMessage(`{}`)})

	handler := newDashboardLayoutHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/dashboard/layouts?vehicle_id=1", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out []*models.DashboardLayout
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	gotNames := map[string]bool{}
	for _, l := range out {
		gotNames[l.Name] = true
	}
	// v1 (pinned) and global (vehicle_id IS NULL) should be visible; v2 must not.
	if !gotNames["v1"] || !gotNames["global"] || gotNames["v2"] {
		t.Fatalf("filter mismatch — got %v", gotNames)
	}
}

func TestDashboardLayoutList_RejectsBadVehicleID(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/dashboard/layouts?vehicle_id=not-a-number", nil))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// ── Create ──────────────────────────────────────────────────────────────────

func TestDashboardLayoutCreate_Happy(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	handler := newDashboardLayoutHandlerForTest(repo)

	body := `{"name":"Morning","layout":{"widgets":[],"layouts":{}}}`
	rec := httptest.NewRecorder()
	handler.Create(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts", body, ""))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var got models.DashboardLayout
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ID == 0 || got.Name != "Morning" {
		t.Fatalf("unexpected response: %+v", got)
	}
}

func TestDashboardLayoutCreate_RejectsMissingName(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	body := `{"layout":{"a":1}}`
	rec := httptest.NewRecorder()
	handler.Create(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts", body, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutCreate_RejectsNonObjectLayout(t *testing.T) {
	cases := []string{
		`{"name":"x","layout":[]}`,
		`{"name":"x","layout":42}`,
		`{"name":"x","layout":"oops"}`,
		`{"name":"x"}`, // missing layout
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
			rec := httptest.NewRecorder()
			handler.Create(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts", body, ""))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestDashboardLayoutCreate_RejectsBadVehicleID(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	body := `{"name":"x","layout":{},"vehicle_id":-1}`
	rec := httptest.NewRecorder()
	handler.Create(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts", body, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutCreate_RejectsLongName(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	long := strings.Repeat("a", 121)
	body := fmt.Sprintf(`{"name":%q,"layout":{}}`, long)
	rec := httptest.NewRecorder()
	handler.Create(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts", body, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutCreate_DefaultClearsOthers(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	// Pre-existing default for the same scope (global).
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "old", IsDefault: true, Layout: json.RawMessage(`{}`)})
	handler := newDashboardLayoutHandlerForTest(repo)

	body := `{"name":"new","is_default":true,"layout":{}}`
	rec := httptest.NewRecorder()
	handler.Create(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts", body, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}

	// Exactly one default for the scope
	defaults := 0
	for _, row := range repo.rows {
		if row.IsDefault {
			defaults++
		}
	}
	if defaults != 1 {
		t.Fatalf("expected exactly one default after create, got %d", defaults)
	}
}

// ── Update ──────────────────────────────────────────────────────────────────

func TestDashboardLayoutUpdate_404OnMissing(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.Update(rec, newDashboardLayoutRequest(http.MethodPut, "/dashboard/layouts/99", `{"name":"x"}`, "99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutUpdate_RejectsBadID(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.Update(rec, newDashboardLayoutRequest(http.MethodPut, "/dashboard/layouts/abc", `{}`, "abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutUpdate_PartialKeepsLayout(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "orig", Layout: json.RawMessage(`{"keep":1}`)})
	handler := newDashboardLayoutHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Update(rec, newDashboardLayoutRequest(http.MethodPut, "/dashboard/layouts/1", `{"name":"renamed"}`, "1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	row := repo.rows[1]
	if row.Name != "renamed" {
		t.Fatalf("name not updated: %+v", row)
	}
	if string(row.Layout) != `{"keep":1}` {
		t.Fatalf("layout was clobbered on partial update: %s", string(row.Layout))
	}
}

func TestDashboardLayoutUpdate_RejectsEmptyName(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "orig", Layout: json.RawMessage(`{}`)})
	handler := newDashboardLayoutHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Update(rec, newDashboardLayoutRequest(http.MethodPut, "/dashboard/layouts/1", `{"name":"   "}`, "1"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutUpdate_RejectsNonObjectLayout(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "orig", Layout: json.RawMessage(`{}`)})
	handler := newDashboardLayoutHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Update(rec, newDashboardLayoutRequest(http.MethodPut, "/dashboard/layouts/1", `{"layout":[]}`, "1"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// ── Delete ──────────────────────────────────────────────────────────────────

func TestDashboardLayoutDelete_Happy(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "x", Layout: json.RawMessage(`{}`)})
	handler := newDashboardLayoutHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Delete(rec, newDashboardLayoutRequest(http.MethodDelete, "/dashboard/layouts/1", "", "1"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
	if _, ok := repo.rows[1]; ok {
		t.Fatal("row still present after delete")
	}
}

func TestDashboardLayoutDelete_404OnMissing(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.Delete(rec, newDashboardLayoutRequest(http.MethodDelete, "/dashboard/layouts/42", "", "42"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutDelete_RejectsBadID(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.Delete(rec, newDashboardLayoutRequest(http.MethodDelete, "/dashboard/layouts/abc", "", "abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// ── Apply ───────────────────────────────────────────────────────────────────

func TestDashboardLayoutApply_FlipsDefault(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "a", IsDefault: true, Layout: json.RawMessage(`{}`)})
	_ = repo.Create(context.Background(), &models.DashboardLayout{Name: "b", IsDefault: false, Layout: json.RawMessage(`{}`)})

	handler := newDashboardLayoutHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Apply(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts/2/apply", "", "2"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if repo.rows[1].IsDefault {
		t.Fatal("layout 1 should no longer be default")
	}
	if !repo.rows[2].IsDefault {
		t.Fatal("layout 2 should be default after apply")
	}
}

func TestDashboardLayoutApply_404OnMissing(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.Apply(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts/99/apply", "", "99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutApply_RejectsBadID(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	rec := httptest.NewRecorder()
	handler.Apply(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts/abc/apply", "", "abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// ── Error propagation ──────────────────────────────────────────────────────

func TestDashboardLayoutList_RepoError500(t *testing.T) {
	repo := newFakeDashboardLayoutRepo()
	repo.listErr = errors.New("boom")
	handler := newDashboardLayoutHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/dashboard/layouts", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestDashboardLayoutCreate_RejectsOversizeBody(t *testing.T) {
	handler := newDashboardLayoutHandlerForTest(newFakeDashboardLayoutRepo())
	// > 1 MB body
	huge := strings.Repeat("a", maxDashboardLayoutBodyBytes+10)
	body := fmt.Sprintf(`{"name":"x","layout":{"data":%q}}`, huge)
	rec := httptest.NewRecorder()
	handler.Create(rec, newDashboardLayoutRequest(http.MethodPost, "/dashboard/layouts", body, ""))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body=%s", rec.Code, rec.Body.String())
	}
}
