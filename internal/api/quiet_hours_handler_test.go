package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/config"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeQuietHoursStore is a goroutine-safe in-memory implementation of
// quietHoursStore. Mirrors the production validation rules so the
// handler tests fail the same way the real DB would.
type fakeQuietHoursStore struct {
	mu     sync.Mutex
	rows   map[int64]*models.QuietHoursWindow
	nextID int64
}

func newFakeQuietHoursStore() *fakeQuietHoursStore {
	return &fakeQuietHoursStore{rows: map[int64]*models.QuietHoursWindow{}, nextID: 1}
}

func (f *fakeQuietHoursStore) Insert(_ context.Context, userID string, in settingsdb.QuietHoursInput) (*models.QuietHoursWindow, error) {
	row := &models.QuietHoursWindow{
		UserID:           userID,
		Enabled:          true,
		Weekdays:         models.QuietHoursWeekdayAll,
		BypassSeverities: []string{"critical"},
	}
	if in.Enabled != nil {
		row.Enabled = *in.Enabled
	}
	if in.StartLocal != nil {
		row.StartLocal = *in.StartLocal
	}
	if in.EndLocal != nil {
		row.EndLocal = *in.EndLocal
	}
	if in.Timezone != nil {
		row.Timezone = *in.Timezone
	}
	if in.Weekdays != nil {
		row.Weekdays = *in.Weekdays
	}
	if in.BypassSeverities != nil {
		row.BypassSeverities = append([]string(nil), *in.BypassSeverities...)
	}
	if err := validateForTest(row); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	row.ID = f.nextID
	f.nextID++
	row.CreatedAt = time.Now().UTC()
	row.UpdatedAt = row.CreatedAt
	f.rows[row.ID] = row
	return cloneQuietHoursForTest(row), nil
}

func (f *fakeQuietHoursStore) Get(_ context.Context, userID string, id int64) (*models.QuietHoursWindow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[id]
	if !ok || row.UserID != userID {
		return nil, quiethoursdb.ErrQuietHoursNotFound
	}
	return cloneQuietHoursForTest(row), nil
}

func (f *fakeQuietHoursStore) ListByUser(_ context.Context, userID string) ([]*models.QuietHoursWindow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*models.QuietHoursWindow, 0)
	for _, r := range f.rows {
		if r.UserID == userID {
			out = append(out, cloneQuietHoursForTest(r))
		}
	}
	return out, nil
}

func (f *fakeQuietHoursStore) Update(_ context.Context, userID string, id int64, in settingsdb.QuietHoursInput) (*models.QuietHoursWindow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[id]
	if !ok || row.UserID != userID {
		return nil, quiethoursdb.ErrQuietHoursNotFound
	}
	upd := *row
	if in.Enabled != nil {
		upd.Enabled = *in.Enabled
	}
	if in.StartLocal != nil {
		upd.StartLocal = *in.StartLocal
	}
	if in.EndLocal != nil {
		upd.EndLocal = *in.EndLocal
	}
	if in.Timezone != nil {
		upd.Timezone = *in.Timezone
	}
	if in.Weekdays != nil {
		upd.Weekdays = *in.Weekdays
	}
	if in.BypassSeverities != nil {
		upd.BypassSeverities = append([]string(nil), *in.BypassSeverities...)
	}
	if err := validateForTest(&upd); err != nil {
		return nil, err
	}
	upd.UpdatedAt = time.Now().UTC()
	f.rows[id] = &upd
	return cloneQuietHoursForTest(&upd), nil
}

func (f *fakeQuietHoursStore) Delete(_ context.Context, userID string, id int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[id]
	if !ok || row.UserID != userID {
		return quiethoursdb.ErrQuietHoursNotFound
	}
	delete(f.rows, id)
	return nil
}

// validateForTest mirrors the database layer's validation so the handler
// tests exercise the same 400 mapping production does.
func validateForTest(w *models.QuietHoursWindow) error {
	if !validHHMMTest(w.StartLocal) || !validHHMMTest(w.EndLocal) {
		return quiethoursdb.ErrQuietHoursInvalidTime
	}
	if w.StartLocal == w.EndLocal {
		return quiethoursdb.ErrQuietHoursEqualTime
	}
	if strings.TrimSpace(w.Timezone) == "" {
		return quiethoursdb.ErrQuietHoursInvalidTimezone
	}
	if _, err := time.LoadLocation(w.Timezone); err != nil {
		return quiethoursdb.ErrQuietHoursInvalidTimezone
	}
	if w.Weekdays < 0 || w.Weekdays > 127 {
		return quiethoursdb.ErrQuietHoursInvalidWeekdays
	}
	allowed := map[string]struct{}{"info": {}, "warn": {}, "critical": {}}
	for i, sev := range w.BypassSeverities {
		w.BypassSeverities[i] = strings.ToLower(strings.TrimSpace(sev))
		if _, ok := allowed[w.BypassSeverities[i]]; !ok {
			return quiethoursdb.ErrQuietHoursInvalidSeverity
		}
	}
	return nil
}

func validHHMMTest(s string) bool {
	if len(s) != 5 || s[2] != ':' {
		return false
	}
	for _, i := range []int{0, 1, 3, 4} {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	h := int(s[0]-'0')*10 + int(s[1]-'0')
	m := int(s[3]-'0')*10 + int(s[4]-'0')
	return h <= 23 && m <= 59
}

func cloneQuietHoursForTest(in *models.QuietHoursWindow) *models.QuietHoursWindow {
	out := *in
	if in.BypassSeverities != nil {
		out.BypassSeverities = append([]string(nil), in.BypassSeverities...)
	}
	return &out
}

func quietHoursTestRouter(h *QuietHoursHandler) http.Handler {
	r := chi.NewRouter()
	r.Get("/quiet-hours", h.List)
	r.Post("/quiet-hours", h.Create)
	r.Patch("/quiet-hours/{id}", h.Patch)
	r.Delete("/quiet-hours/{id}", h.Delete)
	return r
}

func quietHoursTestCfg() *config.Config {
	return &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-User"}}
}

func TestQuietHoursHandler_CreateAndList(t *testing.T) {
	store := newFakeQuietHoursStore()
	h := NewQuietHoursHandler(store, quietHoursTestCfg())
	srv := httptest.NewServer(quietHoursTestRouter(h))
	defer srv.Close()

	body := `{"start_local":"23:00","end_local":"07:00","timezone":"America/New_York"}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/quiet-hours", strings.NewReader(body))
	req.Header.Set("X-User", "alice@example.com")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: got %d", resp.StatusCode)
	}
	var created models.QuietHoursWindow
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.UserID != "alice@example.com" || created.StartLocal != "23:00" {
		t.Fatalf("unexpected created row: %+v", created)
	}
	if !created.Enabled {
		t.Fatal("expected enabled=true default")
	}
	if created.Weekdays != models.QuietHoursWeekdayAll {
		t.Fatalf("expected weekdays=127 default, got %d", created.Weekdays)
	}
	if len(created.BypassSeverities) != 1 || created.BypassSeverities[0] != "critical" {
		t.Fatalf("expected bypass=[critical] default, got %v", created.BypassSeverities)
	}

	// List as the same user.
	req2, _ := http.NewRequest(http.MethodGet, srv.URL+"/quiet-hours", nil)
	req2.Header.Set("X-User", "alice@example.com")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("list: got %d", resp2.StatusCode)
	}
	var listResp struct {
		Windows []models.QuietHoursWindow `json:"windows"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&listResp); err != nil {
		t.Fatal(err)
	}
	if len(listResp.Windows) != 1 {
		t.Fatalf("expected 1 window, got %d", len(listResp.Windows))
	}

	// Different user — empty list (no leakage).
	req3, _ := http.NewRequest(http.MethodGet, srv.URL+"/quiet-hours", nil)
	req3.Header.Set("X-User", "bob@example.com")
	resp3, err := http.DefaultClient.Do(req3)
	if err != nil {
		t.Fatal(err)
	}
	defer resp3.Body.Close()
	var listResp2 struct {
		Windows []models.QuietHoursWindow `json:"windows"`
	}
	if err := json.NewDecoder(resp3.Body).Decode(&listResp2); err != nil {
		t.Fatal(err)
	}
	if len(listResp2.Windows) != 0 {
		t.Fatalf("user isolation broken — got %d windows", len(listResp2.Windows))
	}
}

func TestQuietHoursHandler_CreateValidationErrors(t *testing.T) {
	store := newFakeQuietHoursStore()
	h := NewQuietHoursHandler(store, quietHoursTestCfg())
	srv := httptest.NewServer(quietHoursTestRouter(h))
	defer srv.Close()

	cases := []struct {
		name string
		body string
		want int
	}{
		{"bad-time", `{"start_local":"25:00","end_local":"07:00","timezone":"UTC"}`, http.StatusBadRequest},
		{"equal-times", `{"start_local":"08:00","end_local":"08:00","timezone":"UTC"}`, http.StatusBadRequest},
		{"missing-tz", `{"start_local":"22:00","end_local":"07:00"}`, http.StatusBadRequest},
		{"bad-tz", `{"start_local":"22:00","end_local":"07:00","timezone":"Mars/Olympus"}`, http.StatusBadRequest},
		{"bad-weekdays", `{"start_local":"22:00","end_local":"07:00","timezone":"UTC","weekdays":200}`, http.StatusBadRequest},
		{"bad-severity", `{"start_local":"22:00","end_local":"07:00","timezone":"UTC","bypass_severities":["urgent"]}`, http.StatusBadRequest},
		{"unknown-field", `{"start_local":"22:00","end_local":"07:00","timezone":"UTC","banana":true}`, http.StatusBadRequest},
		{"not-json", `not json`, http.StatusBadRequest},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodPost, srv.URL+"/quiet-hours", strings.NewReader(tc.body))
			req.Header.Set("X-User", "alice@example.com")
			req.Header.Set("Content-Type", "application/json")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tc.want {
				t.Fatalf("got %d, want %d", resp.StatusCode, tc.want)
			}
		})
	}
}

func TestQuietHoursHandler_PatchAndDelete(t *testing.T) {
	store := newFakeQuietHoursStore()
	h := NewQuietHoursHandler(store, quietHoursTestCfg())
	srv := httptest.NewServer(quietHoursTestRouter(h))
	defer srv.Close()

	created, err := store.Insert(context.Background(), "alice", settingsdb.QuietHoursInput{
		StartLocal: qhPtrStr("23:00"), EndLocal: qhPtrStr("07:00"), Timezone: qhPtrStr("UTC"),
	})
	if err != nil {
		t.Fatal(err)
	}

	// PATCH disabled=true.
	patchBody := `{"enabled":false}`
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/quiet-hours/"+strconv.FormatInt(created.ID, 10), bytes.NewReader([]byte(patchBody)))
	req.Header.Set("X-User", "alice")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch: got %d", resp.StatusCode)
	}
	var got models.QuietHoursWindow
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Enabled {
		t.Fatal("expected enabled=false after patch")
	}

	// PATCH on different user → 404.
	req2, _ := http.NewRequest(http.MethodPatch, srv.URL+"/quiet-hours/"+strconv.FormatInt(created.ID, 10), bytes.NewReader([]byte(patchBody)))
	req2.Header.Set("X-User", "bob")
	req2.Header.Set("Content-Type", "application/json")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for foreign user patch, got %d", resp2.StatusCode)
	}

	// DELETE → 204.
	req3, _ := http.NewRequest(http.MethodDelete, srv.URL+"/quiet-hours/"+strconv.FormatInt(created.ID, 10), nil)
	req3.Header.Set("X-User", "alice")
	resp3, err := http.DefaultClient.Do(req3)
	if err != nil {
		t.Fatal(err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: got %d", resp3.StatusCode)
	}

	// Second delete → 404.
	req4, _ := http.NewRequest(http.MethodDelete, srv.URL+"/quiet-hours/"+strconv.FormatInt(created.ID, 10), nil)
	req4.Header.Set("X-User", "alice")
	resp4, err := http.DefaultClient.Do(req4)
	if err != nil {
		t.Fatal(err)
	}
	defer resp4.Body.Close()
	if resp4.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp4.StatusCode)
	}
}

func TestQuietHoursHandler_NoStore(t *testing.T) {
	h := NewQuietHoursHandler(nil, quietHoursTestCfg())
	srv := httptest.NewServer(quietHoursTestRouter(h))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/quiet-hours", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestQuietHoursHandler_BadID(t *testing.T) {
	store := newFakeQuietHoursStore()
	h := NewQuietHoursHandler(store, quietHoursTestCfg())
	srv := httptest.NewServer(quietHoursTestRouter(h))
	defer srv.Close()

	for _, path := range []string{"/quiet-hours/abc", "/quiet-hours/0", "/quiet-hours/-1"} {
		req, _ := http.NewRequest(http.MethodDelete, srv.URL+path, nil)
		req.Header.Set("X-User", "alice")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("path=%s got %d", path, resp.StatusCode)
		}
	}
}

func qhPtrStr(s string) *string { return &s }
