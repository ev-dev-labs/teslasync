// Phase-46 / Prompt 44 — RBACHandler unit tests.
//
// Covers:
//   - Open mode (no FORWARD_AUTH_HEADER) → 501 AUTH_MODE_OPEN on every
//     endpoint, no store calls.
//   - Forward-auth + missing header → 401 MISSING_IDENTITY.
//   - GET /admin/rbac/matrix returns the full catalog + the caller's
//     effective permissions union across roles.
//   - GET surfaces roles that exist in the store but not in the
//     caller's claims.
//   - PUT /admin/rbac/matrix happy-path returns 204 + propagates the
//     batch to the store.
//   - PUT rejects an unknown permission_id with 400 INVALID_PERMISSION.
//   - PUT rejects an empty role_id with 400 INVALID_ROLE.
//   - PUT rejects a body exceeding MaxRBACUpsertCells with 400 INVALID_BODY.

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
)

// fakeRBACStore is the in-memory test double for RBACMatrixStore.
type fakeRBACStore struct {
	matrix       map[string]map[string]bool
	getErr       error
	upsertErr    error
	listErr      error
	upsertCalled int32
	upsertCells  []dbauth.RolePermissionCell
}

func (s *fakeRBACStore) GetMatrix(_ context.Context, roles []string) (map[string]map[string]bool, error) {
	if s.getErr != nil {
		return nil, s.getErr
	}
	out := make(map[string]map[string]bool)
	if s.matrix == nil {
		return out, nil
	}
	want := make(map[string]struct{}, len(roles))
	for _, r := range roles {
		want[r] = struct{}{}
	}
	for role, row := range s.matrix {
		if _, ok := want[role]; !ok {
			continue
		}
		dup := make(map[string]bool, len(row))
		for k, v := range row {
			dup[k] = v
		}
		out[role] = dup
	}
	return out, nil
}

func (s *fakeRBACStore) UpsertCells(_ context.Context, cells []dbauth.RolePermissionCell) error {
	atomic.AddInt32(&s.upsertCalled, 1)
	if s.upsertErr != nil {
		return s.upsertErr
	}
	s.upsertCells = append(s.upsertCells, cells...)
	return nil
}

func (s *fakeRBACStore) ListAllRoleIDs(_ context.Context) ([]string, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	out := make([]string, 0, len(s.matrix))
	for role := range s.matrix {
		out = append(out, role)
	}
	return out, nil
}

const rbacTestForwardHeader = "X-Forwarded-User"
const rbacTestGroupsHeader = "X-Forwarded-Groups"

// newRBACHandler is a small helper that wires the handler with the
// supplied groups header name. We reach into the unexported field
// because the production constructor reads the env once at construction
// and stable env mutation across parallel tests is awkward.
func newRBACHandler(store RBACMatrixStore, fwdHeader, groupsHeader string) *RBACHandler {
	h := NewRBACHandler(store, fwdHeader)
	h.groupsHeader = strings.TrimSpace(groupsHeader)
	return h
}

func TestRBACHandler_OpenMode(t *testing.T) {
	store := &fakeRBACStore{}
	h := NewRBACHandler(store, "")

	cases := []struct {
		name   string
		method string
		exec   func(http.ResponseWriter, *http.Request)
	}{
		{"GetMatrix", http.MethodGet, h.GetMatrix},
		{"UpsertMatrix", http.MethodPut, h.UpsertMatrix},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, "/admin/rbac/matrix", nil)
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
	if atomic.LoadInt32(&store.upsertCalled) != 0 {
		t.Fatalf("open-mode requests must not touch the store")
	}
}

func TestRBACHandler_GetMatrix_MissingHeaderReturns401(t *testing.T) {
	store := &fakeRBACStore{}
	h := newRBACHandler(store, rbacTestForwardHeader, "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/rbac/matrix", nil)
	h.GetMatrix(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["code"] != RBACCodeMissingIdentity {
		t.Fatalf("code: got %v, want MISSING_IDENTITY", body["code"])
	}
}

func TestRBACHandler_GetMatrix_HappyPath(t *testing.T) {
	store := &fakeRBACStore{
		matrix: map[string]map[string]bool{
			"admin":  {"fleet.read": true, "admin.audit": true},
			"reader": {"fleet.read": true},
		},
	}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/rbac/matrix", nil)
	req.Header.Set(rbacTestForwardHeader, "alice")
	req.Header.Set(rbacTestGroupsHeader, "admin,reader")
	h.GetMatrix(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body rbacMatrixResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Mode != "session" {
		t.Fatalf("mode: got %q, want session", body.Mode)
	}

	// Catalog round-trip.
	if len(body.Permissions) != len(tsauth.AllPermissions) {
		t.Fatalf("permissions count: got %d, want %d",
			len(body.Permissions), len(tsauth.AllPermissions))
	}

	// Roles include the implicit default + the two forwarded.
	roleIDs := make(map[string]struct{}, len(body.Roles))
	for _, r := range body.Roles {
		roleIDs[r.ID] = struct{}{}
	}
	for _, want := range []string{tsauth.DefaultRoleID, "admin", "reader"} {
		if _, ok := roleIDs[want]; !ok {
			t.Fatalf("role %q missing from response: %+v", want, body.Roles)
		}
	}

	// Effective grants = union across admin + reader (DefaultRoleID
	// has no rows in the matrix, so it grants nothing).
	if !body.EffectiveForMe["fleet.read"] {
		t.Fatalf("fleet.read should be effective via admin or reader")
	}
	if !body.EffectiveForMe["admin.audit"] {
		t.Fatalf("admin.audit should be effective via admin")
	}
	if body.EffectiveForMe["admin.rbac"] {
		t.Fatalf("admin.rbac should NOT be effective")
	}

	// Matrix exposes both bindings.
	if !body.Matrix["admin"]["admin.audit"] {
		t.Fatalf("admin row missing admin.audit grant")
	}
	if !body.Matrix["reader"]["fleet.read"] {
		t.Fatalf("reader row missing fleet.read grant")
	}
}

func TestRBACHandler_GetMatrix_SurfacesUnclaimedRoles(t *testing.T) {
	store := &fakeRBACStore{
		matrix: map[string]map[string]bool{
			"kid":  {"fleet.read": true},
			"user": {},
		},
	}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/rbac/matrix", nil)
	req.Header.Set(rbacTestForwardHeader, "alice")
	// Caller claims no groups; the "kid" role exists only in the store.
	h.GetMatrix(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body rbacMatrixResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)

	roleIDs := make(map[string]struct{}, len(body.Roles))
	for _, r := range body.Roles {
		roleIDs[r.ID] = struct{}{}
	}
	if _, ok := roleIDs["kid"]; !ok {
		t.Fatalf("unclaimed role 'kid' should still appear so admin can edit it")
	}
}

func TestRBACHandler_UpsertMatrix_Happy(t *testing.T) {
	store := &fakeRBACStore{}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	body := `{"cells":[{"role_id":"reader","permission_id":"fleet.read","allowed":true}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/admin/rbac/matrix", strings.NewReader(body))
	req.Header.Set(rbacTestForwardHeader, "alice")
	h.UpsertMatrix(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status: got %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
	if got := atomic.LoadInt32(&store.upsertCalled); got != 1 {
		t.Fatalf("UpsertCells called %d times, want 1", got)
	}
	if len(store.upsertCells) != 1 || store.upsertCells[0].RoleID != "reader" ||
		store.upsertCells[0].PermissionID != "fleet.read" || !store.upsertCells[0].Allowed {
		t.Fatalf("cell payload not propagated: %+v", store.upsertCells)
	}
}

func TestRBACHandler_UpsertMatrix_RejectsUnknownPermission(t *testing.T) {
	store := &fakeRBACStore{}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	body := `{"cells":[{"role_id":"reader","permission_id":"bogus.permission","allowed":true}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/admin/rbac/matrix", strings.NewReader(body))
	req.Header.Set(rbacTestForwardHeader, "alice")
	h.UpsertMatrix(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["code"] != RBACCodeInvalidPermission {
		t.Fatalf("code: got %v, want INVALID_PERMISSION", resp["code"])
	}
	if atomic.LoadInt32(&store.upsertCalled) != 0 {
		t.Fatalf("store should NOT receive UpsertCells on validation failure")
	}
}

func TestRBACHandler_UpsertMatrix_RejectsEmptyRoleID(t *testing.T) {
	store := &fakeRBACStore{}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	body := `{"cells":[{"role_id":"  ","permission_id":"fleet.read","allowed":true}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/admin/rbac/matrix", strings.NewReader(body))
	req.Header.Set(rbacTestForwardHeader, "alice")
	h.UpsertMatrix(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["code"] != RBACCodeInvalidRole {
		t.Fatalf("code: got %v, want INVALID_ROLE", resp["code"])
	}
}

func TestRBACHandler_UpsertMatrix_RejectsTooManyCells(t *testing.T) {
	store := &fakeRBACStore{}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	// Build MaxRBACUpsertCells+1 cells; values don't matter.
	var sb strings.Builder
	sb.WriteString(`{"cells":[`)
	for i := 0; i <= MaxRBACUpsertCells; i++ {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(`{"role_id":"reader","permission_id":"fleet.read","allowed":true}`)
	}
	sb.WriteString(`]}`)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/admin/rbac/matrix", strings.NewReader(sb.String()))
	req.Header.Set(rbacTestForwardHeader, "alice")
	h.UpsertMatrix(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["code"] != RBACCodeBadBody {
		t.Fatalf("code: got %v, want INVALID_BODY", resp["code"])
	}
}

func TestRBACHandler_UpsertMatrix_BadJSONReturns400(t *testing.T) {
	store := &fakeRBACStore{}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/admin/rbac/matrix",
		strings.NewReader(`{"cells":[{"role":"x"}]}`)) // unknown field
	req.Header.Set(rbacTestForwardHeader, "alice")
	h.UpsertMatrix(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["code"] != RBACCodeBadBody {
		t.Fatalf("code: got %v, want INVALID_BODY", resp["code"])
	}
}

func TestRBACHandler_UpsertMatrix_EmptyCellsReturns204(t *testing.T) {
	store := &fakeRBACStore{}
	h := newRBACHandler(store, rbacTestForwardHeader, rbacTestGroupsHeader)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/admin/rbac/matrix",
		strings.NewReader(`{"cells":[]}`))
	req.Header.Set(rbacTestForwardHeader, "alice")
	h.UpsertMatrix(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status: got %d, want 204", rec.Code)
	}
	if atomic.LoadInt32(&store.upsertCalled) != 0 {
		t.Fatalf("empty cells must not touch the store")
	}
}
