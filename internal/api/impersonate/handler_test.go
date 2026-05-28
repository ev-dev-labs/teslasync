// Phase-46 / Prompt 46 — Tests for the impersonation HTTP handler.
//
// Covers:
//   - Open mode (no FORWARD_AUTH_HEADER) → 501 AUTH_MODE_OPEN on every
//     endpoint, no store calls.
//   - Forward-auth + missing header → 401 MISSING_IDENTITY.
//   - GET state inactive vs active.
//   - POST start happy path: writes audit row, sets cookie, returns
//     active envelope.
//   - POST start refuses self-impersonation, blank target,
//     unknown-target, malformed body.
//   - POST start refuses while already impersonating (defensive — the
//     route is normally gated by RequireNotImpersonating upstream).
//   - POST end clears cookie and writes audit row.
//   - POST end is idempotent when no claim is active.
//   - GET candidates excludes the actor.

package impersonate

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// fakeImpersonationStore implements both ImpersonationCandidatesStore
// and ImpersonationAuditWriter so a single value covers all the seams
// the handler depends on.
type fakeImpersonationStore struct {
	mu             sync.Mutex
	subjects       []string
	subjectsErr    error
	startEvents    []auditdb.AuditImpersonationEvent
	endEvents      []auditdb.AuditImpersonationEvent
	startErr       error
	endErr         error
	startCalled    int32
	endCalled      int32
	subjectsCalled int32
}

func (s *fakeImpersonationStore) ListDistinctActiveSubjects(_ context.Context) ([]string, error) {
	atomic.AddInt32(&s.subjectsCalled, 1)
	if s.subjectsErr != nil {
		return nil, s.subjectsErr
	}
	out := make([]string, len(s.subjects))
	copy(out, s.subjects)
	return out, nil
}

func (s *fakeImpersonationStore) WriteImpersonationStart(_ context.Context, evt auditdb.AuditImpersonationEvent) error {
	atomic.AddInt32(&s.startCalled, 1)
	if s.startErr != nil {
		return s.startErr
	}
	s.mu.Lock()
	s.startEvents = append(s.startEvents, evt)
	s.mu.Unlock()
	return nil
}

func (s *fakeImpersonationStore) WriteImpersonationEnd(_ context.Context, evt auditdb.AuditImpersonationEvent) error {
	atomic.AddInt32(&s.endCalled, 1)
	if s.endErr != nil {
		return s.endErr
	}
	s.mu.Lock()
	s.endEvents = append(s.endEvents, evt)
	s.mu.Unlock()
	return nil
}

const impersonationTestForwardHeader = "X-Forwarded-User"

func newImpersonationTestHandler(t *testing.T, store *fakeImpersonationStore, headerName string) (*Handler, *tsauth.ImpersonationStore) {
	t.Helper()
	cookieStore, err := tsauth.NewImpersonationStore()
	if err != nil {
		t.Fatalf("NewImpersonationStore: %v", err)
	}
	h := NewHandler(cookieStore, store, store, headerName)
	return h, cookieStore
}

func TestHandler_OpenMode(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, "")
	cases := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"GetState", http.MethodGet, "/", h.GetState},
		{"Start", http.MethodPost, "/", h.Start},
		{"End", http.MethodPost, "/end", h.End},
		{"Candidates", http.MethodGet, "/candidates", h.Candidates},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`))
			rr := httptest.NewRecorder()
			tc.handler(rr, req)
			if rr.Code != http.StatusNotImplemented {
				t.Fatalf("expected 501, got %d", rr.Code)
			}
			var env map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
				t.Fatalf("unmarshal body: %v", err)
			}
			if env["code"] != tsauth.AuthModeOpenCode {
				t.Fatalf("expected code %q, got %v", tsauth.AuthModeOpenCode, env["code"])
			}
		})
	}
	// Open-mode endpoints must NOT touch the candidates / audit
	// stores — the response is decided before any backing query.
	if atomic.LoadInt32(&store.subjectsCalled) != 0 {
		t.Fatalf("expected 0 candidate calls, got %d", store.subjectsCalled)
	}
	if atomic.LoadInt32(&store.startCalled)+atomic.LoadInt32(&store.endCalled) != 0 {
		t.Fatal("expected 0 audit writes in open mode")
	}
}

func TestHandler_GetState_MissingHeaderReturns401(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	h.GetState(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandler_GetState_Inactive(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.GetState(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var env map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env["mode"] != "inactive" {
		t.Fatalf("expected mode inactive, got %v", env["mode"])
	}
}

func TestHandler_GetState_Active(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(impersonationTestForwardHeader, "admin")
	ctx := tsauth.WithImpersonationForTests(req.Context(), tsauth.ImpersonationClaim{
		OriginalAdmin: "admin",
		Target:        "target",
		ExpiresAt:     mustTimeForward(t),
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	h.GetState(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var env map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env["mode"] != "active" {
		t.Fatalf("expected mode active, got %v", env["mode"])
	}
	if env["original_admin"] != "admin" || env["target"] != "target" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
}

func TestHandler_Start_HappyPath(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{subjects: []string{"admin", "target"}}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"subject":"target"}`))
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.Start(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var env map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env["mode"] != "active" || env["target"] != "target" || env["original_admin"] != "admin" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	// Cookie should be set.
	resp := rr.Result()
	defer resp.Body.Close()
	var found bool
	for _, c := range resp.Cookies() {
		if c.Name == tsauth.ImpersonationCookieName && c.Value != "" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected impersonation cookie set")
	}
	// Audit row written.
	if atomic.LoadInt32(&store.startCalled) != 1 {
		t.Fatalf("expected 1 start audit, got %d", store.startCalled)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.startEvents) != 1 || store.startEvents[0].Actor != "admin" || store.startEvents[0].Target != "target" {
		t.Fatalf("unexpected start event: %+v", store.startEvents)
	}
}

func TestHandler_Start_RejectsSelfTarget(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{subjects: []string{"admin"}}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"subject":"admin"}`))
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.Start(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), ImpersonationCodeInvalidTarget) {
		t.Fatalf("expected INVALID_IMPERSONATION_TARGET, got %s", rr.Body.String())
	}
}

func TestHandler_Start_RejectsBlankTarget(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"subject":"   "}`))
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.Start(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandler_Start_RejectsUnknownTarget(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{subjects: []string{"admin", "alice"}}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"subject":"bob"}`))
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.Start(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), ImpersonationCodeInvalidTarget) {
		t.Fatalf("expected INVALID_IMPERSONATION_TARGET, got %s", rr.Body.String())
	}
	if atomic.LoadInt32(&store.startCalled) != 0 {
		t.Fatalf("expected 0 start audits, got %d", store.startCalled)
	}
}

func TestHandler_Start_RejectsBadJSON(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{not-json`))
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.Start(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), ImpersonationCodeBadBody) {
		t.Fatalf("expected INVALID_BODY, got %s", rr.Body.String())
	}
}

func TestHandler_Start_RejectsAlreadyImpersonating(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{subjects: []string{"admin", "target"}}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"subject":"target"}`))
	req.Header.Set(impersonationTestForwardHeader, "admin")
	ctx := tsauth.WithImpersonationForTests(req.Context(), tsauth.ImpersonationClaim{
		OriginalAdmin: "admin",
		Target:        "other",
		ExpiresAt:     mustTimeForward(t),
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	h.Start(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), ImpersonationCodeAlreadyImpersonating) {
		t.Fatalf("expected ALREADY_IMPERSONATING, got %s", rr.Body.String())
	}
}

func TestHandler_Start_MissingHeaderReturns401(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"subject":"target"}`))
	rr := httptest.NewRecorder()
	h.Start(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandler_End_HappyPath(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/end", nil)
	req.Header.Set(impersonationTestForwardHeader, "target") // header rewritten by middleware
	ctx := tsauth.WithImpersonationForTests(req.Context(), tsauth.ImpersonationClaim{
		OriginalAdmin: "admin",
		Target:        "target",
		ExpiresAt:     mustTimeForward(t),
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	h.End(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rr.Code, rr.Body.String())
	}
	if atomic.LoadInt32(&store.endCalled) != 1 {
		t.Fatalf("expected 1 end audit, got %d", store.endCalled)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.endEvents) != 1 || store.endEvents[0].Actor != "admin" || store.endEvents[0].Target != "target" {
		t.Fatalf("unexpected end event: %+v", store.endEvents)
	}
	// Clear-cookie should be set.
	resp := rr.Result()
	defer resp.Body.Close()
	var foundClear bool
	for _, c := range resp.Cookies() {
		if c.Name == tsauth.ImpersonationCookieName && c.MaxAge < 0 {
			foundClear = true
		}
	}
	if !foundClear {
		t.Fatal("expected clear-cookie")
	}
}

func TestHandler_End_Idempotent(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodPost, "/end", nil)
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.End(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rr.Code, rr.Body.String())
	}
	// No claim → no audit row.
	if atomic.LoadInt32(&store.endCalled) != 0 {
		t.Fatalf("expected 0 end audits, got %d", store.endCalled)
	}
	// Defensive clear-cookie should still be set.
	resp := rr.Result()
	defer resp.Body.Close()
	var foundClear bool
	for _, c := range resp.Cookies() {
		if c.Name == tsauth.ImpersonationCookieName && c.MaxAge < 0 {
			foundClear = true
		}
	}
	if !foundClear {
		t.Fatal("expected defensive clear-cookie even without claim")
	}
}

func TestHandler_Candidates_ExcludesActor(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{subjects: []string{"admin", "alice", "bob"}}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodGet, "/candidates", nil)
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.Candidates(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Mode       string              `json:"mode"`
		Candidates []map[string]string `json:"candidates"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Mode != "session" {
		t.Fatalf("expected mode session, got %q", env.Mode)
	}
	subjects := make([]string, 0, len(env.Candidates))
	for _, c := range env.Candidates {
		subjects = append(subjects, c["subject"])
	}
	if len(subjects) != 2 {
		t.Fatalf("expected 2 candidates excluding actor, got %v", subjects)
	}
	for _, s := range subjects {
		if s == "admin" {
			t.Fatalf("actor should be excluded, got %v", subjects)
		}
	}
}

func TestHandler_Candidates_MissingHeaderReturns401(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodGet, "/candidates", nil)
	rr := httptest.NewRecorder()
	h.Candidates(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandler_Candidates_DuringImpersonationUsesOriginalAdmin(t *testing.T) {
	t.Parallel()
	// Simulates the case where the SPA polls /candidates while the
	// admin is mid-impersonation: the header has been rewritten to
	// the target, but resolveActor reads the original admin from
	// the impersonation claim so the candidates list still excludes
	// the admin (not the target).
	store := &fakeImpersonationStore{subjects: []string{"admin", "alice", "bob"}}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodGet, "/candidates", nil)
	req.Header.Set(impersonationTestForwardHeader, "alice") // rewritten to target
	ctx := tsauth.WithImpersonationForTests(req.Context(), tsauth.ImpersonationClaim{
		OriginalAdmin: "admin",
		Target:        "alice",
		ExpiresAt:     mustTimeForward(t),
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	h.Candidates(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Candidates []map[string]string `json:"candidates"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, c := range env.Candidates {
		if c["subject"] == "admin" {
			t.Fatalf("admin should be excluded, got %+v", env.Candidates)
		}
	}
}

func TestHandler_Candidates_StoreErrorReturns500(t *testing.T) {
	t.Parallel()
	store := &fakeImpersonationStore{subjectsErr: errBoomImpersonation}
	h, _ := newImpersonationTestHandler(t, store, impersonationTestForwardHeader)
	req := httptest.NewRequest(http.MethodGet, "/candidates", nil)
	req.Header.Set(impersonationTestForwardHeader, "admin")
	rr := httptest.NewRecorder()
	h.Candidates(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
}

// errBoomImpersonation is a sentinel for store-error simulation.
var errBoomImpersonation = boomError("boom")

type boomError string

func (e boomError) Error() string { return string(e) }

// mustTimeForward returns a time well in the future for tests that
// need a non-expired claim. Centralised so the "+1 hour" choice is
// consistent across cases.
func mustTimeForward(t *testing.T) time.Time {
	t.Helper()
	return time.Now().Add(time.Hour)
}
