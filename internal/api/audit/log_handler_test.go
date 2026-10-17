package audit

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// TestUserActivity_RequiresForwardAuthHeader documents the privacy guarantee:
// the per-user activity endpoint refuses to serve
// when the deployment isn't running behind a ForwardAuth identity provider,
// rather than silently collapsing every "anonymous" caller into one shared
// feed.
func TestUserActivity_RequiresForwardAuthHeader(t *testing.T) {
	h := &AuditHandler{db: nil, forwardAuthHeader: ""}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/activity", nil)

	h.UserActivity(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when ForwardAuthHeader unset, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unexpected non-JSON body: %v (body=%s)", err, rec.Body.String())
	}
	if body["error"] == "" {
		t.Fatalf("expected an error message, got %q", rec.Body.String())
	}
}

// TestUserActivity_RequiresIdentityHeaderValue covers the case where the
// header is configured (so the deployment claims to have auth) but the
// request itself didn't carry the value — almost certainly a misconfigured
// upstream. Returning 401 instead of an empty list keeps the user from
// thinking "I have no activity" when in reality their identity is missing.
func TestUserActivity_RequiresIdentityHeaderValue(t *testing.T) {
	h := &AuditHandler{db: nil, forwardAuthHeader: "X-Forwarded-User"}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/activity", nil)
	// Note: no X-Forwarded-User header set.

	h.UserActivity(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when identity header empty, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

type activityQueryFunc func(context.Context, string, ...any) (pgx.Rows, error)

func (f activityQueryFunc) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return f(ctx, sql, args...)
}

type activityRows struct {
	pgx.Rows
	entries []userActivityEntry
	index   int
	scanAt  int
	scanErr error
	rowErr  error
	closed  bool
}

func (r *activityRows) Close()     { r.closed = true }
func (r *activityRows) Err() error { return r.rowErr }
func (r *activityRows) Next() bool {
	if r.index >= len(r.entries) {
		return false
	}
	r.index++
	return true
}
func (r *activityRows) Scan(dest ...any) error {
	if r.scanErr != nil && r.index == r.scanAt {
		return r.scanErr
	}
	e := r.entries[r.index-1]
	*dest[0].(*int64) = e.ID
	*dest[1].(*time.Time) = e.Ts
	*dest[2].(*string) = e.Action
	*dest[3].(*string) = e.EntityType
	*dest[4].(**int64) = e.EntityID
	*dest[5].(**string) = e.Detail
	return nil
}

func TestUserActivity_QueryResults(t *testing.T) {
	entityID, detail := int64(17), "synthetic activity detail"
	entries := []userActivityEntry{
		{ID: 2, Ts: time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC), Action: "update", EntityType: "settings", EntityID: &entityID, Detail: &detail},
		{ID: 1, Ts: time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC), Action: "reveal", EntityType: "generic"},
	}
	failure := errors.New("private database failure")
	tests := []struct {
		name     string
		entries  []userActivityEntry
		queryErr error
		scanAt   int
		scanErr  error
		rowErr   error
		status   int
	}{
		{name: "populated", entries: entries, status: http.StatusOK},
		{name: "genuine empty", status: http.StatusOK},
		{name: "query failure", queryErr: failure, status: http.StatusInternalServerError},
		{name: "scan failure", entries: entries, scanAt: 1, scanErr: failure, status: http.StatusInternalServerError},
		{name: "scan failure after valid row", entries: entries, scanAt: 2, scanErr: failure, status: http.StatusInternalServerError},
		{name: "iteration failure before rows", rowErr: failure, status: http.StatusInternalServerError},
		{name: "iteration failure after valid rows", entries: entries, rowErr: failure, status: http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows := &activityRows{entries: tt.entries, scanAt: tt.scanAt, scanErr: tt.scanErr, rowErr: tt.rowErr}
			type contextKey struct{}
			ctx := context.WithValue(context.Background(), contextKey{}, "request context")
			actor := "synthetic' OR 1=1 --"
			h := &AuditHandler{
				forwardAuthHeader: "X-Forwarded-User",
				activityPool: activityQueryFunc(func(queryCtx context.Context, sql string, args ...any) (pgx.Rows, error) {
					if queryCtx.Value(contextKey{}) != "request context" {
						t.Fatal("request context was not propagated")
					}
					if !strings.Contains(sql, "WHERE actor = $1 AND ts BETWEEN $2 AND $3") ||
						!strings.Contains(sql, "ORDER BY ts DESC") ||
						!strings.Contains(sql, "LIMIT $4 OFFSET $5") || strings.Contains(sql, actor) {
						t.Fatalf("actor/date/pagination SQL changed: %s", sql)
					}
					if len(args) != 5 || args[0] != actor || args[3] != 200 || args[4] != 7 {
						t.Fatalf("unexpected query arguments: %v", args)
					}
					start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
					end := time.Date(2026, 10, 14, 23, 59, 59, 0, time.UTC)
					if args[1] != start || args[2] != end {
						t.Fatalf("date bounds changed: %v", args[1:3])
					}
					if tt.queryErr != nil {
						return nil, tt.queryErr
					}
					return rows, nil
				}),
			}
			req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/activity?start=2026-10-01&end=2026-10-14&limit=500&offset=7", nil).WithContext(ctx)
			req.Header.Set("X-Forwarded-User", actor)
			rec := httptest.NewRecorder()
			h.UserActivity(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status=%d, want %d; body=%s", rec.Code, tt.status, rec.Body.String())
			}
			if tt.queryErr == nil && !rows.closed {
				t.Fatal("rows were not closed")
			}
			if tt.status != http.StatusOK {
				var body map[string]string
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["error"] != "failed to load user activity" {
					t.Fatalf("expected explicit generic error, got %s", rec.Body.String())
				}
				if strings.Contains(rec.Body.String(), failure.Error()) {
					t.Fatal("internal error leaked in response")
				}
				return
			}
			want := tt.entries
			if want == nil {
				want = []userActivityEntry{}
			}
			wantJSON, err := json.Marshal(want)
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(rec.Body.String()) != string(wantJSON) {
				t.Fatalf("response=%s, want %s", rec.Body.String(), wantJSON)
			}
		})
	}
}

func TestUserActivity_StorageUnavailable(t *testing.T) {
	h := NewAuditHandler(nil, "X-Forwarded-User")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/activity", nil)
	req.Header.Set("X-Forwarded-User", "synthetic-user")
	rec := httptest.NewRecorder()
	h.UserActivity(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d, want 503; body=%s", rec.Code, rec.Body.String())
	}
}
