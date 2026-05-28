package api

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

// fakePinnedRepo is a goroutine-safe in-memory implementation of pinnedRepo.
// It mirrors the production transactional Create semantics (shift + insert
// at position 0) so tests exercise the same ordering invariant the handler
// relies on.
type fakePinnedRepo struct {
	mu     sync.Mutex
	rows   map[int64]*dashboardmodel.PinnedItem
	nextID int64

	listErr   error
	createErr error
	updateErr error
	deleteErr error
}

func newFakePinnedRepo() *fakePinnedRepo {
	return &fakePinnedRepo{
		rows:   map[int64]*dashboardmodel.PinnedItem{},
		nextID: 1,
	}
}

func (f *fakePinnedRepo) List(_ context.Context, filter dbadmin.PinnedListFilter) ([]*dashboardmodel.PinnedItem, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]*dashboardmodel.PinnedItem, 0)
	for _, row := range f.rows {
		if row.ItemType != filter.ItemType {
			continue
		}
		if !sameUserScope(row.UserID, filter.UserID) {
			continue
		}
		if filter.Context != nil && contextValue(row.Context) != *filter.Context {
			continue
		}
		out = append(out, clonePinnedForTest(row))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Position != out[j].Position {
			return out[i].Position < out[j].Position
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (f *fakePinnedRepo) GetByID(_ context.Context, id int64) (*dashboardmodel.PinnedItem, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[id]
	if !ok {
		return nil, nil
	}
	return clonePinnedForTest(row), nil
}

func (f *fakePinnedRepo) Create(_ context.Context, p *dashboardmodel.PinnedItem) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createErr != nil {
		return f.createErr
	}
	for _, row := range f.rows {
		if row.ItemType != p.ItemType {
			continue
		}
		if !sameUserScope(row.UserID, p.UserID) {
			continue
		}
		if contextValue(row.Context) != contextValue(p.Context) {
			continue
		}
		if row.ItemID == p.ItemID {
			return dbadmin.ErrPinnedAlreadyExists
		}
		row.Position++
	}
	p.ID = f.nextID
	f.nextID++
	p.Position = 0
	p.PinnedAt = time.Now().UTC()
	f.rows[p.ID] = clonePinnedForTest(p)
	return nil
}

func (f *fakePinnedRepo) UpdatePosition(_ context.Context, id int64, position int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErr != nil {
		return f.updateErr
	}
	row, ok := f.rows[id]
	if !ok {
		return pgx.ErrNoRows
	}
	row.Position = position
	return nil
}

func (f *fakePinnedRepo) Delete(_ context.Context, id int64) error {
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

func contextValue(c *string) string {
	if c == nil {
		return ""
	}
	return *c
}

func clonePinnedForTest(in *dashboardmodel.PinnedItem) *dashboardmodel.PinnedItem {
	out := *in
	if in.UserID != nil {
		v := *in.UserID
		out.UserID = &v
	}
	if in.Context != nil {
		v := *in.Context
		out.Context = &v
	}
	return &out
}

func newPinnedHandlerForTest(repo *fakePinnedRepo) *PinnedHandler {
	return &PinnedHandler{repo: repo}
}

func newPinnedRequest(method, target, body string, idParam string) *http.Request {
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

func TestPinned_List_RequiresType(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/pinned", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestPinned_List_RejectsBadType(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/pinned?type=bogus", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestPinned_List_EmptyReturnsArray(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/pinned?type=vehicle", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out []*dashboardmodel.PinnedItem
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out == nil || len(out) != 0 {
		t.Fatalf("want empty array, got %v", out)
	}
}

func TestPinned_List_FiltersByContext(t *testing.T) {
	repo := newFakePinnedRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	glance := "glance"
	hub := "hub"
	must(repo.Create(context.Background(), &dashboardmodel.PinnedItem{
		ItemType: dashboardmodel.PinnedItemTypeWidget, ItemID: "battery", Context: &glance,
	}))
	must(repo.Create(context.Background(), &dashboardmodel.PinnedItem{
		ItemType: dashboardmodel.PinnedItemTypeWidget, ItemID: "speed", Context: &hub,
	}))

	handler := newPinnedHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/pinned?type=widget&context=glance", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out []*dashboardmodel.PinnedItem
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(out) != 1 || out[0].ItemID != "battery" {
		t.Fatalf("expected battery widget only, got %#v", out)
	}
}

// ── Create ──────────────────────────────────────────────────────────────────

func TestPinned_Create_Success(t *testing.T) {
	repo := newFakePinnedRepo()
	handler := newPinnedHandlerForTest(repo)

	rec := httptest.NewRecorder()
	handler.Create(rec, newPinnedRequest(http.MethodPost, "/pinned",
		`{"item_type":"vehicle","item_id":"42"}`, ""))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var out dashboardmodel.PinnedItem
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.ID == 0 || out.ItemID != "42" || out.ItemType != dashboardmodel.PinnedItemTypeVehicle {
		t.Fatalf("unexpected response: %#v", out)
	}
	if out.Position != 0 {
		t.Fatalf("expected position 0 (newest), got %d", out.Position)
	}
}

func TestPinned_Create_RejectsBadType(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.Create(rec, newPinnedRequest(http.MethodPost, "/pinned",
		`{"item_type":"bogus","item_id":"1"}`, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPinned_Create_RejectsEmptyItemID(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.Create(rec, newPinnedRequest(http.MethodPost, "/pinned",
		`{"item_type":"vehicle","item_id":""}`, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPinned_Create_DuplicateReturns409(t *testing.T) {
	repo := newFakePinnedRepo()
	handler := newPinnedHandlerForTest(repo)
	first := newPinnedRequest(http.MethodPost, "/pinned",
		`{"item_type":"vehicle","item_id":"42"}`, "")
	rec := httptest.NewRecorder()
	handler.Create(rec, first)
	if rec.Code != http.StatusCreated {
		t.Fatalf("first create: status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	handler.Create(rec, newPinnedRequest(http.MethodPost, "/pinned",
		`{"item_type":"vehicle","item_id":"42"}`, ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate create: status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestPinned_Create_ShiftsExistingPinsDown(t *testing.T) {
	repo := newFakePinnedRepo()
	handler := newPinnedHandlerForTest(repo)
	for _, id := range []string{"1", "2", "3"} {
		rec := httptest.NewRecorder()
		handler.Create(rec, newPinnedRequest(http.MethodPost, "/pinned",
			`{"item_type":"vehicle","item_id":"`+id+`"}`, ""))
		if rec.Code != http.StatusCreated {
			t.Fatalf("create %s: status = %d", id, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/pinned?type=vehicle", nil))
	var out []*dashboardmodel.PinnedItem
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("want 3 pins, got %d", len(out))
	}
	// The newest pin (item_id "3") must float to position 0.
	if out[0].ItemID != "3" || out[1].ItemID != "2" || out[2].ItemID != "1" {
		t.Fatalf("unexpected ordering: %#v", out)
	}
	// Positions should be 0, 1, 2 in render order.
	for i, row := range out {
		if row.Position != i {
			t.Fatalf("pin %d: position = %d, want %d", i, row.Position, i)
		}
	}
}

// ── Update ──────────────────────────────────────────────────────────────────

func TestPinned_Update_Success(t *testing.T) {
	repo := newFakePinnedRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	row := &dashboardmodel.PinnedItem{ItemType: dashboardmodel.PinnedItemTypeVehicle, ItemID: "1"}
	must(repo.Create(context.Background(), row))

	handler := newPinnedHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Update(rec, newPinnedRequest(http.MethodPatch, "/pinned/1",
		`{"position":7}`, "1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out dashboardmodel.PinnedItem
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Position != 7 {
		t.Fatalf("position = %d, want 7", out.Position)
	}
}

func TestPinned_Update_NotFound(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.Update(rec, newPinnedRequest(http.MethodPatch, "/pinned/99",
		`{"position":1}`, "99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPinned_Update_RejectsNegativePosition(t *testing.T) {
	repo := newFakePinnedRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.PinnedItem{
		ItemType: dashboardmodel.PinnedItemTypeVehicle, ItemID: "1",
	}))

	handler := newPinnedHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Update(rec, newPinnedRequest(http.MethodPatch, "/pinned/1",
		`{"position":-3}`, "1"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestPinned_Update_RequiresPosition(t *testing.T) {
	repo := newFakePinnedRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.PinnedItem{
		ItemType: dashboardmodel.PinnedItemTypeVehicle, ItemID: "1",
	}))

	handler := newPinnedHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Update(rec, newPinnedRequest(http.MethodPatch, "/pinned/1", `{}`, "1"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// ── Delete ──────────────────────────────────────────────────────────────────

func TestPinned_Delete_Success(t *testing.T) {
	repo := newFakePinnedRepo()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(repo.Create(context.Background(), &dashboardmodel.PinnedItem{
		ItemType: dashboardmodel.PinnedItemTypeVehicle, ItemID: "1",
	}))

	handler := newPinnedHandlerForTest(repo)
	rec := httptest.NewRecorder()
	handler.Delete(rec, newPinnedRequest(http.MethodDelete, "/pinned/1", "", "1"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if _, ok := repo.rows[1]; ok {
		t.Fatalf("expected pin 1 to be deleted")
	}
}

func TestPinned_Delete_NotFound(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.Delete(rec, newPinnedRequest(http.MethodDelete, "/pinned/99", "", "99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPinned_Delete_RejectsBadID(t *testing.T) {
	handler := newPinnedHandlerForTest(newFakePinnedRepo())
	rec := httptest.NewRecorder()
	handler.Delete(rec, newPinnedRequest(http.MethodDelete, "/pinned/abc", "", "abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
