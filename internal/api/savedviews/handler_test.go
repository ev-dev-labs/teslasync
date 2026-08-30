package savedviews

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
)

// fakeSavedViewsRepo is a goroutine-safe in-memory implementation of
// savedViewsRepo. It mirrors the production transactional Create/Update
// semantics — name uniqueness inside (user, route) and at-most-one
// default per (user, route) — so the handler tests exercise the same
// invariants the DB enforces.
type fakeSavedViewsRepo struct {
	mu     sync.Mutex
	rows   map[int64]*dashboardmodel.SavedView
	nextID int64

	listErr   error
	createErr error
	updateErr error
	deleteErr error
}

func newFakeSavedViewsRepo() *fakeSavedViewsRepo {
	return &fakeSavedViewsRepo{
		rows:   map[int64]*dashboardmodel.SavedView{},
		nextID: 1,
	}
}

func (f *fakeSavedViewsRepo) List(_ context.Context, filter dbadmin.SavedViewListFilter) ([]*dashboardmodel.SavedView, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]*dashboardmodel.SavedView, 0)
	for _, row := range f.rows {
		if filter.Route != "" && row.Route != filter.Route {
			continue
		}
		if !sameUserScope(row.UserID, filter.UserID) {
			continue
		}
		out = append(out, cloneSavedViewForTest(row))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsPinned != out[j].IsPinned {
			return out[i].IsPinned
		}
		if out[i].Route != out[j].Route {
			return out[i].Route < out[j].Route
		}
		if out[i].SortOrder != out[j].SortOrder {
			return out[i].SortOrder < out[j].SortOrder
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (f *fakeSavedViewsRepo) GetByID(_ context.Context, id int64) (*dashboardmodel.SavedView, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[id]
	if !ok {
		return nil, nil
	}
	return cloneSavedViewForTest(row), nil
}

func (f *fakeSavedViewsRepo) Create(_ context.Context, v *dashboardmodel.SavedView) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createErr != nil {
		return f.createErr
	}
	for _, row := range f.rows {
		if row.Route == v.Route &&
			sameUserScope(row.UserID, v.UserID) &&
			row.Name == v.Name {
			return dbadmin.ErrSavedViewAlreadyExists
		}
	}
	if v.IsDefault {
		f.clearDefaultLocked(v.UserID, v.Route)
	}
	v.ID = f.nextID
	f.nextID++
	now := time.Now().UTC()
	v.CreatedAt = now
	v.UpdatedAt = now
	f.rows[v.ID] = cloneSavedViewForTest(v)
	return nil
}

func (f *fakeSavedViewsRepo) Update(_ context.Context, id int64, patch dbadmin.SavedViewUpdate) (*dashboardmodel.SavedView, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	row, ok := f.rows[id]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	if patch.Name != nil && *patch.Name != row.Name {
		for _, other := range f.rows {
			if other.ID == row.ID {
				continue
			}
			if other.Route == row.Route &&
				sameUserScope(other.UserID, row.UserID) &&
				other.Name == *patch.Name {
				return nil, dbadmin.ErrSavedViewAlreadyExists
			}
		}
		row.Name = *patch.Name
	}
	if patch.Query != nil {
		row.Query = *patch.Query
	}
	if patch.IsDefault != nil {
		if *patch.IsDefault {
			f.clearDefaultLocked(row.UserID, row.Route)
		}
		row.IsDefault = *patch.IsDefault
	}
	if patch.IsPinned != nil {
		row.IsPinned = *patch.IsPinned
	}
	if patch.SortOrder != nil {
		row.SortOrder = *patch.SortOrder
	}
	row.UpdatedAt = time.Now().UTC()
	return cloneSavedViewForTest(row), nil
}

func (f *fakeSavedViewsRepo) Delete(_ context.Context, id int64) error {
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

func (f *fakeSavedViewsRepo) clearDefaultLocked(userID *int64, route string) {
	for _, row := range f.rows {
		if row.IsDefault && row.Route == route && sameUserScope(row.UserID, userID) {
			row.IsDefault = false
		}
	}
}

func sameUserScope(a, b *int64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		// Filter UserID == nil acts as "any user" (single-user install
		// behaviour) so a nil filter matches every row.
		return b == nil
	}
	return *a == *b
}

func cloneSavedViewForTest(in *dashboardmodel.SavedView) *dashboardmodel.SavedView {
	out := *in
	if in.UserID != nil {
		v := *in.UserID
		out.UserID = &v
	}
	return &out
}

func newHandlerForTest(repo *fakeSavedViewsRepo) *Handler {
	// audit callback is left nil so the handler skips the audit insert —
	// there's no real DB pool in unit tests.
	return &Handler{repo: repo}
}

func newSavedViewRequest(method, target, body, idParam string) *http.Request {
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

func TestSavedViews_List_WithoutRouteReturnsAllRoutes(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	for _, view := range []*dashboardmodel.SavedView{
		{Name: "Drives", Route: "/drives", Query: "range=7d"},
		{Name: "Charging", Route: "/charging", Query: "type=supercharger"},
	} {
		if err := repo.Create(context.Background(), view); err != nil {
			t.Fatal(err)
		}
	}

	handler := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/saved-views", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out []*dashboardmodel.SavedView
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(out) != 2 || out[0].Route != "/charging" || out[1].Route != "/drives" {
		t.Fatalf("expected both routes in stable order, got %#v", out)
	}
}

func TestSavedViews_List_RejectsBadRoute(t *testing.T) {
	cases := []string{"drives", "javascript:alert(1)", "/" + strings.Repeat("x", 200), "/foo//bar"}
	for _, route := range cases {
		t.Run(route, func(t *testing.T) {
			handler := newHandlerForTest(newFakeSavedViewsRepo())
			rec := httptest.NewRecorder()
			handler.List(rec, httptest.NewRequest(http.MethodGet, "/saved-views?route="+route, nil))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestSavedViews_List_EmptyReturnsArray(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/saved-views?route=/drives", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out []*dashboardmodel.SavedView
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out == nil || len(out) != 0 {
		t.Fatalf("want empty array, got %v", out)
	}
}

func TestSavedViews_List_ScopedByRoute(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.SavedView{
		Name: "A", Route: "/drives", Query: "from=2025-04-01",
	}))
	must(repo.Create(context.Background(), &dashboardmodel.SavedView{
		Name: "B", Route: "/charging", Query: "type=supercharger",
	}))

	handler := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/saved-views?route=/drives", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out []*dashboardmodel.SavedView
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(out) != 1 || out[0].Name != "A" {
		t.Fatalf("expected only the /drives view, got %#v", out)
	}
}

func TestSavedViews_List_PinnedFirst(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.SavedView{
		Name: "Plain", Route: "/drives", Query: "a=1", SortOrder: 0,
	}))
	must(repo.Create(context.Background(), &dashboardmodel.SavedView{
		Name: "Pinned", Route: "/drives", Query: "a=2", SortOrder: 5, IsPinned: true,
	}))

	handler := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/saved-views?route=/drives", nil))
	var out []*dashboardmodel.SavedView
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(out) != 2 || out[0].Name != "Pinned" || out[1].Name != "Plain" {
		t.Fatalf("expected pinned-first ordering, got %#v", out)
	}
}

// ── Create ──────────────────────────────────────────────────────────────────

func TestSavedViews_Create_Success(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	handler := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"Last week","route":"/drives","query":"from=2025-04-24&sort=distance"}`, ""))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var out dashboardmodel.SavedView
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.ID == 0 || out.Name != "Last week" || out.Route != "/drives" {
		t.Fatalf("unexpected response: %#v", out)
	}
	if out.Query != "from=2025-04-24&sort=distance" {
		t.Fatalf("query mangled: %q", out.Query)
	}
}

func TestSavedViews_Create_StripsLeadingQuestion(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	handler := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"Q","route":"/drives","query":"?sort=date"}`, ""))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var out dashboardmodel.SavedView
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Query != "sort=date" {
		t.Fatalf("query should be stripped of leading ?: %q", out.Query)
	}
}

func TestSavedViews_Create_RejectsEmptyName(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"   ","route":"/drives","query":"a=1"}`, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestSavedViews_Create_RejectsLongName(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	long := strings.Repeat("x", maxSavedViewNameLen+1)
	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"`+long+`","route":"/drives","query":"a=1"}`, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestSavedViews_Create_RejectsBadRoute(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"x","route":"drives","query":"a=1"}`, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestSavedViews_Create_RejectsLongQuery(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	long := strings.Repeat("a", maxSavedViewQueryLen+1)
	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"x","route":"/drives","query":"`+long+`"}`, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestSavedViews_Create_RejectsFragmentInQuery(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"x","route":"/drives","query":"a=1#frag"}`, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestSavedViews_Create_DuplicateNameReturns409(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	handler := newHandlerForTest(repo)
	first := newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"Recent","route":"/drives","query":"a=1"}`, "")
	rec := httptest.NewRecorder()
	handler.Create(rec, first)
	if rec.Code != http.StatusCreated {
		t.Fatalf("first create: status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"Recent","route":"/drives","query":"a=2"}`, ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate create: status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestSavedViews_Create_DefaultClearsPrior(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	handler := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"A","route":"/drives","query":"a=1","is_default":true}`, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("first create: status = %d; body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	handler.Create(rec, newSavedViewRequest(http.MethodPost, "/saved-views",
		`{"name":"B","route":"/drives","query":"a=2","is_default":true}`, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("second create: status = %d; body=%s", rec.Code, rec.Body.String())
	}

	// List the bucket — only B should still be the default.
	rec = httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/saved-views?route=/drives", nil))
	var out []*dashboardmodel.SavedView
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	defaults := 0
	for _, v := range out {
		if v.IsDefault {
			defaults++
			if v.Name != "B" {
				t.Fatalf("default = %q, want B", v.Name)
			}
		}
	}
	if defaults != 1 {
		t.Fatalf("want exactly 1 default, got %d", defaults)
	}
}

// ── Update ──────────────────────────────────────────────────────────────────

func TestSavedViews_Update_Success(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	row := &dashboardmodel.SavedView{Name: "A", Route: "/drives", Query: "a=1"}
	must(repo.Create(context.Background(), row))

	handler := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Update(rec, newSavedViewRequest(http.MethodPut, "/saved-views/1",
		`{"name":"Renamed","is_pinned":true}`, "1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out dashboardmodel.SavedView
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Name != "Renamed" || !out.IsPinned {
		t.Fatalf("update did not apply: %#v", out)
	}
}

func TestSavedViews_Update_NotFound(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.Update(rec, newSavedViewRequest(http.MethodPut, "/saved-views/99",
		`{"name":"x"}`, "99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestSavedViews_Update_RejectsBadID(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.Update(rec, newSavedViewRequest(http.MethodPut, "/saved-views/abc",
		`{"name":"x"}`, "abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestSavedViews_Update_SetDefaultClearsPrior(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.SavedView{
		Name: "A", Route: "/drives", Query: "a=1", IsDefault: true,
	}))
	b := &dashboardmodel.SavedView{Name: "B", Route: "/drives", Query: "a=2"}
	must(repo.Create(context.Background(), b))

	handler := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Update(rec, newSavedViewRequest(http.MethodPut, "/saved-views/2",
		`{"is_default":true}`, "2"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/saved-views?route=/drives", nil))
	var out []*dashboardmodel.SavedView
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	for _, v := range out {
		if v.Name == "A" && v.IsDefault {
			t.Fatalf("A should no longer be default: %#v", v)
		}
		if v.Name == "B" && !v.IsDefault {
			t.Fatalf("B should be default: %#v", v)
		}
	}
}

func TestSavedViews_Update_RejectsLongName(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.SavedView{
		Name: "A", Route: "/drives", Query: "a=1",
	}))

	handler := newHandlerForTest(repo)
	long := strings.Repeat("x", maxSavedViewNameLen+1)
	rec := httptest.NewRecorder()
	handler.Update(rec, newSavedViewRequest(http.MethodPut, "/saved-views/1",
		`{"name":"`+long+`"}`, "1"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// ── Delete ──────────────────────────────────────────────────────────────────

func TestSavedViews_Delete_Success(t *testing.T) {
	repo := newFakeSavedViewsRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.SavedView{
		Name: "A", Route: "/drives", Query: "a=1",
	}))

	handler := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Delete(rec, newSavedViewRequest(http.MethodDelete, "/saved-views/1", "", "1"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if _, ok := repo.rows[1]; ok {
		t.Fatalf("expected view 1 to be deleted")
	}
}

func TestSavedViews_Delete_NotFound(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.Delete(rec, newSavedViewRequest(http.MethodDelete, "/saved-views/99", "", "99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestSavedViews_Delete_RejectsBadID(t *testing.T) {
	handler := newHandlerForTest(newFakeSavedViewsRepo())
	rec := httptest.NewRecorder()
	handler.Delete(rec, newSavedViewRequest(http.MethodDelete, "/saved-views/abc", "", "abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
