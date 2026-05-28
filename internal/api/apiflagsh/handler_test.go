// Phase-44 / observability-batch / Prompt F8 — Flags handler tests.
//
// Exercises the HTTP layer with a real *flags.Store backed by a
// miniredis instance. This is the cleanest way to validate the
// list / get / set / delete contract because the store's Pub/Sub
// invalidation needs a redis.Client. The audit repo is nil here
// because its constructor requires a *DB; the /changes endpoint
// degrades to 503 in that branch which we cover as a separate test.

package apiflagsh

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/ev-dev-labs/teslasync/internal/flags"
)

func newFlagsTestStore(t *testing.T) (*flags.Store, func()) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := flags.NewStore(rdb, flags.WithLocalCacheTTL(50*time.Millisecond))
	shutdown := store.Start(context.Background())
	cleanup := func() {
		shutdown()
		_ = rdb.Close()
	}
	return store, cleanup
}

func TestHandler_List_Empty_ReturnsZero(t *testing.T) {
	t.Parallel()
	store, cleanup := newFlagsTestStore(t)
	defer cleanup()

	h := NewHandler(store, nil, "X-Forwarded-User")
	req := httptest.NewRequest("GET", "/system/flags", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var body FlagsListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Count != 0 {
		t.Fatalf("expected 0, got %d", body.Count)
	}
	if body.Flags == nil {
		t.Fatal("expected non-nil flags array (must be empty array, not null)")
	}
}

func TestHandler_SetGetDelete_Roundtrip(t *testing.T) {
	t.Parallel()
	store, cleanup := newFlagsTestStore(t)
	defer cleanup()
	ctx := context.Background()
	// Seed a value so the Set returns a non-empty prev.
	if _, _, err := store.Set(ctx, "ingest.dual_write", "true"); err != nil {
		t.Fatal(err)
	}

	h := NewHandler(store, nil, "X-Forwarded-User")
	r := chi.NewRouter()
	r.Get("/system/flags/{key}", h.Get)
	r.Put("/system/flags/{key}", h.Set)
	r.Delete("/system/flags/{key}", h.Delete)

	// GET existing
	req := httptest.NewRequest("GET", "/system/flags/ingest.dual_write", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got FlagListEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Key != "ingest.dual_write" || got.Value != "true" {
		t.Fatalf("got %+v", got)
	}

	// PUT (update). nil audit repo means audit_id should be 0.
	body := strings.NewReader(`{"value":"false","reason":"toggled for incident X"}`)
	req = httptest.NewRequest("PUT", "/system/flags/ingest.dual_write", body)
	req.Header.Set("X-Forwarded-User", "alice")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var put FlagWriteResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &put); err != nil {
		t.Fatal(err)
	}
	if put.OldValue != "true" || put.NewValue != "false" {
		t.Fatalf("put round-trip wrong: %+v", put)
	}
	if put.AuditID != 0 {
		t.Fatalf("nil audit repo must return 0, got %d", put.AuditID)
	}

	// DELETE
	req = httptest.NewRequest("DELETE", "/system/flags/ingest.dual_write", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var del FlagWriteResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &del); err != nil {
		t.Fatal(err)
	}
	if del.OldValue != "false" || !del.Deleted {
		t.Fatalf("delete wrong: %+v", del)
	}
}

func TestHandler_Get_NotFound_Returns404(t *testing.T) {
	t.Parallel()
	store, cleanup := newFlagsTestStore(t)
	defer cleanup()

	h := NewHandler(store, nil, "X-Forwarded-User")
	r := chi.NewRouter()
	r.Get("/system/flags/{key}", h.Get)
	req := httptest.NewRequest("GET", "/system/flags/nonexistent.flag", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_Set_InvalidJSON_Returns400(t *testing.T) {
	t.Parallel()
	store, cleanup := newFlagsTestStore(t)
	defer cleanup()
	h := NewHandler(store, nil, "X-Forwarded-User")
	r := chi.NewRouter()
	r.Put("/system/flags/{key}", h.Set)
	req := httptest.NewRequest("PUT", "/system/flags/a.b", strings.NewReader("not json"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_NoStore_Returns503(t *testing.T) {
	t.Parallel()
	h := NewHandler(nil, nil, "X-Forwarded-User")
	req := httptest.NewRequest("GET", "/system/flags", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_Changes_NoRepo_Returns503(t *testing.T) {
	t.Parallel()
	store, cleanup := newFlagsTestStore(t)
	defer cleanup()
	h := NewHandler(store, nil, "X-Forwarded-User")
	r := chi.NewRouter()
	r.Get("/system/flags/changes", h.Changes)
	req := httptest.NewRequest("GET", "/system/flags/changes", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", rec.Code, rec.Body.String())
	}
}
