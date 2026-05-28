// Phase-46 / Prompt 42 — SessionHandler unit tests.
//
// Covers:
//
//   - Open mode (no FORWARD_AUTH_HEADER) → 501 AUTH_MODE_OPEN on every
//     endpoint, no store calls.
//   - Forward-auth + missing header → 401 MISSING_IDENTITY.
//   - GET /auth/sessions returns rows + flags Current correctly.
//   - DELETE /auth/sessions/{id} validates uuid + idempotent on
//     ErrAuthSessionNotFound.
//   - DELETE /auth/sessions/all-others propagates the revoked count.
//   - No call to any provider-specific URL appears anywhere — the
//     handler talks only to its injected SessionListStore.

package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
)

// fakeSessionListStore is the in-memory test double for SessionListStore.
type fakeSessionListStore struct {
	rows               []dbauth.AuthSessionRow
	listErr            error
	revokeErr          error
	revokeAllErr       error
	revokeCalls        int32
	revokeAllOthersOut int64
	revokeAllOthersIn  uuid.UUID
	listSubject        string
}

func (s *fakeSessionListStore) ListActiveBySubject(_ context.Context, subject string) ([]dbauth.AuthSessionRow, error) {
	s.listSubject = subject
	if s.listErr != nil {
		return nil, s.listErr
	}
	return s.rows, nil
}

func (s *fakeSessionListStore) Revoke(_ context.Context, _ uuid.UUID, _ string) error {
	atomic.AddInt32(&s.revokeCalls, 1)
	return s.revokeErr
}

func (s *fakeSessionListStore) RevokeAllOthers(_ context.Context, _ string, exceptID uuid.UUID) (int64, error) {
	s.revokeAllOthersIn = exceptID
	if s.revokeAllErr != nil {
		return 0, s.revokeAllErr
	}
	return s.revokeAllOthersOut, nil
}

const sessionTestHeader = "X-Forwarded-User"

// withCurrentSession returns ctx augmented with id as the
// CurrentSessionID, mirroring what tsauth.Middleware would inject.
func withCurrentSession(ctx context.Context, id uuid.UUID) context.Context {
	// We can't import the unexported sessionIDKey from the auth
	// package here, so we round-trip through the public
	// CurrentSessionID seam by pre-baking a request through a fake
	// Middleware. Simpler: use the helper exported from tsauth.
	return tsauth.WithSessionForTests(ctx, id)
}

func TestSessionHandler_OpenMode(t *testing.T) {
	store := &fakeSessionListStore{}
	h := NewSessionHandler(store, "")

	cases := []struct {
		name   string
		method string
		path   string
		exec   func(http.ResponseWriter, *http.Request)
	}{
		{"List", http.MethodGet, "/auth/sessions", h.List},
		{"Revoke", http.MethodDelete, "/auth/sessions/" + uuid.NewString(), h.Revoke},
		{"RevokeAllOthers", http.MethodDelete, "/auth/sessions/all-others", h.RevokeAllOthers},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			tc.exec(rec, req)
			if rec.Code != http.StatusNotImplemented {
				t.Fatalf("status: got %d, want 501; body=%s", rec.Code, rec.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body["code"] != AuthModeOpenCode {
				t.Fatalf("code: got %v, want %s", body["code"], AuthModeOpenCode)
			}
		})
	}
	if store.listSubject != "" || atomic.LoadInt32(&store.revokeCalls) != 0 {
		t.Fatalf("open-mode requests must not touch the store; subj=%q revokes=%d",
			store.listSubject, store.revokeCalls)
	}
}

func TestSessionHandler_MissingHeaderReturns401(t *testing.T) {
	store := &fakeSessionListStore{}
	h := NewSessionHandler(store, sessionTestHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/sessions", nil)
	// No X-Forwarded-User set.
	h.List(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["code"] != "MISSING_IDENTITY" {
		t.Fatalf("code: got %v, want MISSING_IDENTITY", body["code"])
	}
}

func TestSessionHandler_ListReturnsRowsAndCurrentFlag(t *testing.T) {
	currentID := uuid.New()
	otherID := uuid.New()
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	store := &fakeSessionListStore{
		rows: []dbauth.AuthSessionRow{
			{
				ID:         currentID,
				Subject:    "alice",
				UserAgent:  "Firefox",
				IP:         "10.1.1.1",
				CreatedAt:  now.Add(-time.Hour),
				LastSeenAt: now,
			},
			{
				ID:         otherID,
				Subject:    "alice",
				UserAgent:  "Chrome",
				IP:         "10.2.2.2",
				CreatedAt:  now.Add(-2 * time.Hour),
				LastSeenAt: now.Add(-30 * time.Minute),
			},
		},
	}
	h := NewSessionHandler(store, sessionTestHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/sessions", nil).WithContext(
		withCurrentSession(context.Background(), currentID),
	)
	req.Header.Set(sessionTestHeader, "alice")
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body sessionListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Mode != "session" {
		t.Fatalf("mode: got %q, want session", body.Mode)
	}
	if len(body.Sessions) != 2 {
		t.Fatalf("sessions: got %d, want 2", len(body.Sessions))
	}
	if !body.Sessions[0].Current || body.Sessions[1].Current {
		t.Fatalf("current flag wrong: %+v", body.Sessions)
	}
	if body.Sessions[0].UserAgent != "Firefox" || body.Sessions[1].UserAgent != "Chrome" {
		t.Fatalf("rows out of order: %+v", body.Sessions)
	}
	if store.listSubject != "alice" {
		t.Fatalf("subject not threaded; got %q", store.listSubject)
	}
}

func TestSessionHandler_ListNoCurrentInContext(t *testing.T) {
	store := &fakeSessionListStore{
		rows: []dbauth.AuthSessionRow{{ID: uuid.New(), Subject: "alice"}},
	}
	h := NewSessionHandler(store, sessionTestHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/sessions", nil)
	req.Header.Set(sessionTestHeader, "alice")
	h.List(rec, req)

	var body sessionListResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	for _, s := range body.Sessions {
		if s.Current {
			t.Fatalf("no row should report current when ctx has no session id")
		}
	}
}

func TestSessionHandler_ListErrorReturns500(t *testing.T) {
	store := &fakeSessionListStore{listErr: errors.New("db down")}
	h := NewSessionHandler(store, sessionTestHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/sessions", nil)
	req.Header.Set(sessionTestHeader, "alice")
	h.List(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", rec.Code)
	}
}

// withChiID returns a request whose chi route context has the supplied
// "id" URL param so chi.URLParam works without mounting a real router.
func withChiID(req *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestSessionHandler_RevokeRejectsBadUUID(t *testing.T) {
	store := &fakeSessionListStore{}
	h := NewSessionHandler(store, sessionTestHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/auth/sessions/not-a-uuid", nil)
	req.Header.Set(sessionTestHeader, "alice")
	req = withChiID(req, "not-a-uuid")
	h.Revoke(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad uuid should 400, got %d", rec.Code)
	}
	if atomic.LoadInt32(&store.revokeCalls) != 0 {
		t.Fatalf("Revoke must not run on bad uuid")
	}
}

func TestSessionHandler_RevokeSuccess(t *testing.T) {
	store := &fakeSessionListStore{}
	h := NewSessionHandler(store, sessionTestHeader)
	id := uuid.New()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/auth/sessions/"+id.String(), nil)
	req.Header.Set(sessionTestHeader, "alice")
	req = withChiID(req, id.String())
	h.Revoke(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status: got %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
	if atomic.LoadInt32(&store.revokeCalls) != 1 {
		t.Fatalf("expected 1 Revoke call")
	}
}

func TestSessionHandler_RevokeIdempotentOnNotFound(t *testing.T) {
	store := &fakeSessionListStore{revokeErr: dbauth.ErrAuthSessionNotFound}
	h := NewSessionHandler(store, sessionTestHeader)
	id := uuid.New()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/auth/sessions/"+id.String(), nil)
	req.Header.Set(sessionTestHeader, "alice")
	req = withChiID(req, id.String())
	h.Revoke(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status: got %d, want 204 (idempotent)", rec.Code)
	}
}

func TestSessionHandler_RevokeOtherErrorReturns500(t *testing.T) {
	store := &fakeSessionListStore{revokeErr: errors.New("db down")}
	h := NewSessionHandler(store, sessionTestHeader)
	id := uuid.New()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/auth/sessions/"+id.String(), nil)
	req.Header.Set(sessionTestHeader, "alice")
	req = withChiID(req, id.String())
	h.Revoke(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", rec.Code)
	}
}

func TestSessionHandler_RevokeAllOthersWithCurrent(t *testing.T) {
	store := &fakeSessionListStore{revokeAllOthersOut: 3}
	h := NewSessionHandler(store, sessionTestHeader)
	currentID := uuid.New()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/auth/sessions/all-others", nil).WithContext(
		withCurrentSession(context.Background(), currentID),
	)
	req.Header.Set(sessionTestHeader, "alice")
	h.RevokeAllOthers(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body revokeAllOthersResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Revoked != 3 {
		t.Fatalf("revoked: got %d, want 3", body.Revoked)
	}
	if store.revokeAllOthersIn != currentID {
		t.Fatalf("exceptID: got %s, want %s", store.revokeAllOthersIn, currentID)
	}
}

func TestSessionHandler_RevokeAllOthersWithoutCurrent(t *testing.T) {
	store := &fakeSessionListStore{revokeAllOthersOut: 5}
	h := NewSessionHandler(store, sessionTestHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/auth/sessions/all-others", nil)
	req.Header.Set(sessionTestHeader, "alice")
	h.RevokeAllOthers(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	if store.revokeAllOthersIn != uuid.Nil {
		t.Fatalf("exceptID should be Nil when no current session in ctx; got %s", store.revokeAllOthersIn)
	}
}

func TestSessionHandler_RevokeAllOthersErrorReturns500(t *testing.T) {
	store := &fakeSessionListStore{revokeAllErr: errors.New("db down")}
	h := NewSessionHandler(store, sessionTestHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/auth/sessions/all-others", nil)
	req.Header.Set(sessionTestHeader, "alice")
	h.RevokeAllOthers(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", rec.Code)
	}
}
