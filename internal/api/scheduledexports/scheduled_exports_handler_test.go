// Scheduled exports HTTP handler tests.
//
// These pin AUTH_GUARD_CHECK's boundary: owner_subject comes only from the
// configured ForwardAuth header, and body-supplied owner_subject is rejected
// by DisallowUnknownFields. The hand-rolled store keeps the protocol visible.
package scheduledexports

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	exportdb "github.com/ev-dev-labs/teslasync/internal/database/export"
)

type fakeScheduledExportStore struct {
	mu     sync.Mutex
	rows   map[int64]*exportdb.ScheduledExportRow
	nextID int64

	// errOn[op] — when set, the store returns this error from op.
	errOn map[string]error
}

func newFakeScheduledExportStore() *fakeScheduledExportStore {
	return &fakeScheduledExportStore{
		rows:   make(map[int64]*exportdb.ScheduledExportRow),
		nextID: 1,
		errOn:  make(map[string]error),
	}
}

func (s *fakeScheduledExportStore) Create(_ context.Context, owner string, in exportdb.ScheduledExportInput, now time.Time) (*exportdb.ScheduledExportRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.errOn["create"]; err != nil {
		return nil, err
	}
	canon, err := exportdb.NormalizeScheduledExportInput(in)
	if err != nil {
		return nil, err
	}
	id := s.nextID
	s.nextID++
	row := &exportdb.ScheduledExportRow{
		ID:           id,
		OwnerSubject: owner,
		Name:         canon.Name,
		ExportType:   canon.ExportType,
		Format:       canon.Format,
		VehicleID:    canon.VehicleID,
		Columns:      canon.Columns,
		ScheduleCron: canon.ScheduleCron,
		Delivery:     canon.Delivery,
		RangeWindow:  canon.RangeWindow,
		Enabled:      canon.Enabled,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	s.rows[id] = row
	return row, nil
}

func (s *fakeScheduledExportStore) Get(_ context.Context, id int64) (*exportdb.ScheduledExportRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.errOn["get"]; err != nil {
		return nil, err
	}
	row, ok := s.rows[id]
	if !ok {
		return nil, exportdb.ErrScheduledExportNotFound
	}
	clone := *row
	return &clone, nil
}

func (s *fakeScheduledExportStore) ListByOwner(_ context.Context, owner string) ([]exportdb.ScheduledExportRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.errOn["list"]; err != nil {
		return nil, err
	}
	out := make([]exportdb.ScheduledExportRow, 0)
	for _, row := range s.rows {
		if row.OwnerSubject == owner {
			out = append(out, *row)
		}
	}
	return out, nil
}

func (s *fakeScheduledExportStore) Update(_ context.Context, id int64, owner string, in exportdb.ScheduledExportInput, now time.Time) (*exportdb.ScheduledExportRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.errOn["update"]; err != nil {
		return nil, err
	}
	row, ok := s.rows[id]
	if !ok || row.OwnerSubject != owner {
		return nil, exportdb.ErrScheduledExportNotFound
	}
	canon, err := exportdb.NormalizeScheduledExportInput(in)
	if err != nil {
		return nil, err
	}
	row.Name = canon.Name
	row.ExportType = canon.ExportType
	row.Format = canon.Format
	row.VehicleID = canon.VehicleID
	row.Columns = canon.Columns
	row.ScheduleCron = canon.ScheduleCron
	row.Delivery = canon.Delivery
	row.RangeWindow = canon.RangeWindow
	row.Enabled = canon.Enabled
	row.UpdatedAt = now
	clone := *row
	return &clone, nil
}

func (s *fakeScheduledExportStore) Delete(_ context.Context, id int64, owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.errOn["delete"]; err != nil {
		return err
	}
	row, ok := s.rows[id]
	if !ok || row.OwnerSubject != owner {
		return exportdb.ErrScheduledExportNotFound
	}
	delete(s.rows, id)
	return nil
}

func (s *fakeScheduledExportStore) SetNextRunAt(_ context.Context, id int64, owner string, when time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.errOn["set_next_run_at"]; err != nil {
		return err
	}
	row, ok := s.rows[id]
	if !ok || row.OwnerSubject != owner {
		return exportdb.ErrScheduledExportNotFound
	}
	row.NextRunAt = &when
	return nil
}

const testForwardAuthHeader = "X-Forward-User"

func newScheduledExportsRouter(store ScheduledExportStore, now func() time.Time) http.Handler {
	h := NewScheduledExportsHandler(store, testForwardAuthHeader, now)
	r := chi.NewRouter()
	r.Get("/scheduled-exports", h.List)
	r.Post("/scheduled-exports", h.Create)
	r.Put("/scheduled-exports/{id}", h.Update)
	r.Delete("/scheduled-exports/{id}", h.Delete)
	r.Post("/scheduled-exports/{id}/run", h.RunNow)
	return r
}

func validCreateBody() map[string]any {
	return map[string]any{
		"name":          "Drives weekly",
		"export_type":   "drives",
		"format":        "csv",
		"schedule_cron": "0 9 * * 0",
		"delivery": map[string]string{
			"kind": "download",
		},
		"range_window": "7d",
	}
}

func bodyOf(t *testing.T, payload any) io.Reader {
	t.Helper()
	if payload == nil {
		return nil
	}
	buf := &bytes.Buffer{}
	if err := json.NewEncoder(buf).Encode(payload); err != nil {
		t.Fatalf("encode body: %v", err)
	}
	return buf
}

func newSchedReq(t *testing.T, method, path string, owner string, payload any) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, bodyOf(t, payload))
	if owner != "" {
		req.Header.Set(testForwardAuthHeader, owner)
	}
	return req
}

func decodeSchedJSON[T any](t *testing.T, body *bytes.Buffer) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v\nraw=%q", err, body.String())
	}
	return out
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

func TestScheduledExports_RequireAuthHeader(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)

	cases := []struct {
		name, method, path string
		body               any
	}{
		{"list", http.MethodGet, "/scheduled-exports", nil},
		{"create", http.MethodPost, "/scheduled-exports", validCreateBody()},
		{"update", http.MethodPut, "/scheduled-exports/1", validCreateBody()},
		{"delete", http.MethodDelete, "/scheduled-exports/1", nil},
		{"run", http.MethodPost, "/scheduled-exports/1/run", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, newSchedReq(t, tc.method, tc.path, "" /* no header */, tc.body))
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "MISSING_IDENTITY") {
				t.Fatalf("response missing MISSING_IDENTITY code: %s", rec.Body.String())
			}
		})
	}
}

// TestScheduledExports_OwnerSubjectFromBodyIsRejected pins the
// gate's AUTH_GUARD_CHECK in behavioural form: even if a client
// sneaks owner_subject into the JSON, DisallowUnknownFields rejects
// the request as a 400. The handler never reads it.
func TestScheduledExports_OwnerSubjectFromBodyIsRejected(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)

	body := validCreateBody()
	body["owner_subject"] = "evil-user"

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", body))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "owner_subject") {
		t.Fatalf("expected 400 to mention rejected field; got %s", rec.Body.String())
	}
	if len(store.rows) != 0 {
		t.Fatalf("store mutated despite 400: %+v", store.rows)
	}
}

func TestScheduledExports_CrossUserIsolation(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, func() time.Time { return time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC) })

	// Alice creates a schedule.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", validCreateBody()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("alice create: status %d body=%s", rec.Code, rec.Body.String())
	}
	created := decodeSchedJSON[exportdb.ScheduledExportRow](t, rec.Body)
	if created.OwnerSubject != "alice" {
		t.Fatalf("owner_subject = %q, want alice", created.OwnerSubject)
	}

	// Bob lists — sees nothing.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodGet, "/scheduled-exports", "bob", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("bob list: status %d", rec.Code)
	}
	bobList := decodeSchedJSON[[]exportdb.ScheduledExportRow](t, rec.Body)
	if len(bobList) != 0 {
		t.Fatalf("bob saw %d rows; want 0", len(bobList))
	}

	// Bob attempts to update Alice's row — collapses to 404.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPut, "/scheduled-exports/1", "bob", validCreateBody()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("bob update other user's row: status %d body=%s", rec.Code, rec.Body.String())
	}

	// Bob attempts to delete — also 404.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodDelete, "/scheduled-exports/1", "bob", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("bob delete other user's row: status %d", rec.Code)
	}

	// Bob's run-now attempt is also 404.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports/1/run", "bob", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("bob run-now other user's row: status %d", rec.Code)
	}

	// Alice still sees her row intact.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodGet, "/scheduled-exports", "alice", nil))
	aliceList := decodeSchedJSON[[]exportdb.ScheduledExportRow](t, rec.Body)
	if len(aliceList) != 1 || aliceList[0].ID != created.ID {
		t.Fatalf("alice view tampered: %+v", aliceList)
	}
}

func TestScheduledExports_ValidationErrorsReturn400(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)

	cases := []struct {
		name string
		body map[string]any
	}{
		{"empty name", func() map[string]any { b := validCreateBody(); b["name"] = "  "; return b }()},
		{"bad type", func() map[string]any { b := validCreateBody(); b["export_type"] = "spaceships"; return b }()},
		{"bad format", func() map[string]any { b := validCreateBody(); b["format"] = "xml"; return b }()},
		{"bad cron", func() map[string]any { b := validCreateBody(); b["schedule_cron"] = "not a cron"; return b }()},
		{"bad delivery kind", func() map[string]any {
			b := validCreateBody()
			b["delivery"] = map[string]string{"kind": "carrier-pigeon"}
			return b
		}()},
		{"missing email target", func() map[string]any {
			b := validCreateBody()
			b["delivery"] = map[string]string{"kind": "email", "target": ""}
			return b
		}()},
		{"bad range_window", func() map[string]any { b := validCreateBody(); b["range_window"] = "1y"; return b }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", tc.body))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestScheduledExports_UnknownFieldsRejected(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)
	body := validCreateBody()
	body["wat"] = "lol"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", body))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestScheduledExports_NotFoundReturns404(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPut, "/scheduled-exports/9999", "alice", validCreateBody()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestScheduledExports_UpdatePersists(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, func() time.Time { return time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC) })

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", validCreateBody()))
	created := decodeSchedJSON[exportdb.ScheduledExportRow](t, rec.Body)

	updated := validCreateBody()
	updated["name"] = "Drives nightly"
	updated["schedule_cron"] = "0 2 * * *"
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPut, "/scheduled-exports/1", "alice", updated))
	if rec.Code != http.StatusOK {
		t.Fatalf("update status %d; body=%s", rec.Code, rec.Body.String())
	}
	post := decodeSchedJSON[exportdb.ScheduledExportRow](t, rec.Body)
	if post.Name != "Drives nightly" || post.ScheduleCron != "0 2 * * *" {
		t.Fatalf("update not applied: %+v", post)
	}
	if post.ID != created.ID {
		t.Fatalf("ID changed across update: %d→%d", created.ID, post.ID)
	}
}

func TestScheduledExports_RunNowAdvancesNextRun(t *testing.T) {
	store := newFakeScheduledExportStore()
	now := time.Date(2025, 6, 15, 12, 0, 0, 0, time.UTC)
	r := newScheduledExportsRouter(store, func() time.Time { return now })

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", validCreateBody()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status %d; body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports/1/run", "alice", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("run-now status %d; body=%s", rec.Code, rec.Body.String())
	}
	row := decodeSchedJSON[exportdb.ScheduledExportRow](t, rec.Body)
	if row.NextRunAt == nil || !row.NextRunAt.Equal(now) {
		t.Fatalf("next_run_at = %v, want %v", row.NextRunAt, now)
	}
}

func TestScheduledExports_DeleteReturns204(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", validCreateBody()))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodDelete, "/scheduled-exports/1", "alice", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status %d", rec.Code)
	}
	if len(store.rows) != 0 {
		t.Fatalf("row remained after delete: %+v", store.rows)
	}
}

func TestScheduledExports_BodyTooLarge(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)
	huge := validCreateBody()
	huge["name"] = strings.Repeat("a", int(MaxScheduledExportBodyBytes)+1024)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodPost, "/scheduled-exports", "alice", huge))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestScheduledExports_InvalidIDReturns400(t *testing.T) {
	store := newFakeScheduledExportStore()
	r := newScheduledExportsRouter(store, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodDelete, "/scheduled-exports/zero", "alice", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestScheduledExports_StoreErrorReturns500(t *testing.T) {
	store := newFakeScheduledExportStore()
	store.errOn["list"] = errors.New("boom")
	r := newScheduledExportsRouter(store, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, newSchedReq(t, http.MethodGet, "/scheduled-exports", "alice", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d want 500; body=%s", rec.Code, rec.Body.String())
	}
}
