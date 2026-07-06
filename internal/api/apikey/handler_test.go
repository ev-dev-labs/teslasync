package apikey

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ---------------------------------------------------------------------------
// Test doubles — model the established database.DBTX / pgx.Rows / pgx.Row fake
// pattern used across the repo (see internal/database/drive/repo_backfill_test.go
// and internal/signal/state_reader_log_test.go). No live DB / network is used.
// ---------------------------------------------------------------------------

type capturedCall struct {
	sql  string
	args []any
}

func cloneArgs(args []any) []any {
	cp := make([]any, len(args))
	copy(cp, args)
	return cp
}

// fakeQuerier satisfies database.DBTX for handler unit tests. Each method
// records its calls so tests can pin the exact SQL and bound args.
type fakeQuerier struct {
	queryErr   error
	queryRows  pgx.Rows
	queryCalls []capturedCall

	queryRowResult pgx.Row
	queryRowCalls  []capturedCall

	execErr   error
	execTag   pgconn.CommandTag
	execCalls []capturedCall
}

func (f *fakeQuerier) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.queryCalls = append(f.queryCalls, capturedCall{sql: sql, args: cloneArgs(args)})
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	if f.queryRows != nil {
		return f.queryRows, nil
	}
	return newFakeRows(nil), nil
}

func (f *fakeQuerier) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.queryRowCalls = append(f.queryRowCalls, capturedCall{sql: sql, args: cloneArgs(args)})
	if f.queryRowResult != nil {
		return f.queryRowResult
	}
	return fakeRow{}
}

func (f *fakeQuerier) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execCalls = append(f.execCalls, capturedCall{sql: sql, args: cloneArgs(args)})
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	return f.execTag, nil
}

var _ database.DBTX = (*fakeQuerier)(nil)

// fakeRow satisfies pgx.Row for the Create INSERT ... RETURNING id path.
type fakeRow struct {
	id      int64
	scanErr error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if len(dest) > 0 {
		if p, ok := dest[0].(*int64); ok {
			*p = r.id
		}
	}
	return nil
}

var _ pgx.Row = fakeRow{}

// fakeRows satisfies pgx.Rows for the List SELECT path. data holds one []any
// per row in column order; scanErrAt forces Scan to fail for a single row so
// the "skip unscannable row" branch can be exercised deterministically.
type fakeRows struct {
	data      [][]any
	cursor    int
	closed    bool
	iterErr   error
	scanErrAt int
}

func newFakeRows(data [][]any) *fakeRows {
	return &fakeRows{data: data, cursor: -1, scanErrAt: -1}
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.iterErr }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }

func (r *fakeRows) Next() bool {
	r.cursor++
	return r.cursor < len(r.data)
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.cursor < 0 || r.cursor >= len(r.data) {
		return errors.New("fakeRows.Scan: cursor out of range")
	}
	if r.cursor == r.scanErrAt {
		return errors.New("fakeRows: forced scan error")
	}
	return scanInto(dest, r.data[r.cursor])
}

func (r *fakeRows) Values() ([]any, error) { return nil, nil }
func (r *fakeRows) RawValues() [][]byte    { return nil }
func (r *fakeRows) Conn() *pgx.Conn        { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// scanInto copies src column values into the pointer destinations the handler
// hands to rows.Scan, mimicking pgx's assignment semantics for the exact
// types used by List (int64, string, time.Time, *time.Time).
func scanInto(dest, src []any) error {
	if len(dest) != len(src) {
		return errors.New("scanInto: dest/src length mismatch")
	}
	for i := range dest {
		dv := reflect.ValueOf(dest[i])
		if dv.Kind() != reflect.Pointer || dv.IsNil() {
			return errors.New("scanInto: dest is not a non-nil pointer")
		}
		target := dv.Elem()
		if src[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		sv := reflect.ValueOf(src[i])
		if !sv.Type().AssignableTo(target.Type()) {
			return errors.New("scanInto: type not assignable")
		}
		target.Set(sv)
	}
	return nil
}

// failingReader is an io.Reader that always errors, used to drive the
// key-generation-failure branch in Create via the randReader seam.
type failingReader struct{ err error }

func (f failingReader) Read(_ []byte) (int, error) { return 0, f.err }

// ---------------------------------------------------------------------------
// Audit capture
// ---------------------------------------------------------------------------

type auditCall struct {
	headerName string
	action     string
	resource   string
	entityID   *int64
	detail     string
}

type auditRecorder struct{ calls []auditCall }

func (a *auditRecorder) fn() AuditFunc {
	return func(_ *http.Request, headerName, action, resource string, entityID *int64, detail string) {
		a.calls = append(a.calls, auditCall{
			headerName: headerName,
			action:     action,
			resource:   resource,
			entityID:   entityID,
			detail:     detail,
		})
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// requestWithURLParam builds a request whose chi route context carries the
// {id} URL param, matching how the endpoints are mounted in router.go. An
// empty id models a missing param.
func requestWithURLParam(method, id string) *http.Request {
	req := httptest.NewRequest(method, "/api-keys/"+id, nil)
	rctx := chi.NewRouteContext()
	if id != "" {
		rctx.URLParams.Add("id", id)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func decodeJSONMap(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode json object: %v; body=%s", err, string(body))
	}
	return m
}

func ptrTime(tm time.Time) *time.Time { return &tm }

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

func TestSha256Hex(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string // "" means only structural assertions
	}{
		{"empty vector", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
		{"abc vector", "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
		{"key-shaped input", "ts_deadbeefdeadbeef", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sha256Hex(tt.in)
			if len(got) != 64 {
				t.Fatalf("hex length = %d, want 64 (%q)", len(got), got)
			}
			if got != sha256Hex(tt.in) {
				t.Fatal("sha256Hex is not deterministic for identical input")
			}
			if tt.want != "" && got != tt.want {
				t.Fatalf("sha256Hex(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
	if sha256Hex("alpha") == sha256Hex("beta") {
		t.Fatal("distinct inputs must not collide")
	}
}

// ---------------------------------------------------------------------------
// NewHandler / newHandler / WithAuditFunc
// ---------------------------------------------------------------------------

func TestNewHandler_QuerierWiring(t *testing.T) {
	tests := []struct {
		name        string
		db          *database.DB
		wantNilDB   bool
		headerValue string
	}{
		{"nil db yields nil querier", nil, true, "X-Forwarded-User"},
		{"db with nil pool yields nil querier", &database.DB{}, true, "X-Auth"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(tt.db, tt.headerValue)
			if h == nil {
				t.Fatal("NewHandler returned nil")
			}
			if (h.db == nil) != tt.wantNilDB {
				t.Fatalf("h.db == nil is %v, want %v", h.db == nil, tt.wantNilDB)
			}
			if h.forwardAuthHeader != tt.headerValue {
				t.Fatalf("forwardAuthHeader = %q, want %q", h.forwardAuthHeader, tt.headerValue)
			}
			if h.audit != nil {
				t.Fatal("audit must be nil when WithAuditFunc is not supplied")
			}
		})
	}
}

func TestNewHandler_OptionsApplied(t *testing.T) {
	rec := &auditRecorder{}
	fq := &fakeQuerier{}

	// nil options must be tolerated alongside real ones.
	h := newHandler(fq, "X-Forwarded-User", nil, WithAuditFunc(rec.fn()))
	if h.audit == nil {
		t.Fatal("WithAuditFunc did not install the callback")
	}
	if h.db == nil {
		t.Fatal("querier not stored")
	}

	id := int64(3)
	h.logAudit(httptest.NewRequest(http.MethodGet, "/", nil), "create", &id, "detail")
	if len(rec.calls) != 1 {
		t.Fatalf("audit calls = %d, want 1", len(rec.calls))
	}
	if rec.calls[0].headerName != "X-Forwarded-User" {
		t.Fatalf("headerName = %q, want X-Forwarded-User", rec.calls[0].headerName)
	}
}

// ---------------------------------------------------------------------------
// logAudit
// ---------------------------------------------------------------------------

func TestLogAudit(t *testing.T) {
	t.Run("nil audit is a no-op and never panics", func(t *testing.T) {
		h := newHandler(&fakeQuerier{}, "X-Forwarded-User")
		h.logAudit(httptest.NewRequest(http.MethodGet, "/", nil), "create", nil, "detail")
	})

	t.Run("audit receives fixed resource and passthrough args", func(t *testing.T) {
		rec := &auditRecorder{}
		h := newHandler(&fakeQuerier{}, "X-Forwarded-User", WithAuditFunc(rec.fn()))
		id := int64(7)
		h.logAudit(httptest.NewRequest(http.MethodGet, "/", nil), "delete", &id, "deleted key id=7")

		if len(rec.calls) != 1 {
			t.Fatalf("audit calls = %d, want 1", len(rec.calls))
		}
		got := rec.calls[0]
		if got.resource != "api_key" {
			t.Fatalf("resource = %q, want api_key", got.resource)
		}
		if got.action != "delete" {
			t.Fatalf("action = %q, want delete", got.action)
		}
		if got.headerName != "X-Forwarded-User" {
			t.Fatalf("headerName = %q, want X-Forwarded-User", got.headerName)
		}
		if got.entityID == nil || *got.entityID != 7 {
			t.Fatalf("entityID = %v, want 7", got.entityID)
		}
		if got.detail != "deleted key id=7" {
			t.Fatalf("detail = %q", got.detail)
		}
	})
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestList_ReturnsRows(t *testing.T) {
	last := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	created1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	expires := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	created2 := time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC)

	rows := newFakeRows([][]any{
		{int64(1), "prod", "ts_abc1234...", "admin", ptrTime(last), created1, ptrTime(expires)},
		{int64(2), "ci", "ts_def5678...", "read", (*time.Time)(nil), created2, (*time.Time)(nil)},
	})
	fq := &fakeQuerier{queryRows: rows}
	h := newHandler(fq, "X-Forwarded-User")

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api-keys", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if len(fq.queryCalls) != 1 {
		t.Fatalf("Query calls = %d, want 1", len(fq.queryCalls))
	}
	if sql := fq.queryCalls[0].sql; !strings.Contains(sql, "FROM api_keys") || !strings.Contains(sql, "ORDER BY created_at DESC") {
		t.Fatalf("unexpected List SQL: %s", sql)
	}
	// key_hash must never be selected/echoed.
	if strings.Contains(fq.queryCalls[0].sql, "key_hash") {
		t.Fatalf("List SQL must not select key_hash: %s", fq.queryCalls[0].sql)
	}
	if !rows.closed {
		t.Fatal("rows.Close was not called (leak)")
	}

	var got []apiKeyRow
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 2 {
		t.Fatalf("row count = %d, want 2", len(got))
	}
	if got[0].ID != 1 || got[0].Name != "prod" || got[0].Permissions != "admin" || got[0].KeyPrefix != "ts_abc1234..." {
		t.Fatalf("row0 mismatch: %+v", got[0])
	}
	if got[0].LastUsedAt == nil || !got[0].LastUsedAt.Equal(last) {
		t.Fatalf("row0 last_used_at = %v, want %v", got[0].LastUsedAt, last)
	}
	if got[0].ExpiresAt == nil || !got[0].ExpiresAt.Equal(expires) {
		t.Fatalf("row0 expires_at = %v, want %v", got[0].ExpiresAt, expires)
	}
	if got[1].LastUsedAt != nil {
		t.Fatalf("row1 last_used_at = %v, want nil", got[1].LastUsedAt)
	}
	if got[1].ExpiresAt != nil {
		t.Fatalf("row1 expires_at = %v, want nil", got[1].ExpiresAt)
	}
}

func TestList_EmptyAndDegraded(t *testing.T) {
	tests := []struct {
		name    string
		handler func() *Handler
	}{
		{
			name: "zero rows returns empty array",
			handler: func() *Handler {
				return newHandler(&fakeQuerier{queryRows: newFakeRows(nil)}, "H")
			},
		},
		{
			name: "query error returns empty array",
			handler: func() *Handler {
				return newHandler(&fakeQuerier{queryErr: errors.New("relation api_keys does not exist")}, "H")
			},
		},
		{
			name: "nil database returns empty array",
			handler: func() *Handler {
				return newHandler(nil, "H")
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tt.handler().List(rec, httptest.NewRequest(http.MethodGet, "/api-keys", nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			// Must be an empty array, never null — the frontend maps over it.
			if body := strings.TrimSpace(rec.Body.String()); body != "[]" {
				t.Fatalf("body = %q, want []", body)
			}
		})
	}
}

func TestList_SkipsUnscannableRow(t *testing.T) {
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := newFakeRows([][]any{
		{int64(1), "bad", "ts_bad...", "read", (*time.Time)(nil), created, (*time.Time)(nil)},
		{int64(2), "good", "ts_good...", "read", (*time.Time)(nil), created, (*time.Time)(nil)},
	})
	rows.scanErrAt = 0 // first row fails Scan and must be skipped
	h := newHandler(&fakeQuerier{queryRows: rows}, "H")

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api-keys", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []apiKeyRow
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].ID != 2 {
		t.Fatalf("expected only the scannable row (id=2), got %+v", got)
	}
}

func TestList_RowsErrDoesNotDropCollected(t *testing.T) {
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := newFakeRows([][]any{
		{int64(5), "k", "ts_k...", "read", (*time.Time)(nil), created, (*time.Time)(nil)},
	})
	rows.iterErr = errors.New("connection reset mid-iteration")
	h := newHandler(&fakeQuerier{queryRows: rows}, "H")

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api-keys", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []apiKeyRow
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].ID != 5 {
		t.Fatalf("rows already read before Err must be preserved, got %+v", got)
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_ValidationRejections(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantStatus  int
		wantErrPart string
	}{
		{"malformed json", "{not-json", http.StatusBadRequest, "invalid request body"},
		{"empty name", `{"name":""}`, http.StatusBadRequest, "name is required"},
		{"whitespace name", `{"name":"   "}`, http.StatusBadRequest, "name is required"},
		{"name too long", `{"name":"` + strings.Repeat("a", maxKeyNameLen+1) + `"}`, http.StatusBadRequest, "at most 255"},
		{"invalid permissions", `{"name":"k","permissions":"root"}`, http.StatusBadRequest, "permissions must be"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fq := &fakeQuerier{queryRowResult: fakeRow{id: 1}}
			rec := &auditRecorder{}
			h := newHandler(fq, "H", WithAuditFunc(rec.fn()))

			rr := httptest.NewRecorder()
			h.Create(rr, httptest.NewRequest(http.MethodPost, "/api-keys", strings.NewReader(tt.body)))

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rr.Code, tt.wantStatus, rr.Body.String())
			}
			m := decodeJSONMap(t, rr.Body.Bytes())
			if msg, _ := m["error"].(string); !strings.Contains(msg, tt.wantErrPart) {
				t.Fatalf("error = %q, want to contain %q", msg, tt.wantErrPart)
			}
			if m["code"] != "BAD_REQUEST" {
				t.Fatalf("code = %v, want BAD_REQUEST", m["code"])
			}
			// A rejected request must never touch the DB nor emit an audit.
			if len(fq.queryRowCalls) != 0 {
				t.Fatalf("QueryRow called %d times on a validation failure", len(fq.queryRowCalls))
			}
			if len(rec.calls) != 0 {
				t.Fatalf("audit emitted on a validation failure")
			}
		})
	}
}

func TestCreate_Success(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantPerm string
	}{
		{"defaults to read", `{"name":"prod"}`, "read"},
		{"explicit admin", `{"name":"prod","permissions":"admin"}`, "admin"},
		{"read-write", `{"name":"prod","permissions":"read-write"}`, "read-write"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			const newID = int64(42)
			fq := &fakeQuerier{queryRowResult: fakeRow{id: newID}}
			rec := &auditRecorder{}
			h := newHandler(fq, "X-Forwarded-User", WithAuditFunc(rec.fn()))

			rr := httptest.NewRecorder()
			h.Create(rr, httptest.NewRequest(http.MethodPost, "/api-keys", strings.NewReader(tt.body)))

			if rr.Code != http.StatusCreated {
				t.Fatalf("status = %d, want 201; body=%s", rr.Code, rr.Body.String())
			}
			m := decodeJSONMap(t, rr.Body.Bytes())

			if idf, ok := m["id"].(float64); !ok || int64(idf) != newID {
				t.Fatalf("id = %v, want %d", m["id"], newID)
			}
			if m["name"] != "prod" {
				t.Fatalf("name = %v, want prod", m["name"])
			}
			if m["permissions"] != tt.wantPerm {
				t.Fatalf("permissions = %v, want %s", m["permissions"], tt.wantPerm)
			}

			rawKey, _ := m["key"].(string)
			if !strings.HasPrefix(rawKey, "ts_") {
				t.Fatalf("key = %q, want ts_ prefix", rawKey)
			}
			// ts_ (3) + 32 random bytes hex-encoded (64) = 67 chars.
			if len(rawKey) != 67 {
				t.Fatalf("key length = %d, want 67 (%q)", len(rawKey), rawKey)
			}
			wantPrefix := rawKey[:10] + "..."
			if m["key_prefix"] != wantPrefix {
				t.Fatalf("key_prefix = %v, want %q", m["key_prefix"], wantPrefix)
			}

			// Pin the INSERT contract: parameterised, hashed, prefixed.
			if len(fq.queryRowCalls) != 1 {
				t.Fatalf("QueryRow calls = %d, want 1", len(fq.queryRowCalls))
			}
			call := fq.queryRowCalls[0]
			if !strings.Contains(call.sql, "INSERT INTO api_keys") || !strings.Contains(call.sql, "RETURNING id") {
				t.Fatalf("unexpected INSERT SQL: %s", call.sql)
			}
			if len(call.args) != 4 {
				t.Fatalf("insert args = %d, want 4", len(call.args))
			}
			if call.args[0] != "prod" {
				t.Fatalf("arg0 (name) = %v, want prod", call.args[0])
			}
			if call.args[1] != sha256Hex(rawKey) {
				t.Fatalf("arg1 (key_hash) must be sha256Hex(rawKey); the raw key must never be stored")
			}
			if call.args[2] != wantPrefix {
				t.Fatalf("arg2 (key_prefix) = %v, want %q", call.args[2], wantPrefix)
			}
			if call.args[3] != tt.wantPerm {
				t.Fatalf("arg3 (permissions) = %v, want %s", call.args[3], tt.wantPerm)
			}

			// Audit fired exactly once with the created id.
			if len(rec.calls) != 1 {
				t.Fatalf("audit calls = %d, want 1", len(rec.calls))
			}
			a := rec.calls[0]
			if a.action != "create" || a.resource != "api_key" {
				t.Fatalf("audit action/resource = %s/%s", a.action, a.resource)
			}
			if a.entityID == nil || *a.entityID != newID {
				t.Fatalf("audit entityID = %v, want %d", a.entityID, newID)
			}
			if !strings.Contains(a.detail, "prod") {
				t.Fatalf("audit detail = %q, want to mention name", a.detail)
			}
		})
	}
}

func TestCreate_DBInsertError(t *testing.T) {
	fq := &fakeQuerier{queryRowResult: fakeRow{scanErr: errors.New("duplicate key value violates unique constraint")}}
	rec := &auditRecorder{}
	h := newHandler(fq, "H", WithAuditFunc(rec.fn()))

	rr := httptest.NewRecorder()
	h.Create(rr, httptest.NewRequest(http.MethodPost, "/api-keys", strings.NewReader(`{"name":"dup"}`)))

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rr.Code, rr.Body.String())
	}
	m := decodeJSONMap(t, rr.Body.Bytes())
	if msg, _ := m["error"].(string); !strings.Contains(msg, "failed to create API key") {
		t.Fatalf("error = %q", msg)
	}
	if len(rec.calls) != 0 {
		t.Fatal("audit must not fire when the insert fails")
	}
}

func TestCreate_KeyGenerationFailure(t *testing.T) {
	orig := randReader
	randReader = failingReader{err: errors.New("entropy pool drained")}
	defer func() { randReader = orig }()

	fq := &fakeQuerier{queryRowResult: fakeRow{id: 1}}
	h := newHandler(fq, "H")

	rr := httptest.NewRecorder()
	h.Create(rr, httptest.NewRequest(http.MethodPost, "/api-keys", strings.NewReader(`{"name":"k"}`)))

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rr.Code, rr.Body.String())
	}
	m := decodeJSONMap(t, rr.Body.Bytes())
	if msg, _ := m["error"].(string); !strings.Contains(msg, "failed to generate key") {
		t.Fatalf("error = %q, want failed to generate key", msg)
	}
	// Must bail before ever hitting the DB.
	if len(fq.queryRowCalls) != 0 {
		t.Fatalf("QueryRow called despite key generation failure")
	}
}

func TestCreate_NilDB(t *testing.T) {
	h := newHandler(nil, "H")
	rr := httptest.NewRecorder()
	h.Create(rr, httptest.NewRequest(http.MethodPost, "/api-keys", strings.NewReader(`{"name":"k"}`)))

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body=%s", rr.Code, rr.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fq := &fakeQuerier{}
		rec := &auditRecorder{}
		h := newHandler(fq, "X-Forwarded-User", WithAuditFunc(rec.fn()))

		rr := httptest.NewRecorder()
		h.Delete(rr, requestWithURLParam(http.MethodDelete, "5"))

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
		}
		m := decodeJSONMap(t, rr.Body.Bytes())
		if m["status"] != "deleted" {
			t.Fatalf("status field = %v, want deleted", m["status"])
		}
		if len(fq.execCalls) != 1 {
			t.Fatalf("Exec calls = %d, want 1", len(fq.execCalls))
		}
		call := fq.execCalls[0]
		if !strings.Contains(call.sql, "DELETE FROM api_keys WHERE id = $1") {
			t.Fatalf("unexpected DELETE SQL: %s", call.sql)
		}
		if len(call.args) != 1 || call.args[0] != int64(5) {
			t.Fatalf("exec args = %v, want [int64(5)]", call.args)
		}
		if len(rec.calls) != 1 || rec.calls[0].action != "delete" {
			t.Fatalf("audit = %+v, want single delete", rec.calls)
		}
		if rec.calls[0].entityID == nil || *rec.calls[0].entityID != 5 {
			t.Fatalf("audit entityID = %v, want 5", rec.calls[0].entityID)
		}
		if !strings.Contains(rec.calls[0].detail, "id=5") {
			t.Fatalf("audit detail = %q", rec.calls[0].detail)
		}
	})

	t.Run("invalid id", func(t *testing.T) {
		fq := &fakeQuerier{}
		rec := &auditRecorder{}
		h := newHandler(fq, "H", WithAuditFunc(rec.fn()))

		rr := httptest.NewRecorder()
		h.Delete(rr, requestWithURLParam(http.MethodDelete, "not-a-number"))

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rr.Code)
		}
		if len(fq.execCalls) != 0 || len(rec.calls) != 0 {
			t.Fatal("invalid id must not delete or audit")
		}
	})

	t.Run("missing id", func(t *testing.T) {
		h := newHandler(&fakeQuerier{}, "H")
		rr := httptest.NewRecorder()
		h.Delete(rr, requestWithURLParam(http.MethodDelete, ""))
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rr.Code)
		}
	})

	t.Run("exec error", func(t *testing.T) {
		fq := &fakeQuerier{execErr: errors.New("deadlock detected")}
		rec := &auditRecorder{}
		h := newHandler(fq, "H", WithAuditFunc(rec.fn()))

		rr := httptest.NewRecorder()
		h.Delete(rr, requestWithURLParam(http.MethodDelete, "5"))

		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rr.Code)
		}
		if len(rec.calls) != 0 {
			t.Fatal("audit must not fire when delete fails")
		}
	})

	t.Run("nil db", func(t *testing.T) {
		h := newHandler(nil, "H")
		rr := httptest.NewRecorder()
		h.Delete(rr, requestWithURLParam(http.MethodDelete, "5"))
		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", rr.Code)
		}
	})
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

func TestRevoke(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fq := &fakeQuerier{}
		rec := &auditRecorder{}
		h := newHandler(fq, "X-Forwarded-User", WithAuditFunc(rec.fn()))

		rr := httptest.NewRecorder()
		h.Revoke(rr, requestWithURLParam(http.MethodPost, "9"))

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
		}
		m := decodeJSONMap(t, rr.Body.Bytes())
		if m["status"] != "revoked" {
			t.Fatalf("status field = %v, want revoked", m["status"])
		}
		if len(fq.execCalls) != 1 {
			t.Fatalf("Exec calls = %d, want 1", len(fq.execCalls))
		}
		call := fq.execCalls[0]
		if !strings.Contains(call.sql, "UPDATE api_keys SET expires_at = NOW() WHERE id = $1") {
			t.Fatalf("unexpected UPDATE SQL: %s", call.sql)
		}
		if len(call.args) != 1 || call.args[0] != int64(9) {
			t.Fatalf("exec args = %v, want [int64(9)]", call.args)
		}
		if len(rec.calls) != 1 || rec.calls[0].action != "update" {
			t.Fatalf("audit = %+v, want single update", rec.calls)
		}
		if rec.calls[0].entityID == nil || *rec.calls[0].entityID != 9 {
			t.Fatalf("audit entityID = %v, want 9", rec.calls[0].entityID)
		}
		if !strings.Contains(rec.calls[0].detail, "id=9") {
			t.Fatalf("audit detail = %q", rec.calls[0].detail)
		}
	})

	t.Run("invalid id", func(t *testing.T) {
		fq := &fakeQuerier{}
		h := newHandler(fq, "H")
		rr := httptest.NewRecorder()
		h.Revoke(rr, requestWithURLParam(http.MethodPost, "abc"))
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rr.Code)
		}
		if len(fq.execCalls) != 0 {
			t.Fatal("invalid id must not revoke")
		}
	})

	t.Run("exec error", func(t *testing.T) {
		fq := &fakeQuerier{execErr: errors.New("statement timeout")}
		rec := &auditRecorder{}
		h := newHandler(fq, "H", WithAuditFunc(rec.fn()))

		rr := httptest.NewRecorder()
		h.Revoke(rr, requestWithURLParam(http.MethodPost, "9"))

		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rr.Code)
		}
		if len(rec.calls) != 0 {
			t.Fatal("audit must not fire when revoke fails")
		}
	})

	t.Run("nil db", func(t *testing.T) {
		h := newHandler(nil, "H")
		rr := httptest.NewRecorder()
		h.Revoke(rr, requestWithURLParam(http.MethodPost, "9"))
		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", rr.Code)
		}
	})
}

// Compile-time assurance the seam type stays an io.Reader.
var _ io.Reader = failingReader{}
