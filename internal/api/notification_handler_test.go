package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeInboxStore is an in-memory stub of notificationInboxStore so handler
// tests can exercise filter parsing and bulk endpoints without a live DB.
type fakeInboxStore struct {
	lastFilters database.NotificationLogFilters
	rows        []*models.NotificationLog
	listErr     error

	unreadCount    int64
	unreadCountErr error

	bulkReadCalls []struct {
		ids  []int64
		read bool
	}
	bulkReadResult int64
	bulkReadErr    error

	bulkReadAllCalls  int
	bulkReadAllResult int64
	bulkReadAllErr    error

	bulkArchivedCalls []struct {
		ids      []int64
		archived bool
	}
	bulkArchivedResult int64
	bulkArchivedErr    error

	bulkDeleteCalls [][]int64
	bulkDeleteResult int64
	bulkDeleteErr    error
}

func (f *fakeInboxStore) GetLogsFiltered(_ context.Context, filters database.NotificationLogFilters) ([]*models.NotificationLog, error) {
	f.lastFilters = filters
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.rows, nil
}

func (f *fakeInboxStore) GetUnreadCount(_ context.Context) (int64, error) {
	if f.unreadCountErr != nil {
		return 0, f.unreadCountErr
	}
	return f.unreadCount, nil
}

func (f *fakeInboxStore) BulkSetRead(_ context.Context, ids []int64, read bool) (int64, error) {
	f.bulkReadCalls = append(f.bulkReadCalls, struct {
		ids  []int64
		read bool
	}{append([]int64(nil), ids...), read})
	if f.bulkReadErr != nil {
		return 0, f.bulkReadErr
	}
	return f.bulkReadResult, nil
}

func (f *fakeInboxStore) BulkSetReadAll(_ context.Context) (int64, error) {
	f.bulkReadAllCalls++
	if f.bulkReadAllErr != nil {
		return 0, f.bulkReadAllErr
	}
	return f.bulkReadAllResult, nil
}

func (f *fakeInboxStore) BulkSetArchived(_ context.Context, ids []int64, archived bool) (int64, error) {
	f.bulkArchivedCalls = append(f.bulkArchivedCalls, struct {
		ids      []int64
		archived bool
	}{append([]int64(nil), ids...), archived})
	if f.bulkArchivedErr != nil {
		return 0, f.bulkArchivedErr
	}
	return f.bulkArchivedResult, nil
}

func (f *fakeInboxStore) BulkDelete(_ context.Context, ids []int64) (int64, error) {
	f.bulkDeleteCalls = append(f.bulkDeleteCalls, append([]int64(nil), ids...))
	if f.bulkDeleteErr != nil {
		return 0, f.bulkDeleteErr
	}
	return f.bulkDeleteResult, nil
}

func newTestHandler(store *fakeInboxStore) *NotificationHandler {
	return &NotificationHandler{inbox: store}
}

func TestParseNotificationLogFilters(t *testing.T) {
	tests := []struct {
		name      string
		query     string
		wantErr   bool
		assertion func(t *testing.T, f database.NotificationLogFilters)
	}{
		{
			name:  "empty defaults archived to false",
			query: "",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.Archived == nil || *f.Archived != false {
					t.Fatalf("expected archived=false default, got %v", f.Archived)
				}
				if len(f.Severities) != 0 {
					t.Fatalf("expected empty severities, got %v", f.Severities)
				}
			},
		},
		{
			name:  "csv severity",
			query: "severity=info,warn,critical",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				want := []string{"info", "warn", "critical"}
				if fmt.Sprint(f.Severities) != fmt.Sprint(want) {
					t.Fatalf("severities = %v, want %v", f.Severities, want)
				}
			},
		},
		{
			name:  "repeated severity params",
			query: "severity=info&severity=warn",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if len(f.Severities) != 2 {
					t.Fatalf("expected 2 severities, got %d", len(f.Severities))
				}
			},
		},
		{
			name:    "invalid severity",
			query:   "severity=bogus",
			wantErr: true,
		},
		{
			name:  "csv vehicle ids",
			query: "vehicle_id=1,2,3",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				want := []int64{1, 2, 3}
				if fmt.Sprint(f.VehicleIDs) != fmt.Sprint(want) {
					t.Fatalf("vehicle_ids = %v, want %v", f.VehicleIDs, want)
				}
			},
		},
		{
			name:    "invalid vehicle id",
			query:   "vehicle_id=abc",
			wantErr: true,
		},
		{
			name:  "rule ids",
			query: "rule_id=10&rule_id=20",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if len(f.RuleIDs) != 2 || f.RuleIDs[0] != 10 || f.RuleIDs[1] != 20 {
					t.Fatalf("rule_ids = %v", f.RuleIDs)
				}
			},
		},
		{
			name:  "from to RFC3339",
			query: "from=2024-01-01T00:00:00Z&to=2024-12-31T23:59:59Z",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.From.IsZero() || f.To.IsZero() {
					t.Fatal("expected from/to set")
				}
			},
		},
		{
			name:  "from date-only",
			query: "from=2024-01-01",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.From.Year() != 2024 {
					t.Fatalf("from year = %d", f.From.Year())
				}
			},
		},
		{
			name:    "invalid from",
			query:   "from=not-a-date",
			wantErr: true,
		},
		{
			name:  "read true",
			query: "read=true",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.Read == nil || *f.Read != true {
					t.Fatalf("read = %v", f.Read)
				}
			},
		},
		{
			name:  "read false",
			query: "read=false",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.Read == nil || *f.Read != false {
					t.Fatalf("read = %v", f.Read)
				}
			},
		},
		{
			name:    "invalid read",
			query:   "read=maybe",
			wantErr: true,
		},
		{
			name:  "archived true overrides default",
			query: "archived=true",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.Archived == nil || *f.Archived != true {
					t.Fatalf("archived = %v", f.Archived)
				}
			},
		},
		{
			name:  "archived false explicit",
			query: "archived=false",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.Archived == nil || *f.Archived != false {
					t.Fatalf("archived = %v", f.Archived)
				}
			},
		},
		{
			name:  "free text query",
			query: "q=%20%20battery%20low%20%20",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.Query != "battery low" {
					t.Fatalf("query = %q", f.Query)
				}
			},
		},
		{
			name:  "limit and offset clamped via pagination()",
			query: "limit=10&offset=5",
			assertion: func(t *testing.T, f database.NotificationLogFilters) {
				if f.Limit != 10 || f.Offset != 5 {
					t.Fatalf("limit/offset = %d/%d", f.Limit, f.Offset)
				}
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/notifications?"+tc.query, nil)
			f, err := parseNotificationLogFilters(req)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.assertion != nil {
				tc.assertion(t, f)
			}
		})
	}
}

func TestGetLogsHandler(t *testing.T) {
	rows := []*models.NotificationLog{{ID: 1, ChannelID: 1, Title: "x"}}
	store := &fakeInboxStore{rows: rows}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodGet, "/notifications?severity=critical&archived=true&q=foo", nil)
	rr := httptest.NewRecorder()
	h.GetLogs(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	if len(store.lastFilters.Severities) != 1 || store.lastFilters.Severities[0] != "critical" {
		t.Fatalf("severities = %v", store.lastFilters.Severities)
	}
	if store.lastFilters.Archived == nil || *store.lastFilters.Archived != true {
		t.Fatalf("archived = %v", store.lastFilters.Archived)
	}
	if store.lastFilters.Query != "foo" {
		t.Fatalf("query = %q", store.lastFilters.Query)
	}
	var out []*models.NotificationLog
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out) != 1 || out[0].ID != 1 {
		t.Fatalf("body = %+v", out)
	}
}

func TestGetLogsHandlerFilterValidation(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{})
	req := httptest.NewRequest(http.MethodGet, "/notifications?severity=garbage", nil)
	rr := httptest.NewRecorder()
	h.GetLogs(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestGetLogsHandlerEmptyResultStillJSONArray(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{rows: nil})
	req := httptest.NewRequest(http.MethodGet, "/notifications", nil)
	rr := httptest.NewRecorder()
	h.GetLogs(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	if strings.TrimSpace(rr.Body.String()) != "[]" {
		t.Fatalf("expected [], got %q", rr.Body.String())
	}
}

func TestGetLogsHandlerStoreError(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{listErr: errors.New("boom")})
	req := httptest.NewRequest(http.MethodGet, "/notifications", nil)
	rr := httptest.NewRecorder()
	h.GetLogs(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}

func bulkBody(t *testing.T, ids []int64) *bytes.Reader {
	t.Helper()
	b, err := json.Marshal(map[string]any{"ids": ids})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return bytes.NewReader(b)
}

func TestBulkMarkRead(t *testing.T) {
	store := &fakeInboxStore{bulkReadResult: 3}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", bulkBody(t, []int64{1, 2, 3}))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if len(store.bulkReadCalls) != 1 || !store.bulkReadCalls[0].read {
		t.Fatalf("expected one BulkSetRead(read=true), got %+v", store.bulkReadCalls)
	}
	var out map[string]int64
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out["updated"] != 3 {
		t.Fatalf("updated = %d", out["updated"])
	}
}

func TestBulkMarkUnread(t *testing.T) {
	store := &fakeInboxStore{bulkReadResult: 2}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-unread", bulkBody(t, []int64{4, 5}))
	rr := httptest.NewRecorder()
	h.MarkUnread(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	if len(store.bulkReadCalls) != 1 || store.bulkReadCalls[0].read {
		t.Fatalf("expected BulkSetRead(read=false), got %+v", store.bulkReadCalls)
	}
}

func TestBulkArchive(t *testing.T) {
	store := &fakeInboxStore{bulkArchivedResult: 1}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/archive", bulkBody(t, []int64{42}))
	rr := httptest.NewRecorder()
	h.Archive(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	if len(store.bulkArchivedCalls) != 1 || !store.bulkArchivedCalls[0].archived {
		t.Fatalf("expected archived=true call, got %+v", store.bulkArchivedCalls)
	}
}

func TestBulkUnarchive(t *testing.T) {
	store := &fakeInboxStore{bulkArchivedResult: 1}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/unarchive", bulkBody(t, []int64{42}))
	rr := httptest.NewRecorder()
	h.Unarchive(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	if len(store.bulkArchivedCalls) != 1 || store.bulkArchivedCalls[0].archived {
		t.Fatalf("expected archived=false call, got %+v", store.bulkArchivedCalls)
	}
}

func TestBulkDelete(t *testing.T) {
	store := &fakeInboxStore{bulkDeleteResult: 5}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodDelete, "/notifications/logs", bulkBody(t, []int64{1, 2, 3, 4, 5}))
	rr := httptest.NewRecorder()
	h.DeleteBulk(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	if len(store.bulkDeleteCalls) != 1 || len(store.bulkDeleteCalls[0]) != 5 {
		t.Fatalf("expected one BulkDelete with 5 ids, got %+v", store.bulkDeleteCalls)
	}
}

func TestBulkEndpointsRejectEmptyIDs(t *testing.T) {
	for _, tc := range []struct {
		name string
		fn   func(*NotificationHandler, http.ResponseWriter, *http.Request)
	}{
		{"mark-read", func(h *NotificationHandler, w http.ResponseWriter, r *http.Request) { h.MarkRead(w, r) }},
		{"mark-unread", func(h *NotificationHandler, w http.ResponseWriter, r *http.Request) { h.MarkUnread(w, r) }},
		{"archive", func(h *NotificationHandler, w http.ResponseWriter, r *http.Request) { h.Archive(w, r) }},
		{"unarchive", func(h *NotificationHandler, w http.ResponseWriter, r *http.Request) { h.Unarchive(w, r) }},
		{"delete", func(h *NotificationHandler, w http.ResponseWriter, r *http.Request) { h.DeleteBulk(w, r) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newTestHandler(&fakeInboxStore{})
			req := httptest.NewRequest(http.MethodPost, "/x", bulkBody(t, []int64{}))
			rr := httptest.NewRecorder()
			tc.fn(h, rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d", rr.Code)
			}
		})
	}
}

func TestBulkEndpointsRejectMalformedJSON(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{})
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", bytes.NewReader([]byte("not json")))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestBulkEndpointsRejectOversizedBatch(t *testing.T) {
	ids := make([]int64, 1001)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	h := newTestHandler(&fakeInboxStore{})
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", bulkBody(t, ids))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestBulkPropagatesStoreError(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{bulkReadErr: errors.New("db down")})
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", bulkBody(t, []int64{1}))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}

func TestUnreadCount(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{unreadCount: 7})
	req := httptest.NewRequest(http.MethodGet, "/notifications/unread-count", nil)
	rr := httptest.NewRecorder()
	h.UnreadCount(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	var out map[string]int64
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out["count"] != 7 {
		t.Fatalf("count = %d", out["count"])
	}
}

func TestUnreadCountStoreError(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{unreadCountErr: errors.New("boom")})
	req := httptest.NewRequest(http.MethodGet, "/notifications/unread-count", nil)
	rr := httptest.NewRecorder()
	h.UnreadCount(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}

// --- Phase-45 / 28 — bulk mark-all-read ---

// markBody is a small helper that marshals the relaxed mark-read body shape
// (`{ids?, all?}`) used by the all-flag tests below.
func markBody(t *testing.T, payload map[string]any) *bytes.Reader {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return bytes.NewReader(b)
}

// TestNotificationsBulkMarkAll exercises the all=true branch of MarkRead.
// It must not call BulkSetRead (which would require an id list); instead
// the handler delegates to BulkSetReadAll, which the repo implements with
// a `WHERE read_at IS NULL AND archived_at IS NULL` predicate so already-
// read and archived rows are skipped.
func TestNotificationsBulkMarkAll(t *testing.T) {
	store := &fakeInboxStore{bulkReadAllResult: 42}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", markBody(t, map[string]any{"all": true}))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if store.bulkReadAllCalls != 1 {
		t.Fatalf("expected one BulkSetReadAll call, got %d", store.bulkReadAllCalls)
	}
	if len(store.bulkReadCalls) != 0 {
		t.Fatalf("expected zero BulkSetRead calls when all=true, got %+v", store.bulkReadCalls)
	}
	var out map[string]int64
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out["updated"] != 42 {
		t.Fatalf("updated = %d, want 42", out["updated"])
	}
}

// TestNotificationsBulkMarkAllRejectsBothIDsAndAll guards against ambiguous
// requests — the relaxed decoder must refuse `{ids:[…], all:true}` so
// neither the per-id nor whole-inbox path silently wins.
func TestNotificationsBulkMarkAllRejectsBothIDsAndAll(t *testing.T) {
	store := &fakeInboxStore{}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", markBody(t, map[string]any{
		"ids": []int64{1, 2},
		"all": true,
	}))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rr.Code, rr.Body.String())
	}
	if store.bulkReadAllCalls != 0 || len(store.bulkReadCalls) != 0 {
		t.Fatalf("expected no repo calls on bad request, got readAll=%d read=%+v",
			store.bulkReadAllCalls, store.bulkReadCalls)
	}
}

// TestNotificationsBulkMarkAllPropagatesStoreError surfaces a 500 when the
// repo errors so the frontend can roll back the optimistic update.
func TestNotificationsBulkMarkAllPropagatesStoreError(t *testing.T) {
	store := &fakeInboxStore{bulkReadAllErr: errors.New("db down")}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", markBody(t, map[string]any{"all": true}))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}

// TestNotificationsBulkMarkAllRequiresEitherIDsOrAll documents the
// always-on contract: an empty body (no ids, no all) is a 400, never a
// no-op success.
func TestNotificationsBulkMarkAllRequiresEitherIDsOrAll(t *testing.T) {
	h := newTestHandler(&fakeInboxStore{})
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", markBody(t, map[string]any{}))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

// TestNotificationsBulkMarkAllStillSupportsIDsPath ensures the ids-array
// path through the relaxed decoder still wires through to BulkSetRead.
// Acts as a safety net in case a future refactor accidentally changes the
// dispatch logic.
func TestNotificationsBulkMarkAllStillSupportsIDsPath(t *testing.T) {
	store := &fakeInboxStore{bulkReadResult: 2}
	h := newTestHandler(store)
	req := httptest.NewRequest(http.MethodPost, "/notifications/mark-read", markBody(t, map[string]any{"ids": []int64{7, 9}}))
	rr := httptest.NewRecorder()
	h.MarkRead(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if store.bulkReadAllCalls != 0 {
		t.Fatalf("expected zero BulkSetReadAll calls when ids present, got %d", store.bulkReadAllCalls)
	}
	if len(store.bulkReadCalls) != 1 || !store.bulkReadCalls[0].read {
		t.Fatalf("expected one BulkSetRead(read=true) call, got %+v", store.bulkReadCalls)
	}
}
