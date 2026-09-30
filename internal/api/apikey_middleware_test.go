package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// appTokenFakeQuerier satisfies database.DBTX with a scripted key lookup.
type appTokenFakeQuerier struct {
	id      int64
	name    string
	subject string
	lookup  error
	execs   int
	query   string
}

func (f *appTokenFakeQuerier) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	return nil, errors.New("appToken: unexpected Query call")
}

func (f *appTokenFakeQuerier) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	f.query = query
	return appTokenFakeRow{id: f.id, name: f.name, subject: f.subject, err: f.lookup}
}

func (f *appTokenFakeQuerier) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	f.execs++
	return pgconn.CommandTag{}, nil
}

var _ database.DBTX = (*appTokenFakeQuerier)(nil)

type appTokenFakeRow struct {
	id      int64
	name    string
	subject string
	err     error
}

func (r appTokenFakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 3 {
		return errors.New("appTokenFakeRow: want 3 scan destinations")
	}
	if p, ok := dest[0].(*int64); ok {
		*p = r.id
	}
	if p, ok := dest[1].(*string); ok {
		*p = r.name
	}
	if p, ok := dest[2].(*string); ok {
		*p = r.subject
	}
	return nil
}

var _ pgx.Row = appTokenFakeRow{}

const appTokenTestHeader = "X-Forwarded-User"

func appTokenNext(w http.ResponseWriter, r *http.Request) {
	subject, ok := tsauth.AppTokenSubjectFromContext(r.Context())
	if !ok {
		subject = "unflagged:" + r.Header.Get(appTokenTestHeader)
	}
	w.Header().Set("X-Test-Subject", subject)
	w.WriteHeader(http.StatusTeapot)
}

func TestAppTokenAuth(t *testing.T) {
	t.Parallel()

	serve := func(q database.DBTX, headerName string, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles", nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		appTokenAuth(q, headerName)(http.HandlerFunc(appTokenNext)).ServeHTTP(rec, req)
		return rec
	}

	t.Run("no header passes through", func(t *testing.T) {
		t.Parallel()
		rec := serve(&appTokenFakeQuerier{}, appTokenTestHeader, nil)
		if rec.Code != http.StatusTeapot {
			t.Fatalf("got status %d, want passthrough", rec.Code)
		}
	})

	t.Run("non-Bearer scheme passes through", func(t *testing.T) {
		t.Parallel()
		rec := serve(&appTokenFakeQuerier{}, appTokenTestHeader, map[string]string{"Authorization": "Basic abc123"})
		if rec.Code != http.StatusTeapot {
			t.Fatalf("got status %d, want passthrough", rec.Code)
		}
	})

	t.Run("open mode ignores Bearer tokens", func(t *testing.T) {
		t.Parallel()
		q := &appTokenFakeQuerier{id: 1, subject: "alice"}
		rec := serve(q, "", map[string]string{"Authorization": "Bearer ts_abc"})
		if rec.Code != http.StatusTeapot {
			t.Fatalf("got status %d, want passthrough", rec.Code)
		}
	})

	t.Run("nil database fails closed with 503", func(t *testing.T) {
		t.Parallel()
		rec := serve(nil, appTokenTestHeader, map[string]string{"Authorization": "Bearer ts_abc"})
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("got status %d, want 503", rec.Code)
		}
	})

	t.Run("unknown token fails closed with 401", func(t *testing.T) {
		t.Parallel()
		q := &appTokenFakeQuerier{lookup: pgx.ErrNoRows}
		rec := serve(q, appTokenTestHeader, map[string]string{"Authorization": "Bearer ts_bogus"})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("got status %d, want 401", rec.Code)
		}
	})

	t.Run("database failure returns 503", func(t *testing.T) {
		t.Parallel()
		q := &appTokenFakeQuerier{lookup: errors.New("database unavailable")}
		rec := serve(q, appTokenTestHeader, map[string]string{"Authorization": "Bearer ts_test"})
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("got status %d, want 503", rec.Code)
		}
	})

	t.Run("device-scoped key is rejected as Bearer", func(t *testing.T) {
		t.Parallel()
		q := &appTokenFakeQuerier{id: 2, subject: ""}
		rec := serve(q, appTokenTestHeader, map[string]string{"Authorization": "Bearer ts_device"})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("got status %d, want 401", rec.Code)
		}
	})

	t.Run("valid token injects subject and flags context", func(t *testing.T) {
		t.Parallel()
		q := &appTokenFakeQuerier{id: 7, subject: "alice@example.com"}
		rec := serve(q, appTokenTestHeader, map[string]string{"Authorization": "Bearer ts_valid"})
		if rec.Code != http.StatusTeapot {
			t.Fatalf("got status %d, want passthrough", rec.Code)
		}
		if got := rec.Header().Get("X-Test-Subject"); got != "alice@example.com" {
			t.Fatalf("got subject %q, want alice@example.com", got)
		}
		if q.execs != 1 {
			t.Fatalf("got %d last_used updates, want 1", q.execs)
		}
		if !strings.Contains(q.query, "permissions = 'admin'") {
			t.Fatalf("token lookup does not restrict authentication to admin keys: %s", q.query)
		}
	})

	t.Run("conflicting proxy identity is rejected", func(t *testing.T) {
		t.Parallel()
		q := &appTokenFakeQuerier{id: 7, subject: "alice@example.com"}
		rec := serve(q, appTokenTestHeader, map[string]string{
			"Authorization":    "Bearer ts_valid",
			appTokenTestHeader: "mallory@example.com",
		})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("got status %d, want 401", rec.Code)
		}
	})

	t.Run("matching proxy identity is accepted", func(t *testing.T) {
		t.Parallel()
		q := &appTokenFakeQuerier{id: 7, subject: "alice@example.com"}
		rec := serve(q, appTokenTestHeader, map[string]string{
			"Authorization":    "Bearer ts_valid",
			appTokenTestHeader: "alice@example.com",
		})
		if rec.Code != http.StatusTeapot {
			t.Fatalf("got status %d, want passthrough", rec.Code)
		}
	})
}
