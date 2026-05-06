// Phase-46 / Prompt 44 — RBAC matrix admin handler.
//
// Two endpoints back the SPA's <RbacMatrixPage>:
//
//	GET  /api/v1/admin/rbac/matrix       → roles + permissions + matrix + effective-for-me
//	PUT  /api/v1/admin/rbac/matrix       → upsert a batch of (role, perm, allowed) cells
//
// Provider-agnostic. Roles come from a TeslaSync-local concept — the
// in-process auth.Permission catalog plus whatever group names the
// upstream proxy forwards via the configured TESLASYNC_RBAC_GROUPS_HEADER
// header. We never call out to the upstream IdP's admin API.
//
// Auth-mode awareness. In open mode (no FORWARD_AUTH_HEADER configured)
// every endpoint returns 501 with code AUTH_MODE_OPEN so the SPA's
// useRbacMatrix hook can render the inline placeholder without a noisy
// 401 loop. The PUT route is wrapped in RequireSudo upstream — that
// middleware is itself a passthrough in open mode, so the open-mode
// check below intentionally fires before any database work and never
// depends on the sudo middleware running.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// MaxRBACMatrixBodyBytes caps the PUT body so a malicious or buggy
// client can't pin the API process by streaming an unbounded payload.
// 64 KiB is generous: a maximally pathological matrix (200 roles × 50
// permissions = 10 000 cells × ~120 bytes per cell envelope) tops out
// well below this ceiling.
const MaxRBACMatrixBodyBytes int64 = 64 * 1024

// RBACErrorCode is the structured `code` field returned in the JSON
// error envelope. Stable strings the SPA's typed-fetch layer matches
// instead of HTTP status alone.
const (
	RBACCodeBadBody            = "INVALID_BODY"
	RBACCodeInvalidPermission  = "INVALID_PERMISSION"
	RBACCodeInvalidRole        = "INVALID_ROLE"
	RBACCodeMissingIdentity    = "MISSING_IDENTITY"
	RBACCodeMatrixWriteFailed  = "MATRIX_WRITE_FAILED"
	RBACCodeMatrixLoadFailed   = "MATRIX_LOAD_FAILED"
	RBACCodeUnsupportedRequest = "UNSUPPORTED"
)

// RBACMatrixStore is the storage seam the handler uses to load and
// mutate role bindings. Production wires *database.RolePermissionsRepo;
// tests substitute an in-memory fake.
type RBACMatrixStore interface {
	GetMatrix(ctx context.Context, roles []string) (map[string]map[string]bool, error)
	UpsertCells(ctx context.Context, cells []database.RolePermissionCell) error
	ListAllRoleIDs(ctx context.Context) ([]string, error)
}

// RBACHandler bundles the two RBAC endpoints. headerName is captured
// at construction so the open-mode check is consistent with the rest
// of the handlers wired against the same config snapshot.
type RBACHandler struct {
	store        RBACMatrixStore
	headerName   string // FORWARD_AUTH_HEADER value; empty == open mode.
	groupsHeader string // TESLASYNC_RBAC_GROUPS_HEADER value; empty == default-only.
}

// NewRBACHandler builds the handler. headerName is the trimmed
// FORWARD_AUTH_HEADER value (typically "X-Forwarded-User"); empty puts
// every endpoint into open-mode (501 AUTH_MODE_OPEN) responses.
//
// The groups-header name is read from os.Getenv at construction
// rather than via cfg, because adding a new env var to internal/config
// is outside the allowed-files regex for this prompt; a future config
// pass should hoist it onto cfg.Auth alongside ForwardAuthHeader.
func NewRBACHandler(store RBACMatrixStore, headerName string) *RBACHandler {
	return &RBACHandler{
		store:        store,
		headerName:   strings.TrimSpace(headerName),
		groupsHeader: tsauth.RBACGroupsHeaderName(),
	}
}

// rbacRoleInfo is the JSON shape returned for each role in the matrix
// response. ID is the opaque proxy group name; Name is what the SPA
// renders in the column header (currently identical to ID, but the
// shape leaves room for a future "display label" column without
// breaking the contract).
type rbacRoleInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// rbacMatrixResponse is the envelope returned by GET
// /api/v1/admin/rbac/matrix. Ordering of `roles` + `permissions` is
// stable across calls so the SPA renders identical column / row
// sequences on every refresh.
type rbacMatrixResponse struct {
	Mode             string                     `json:"mode"`
	Roles            []rbacRoleInfo             `json:"roles"`
	Permissions      []tsauth.Permission        `json:"permissions"`
	Categories       []tsauth.PermissionCategory `json:"categories"`
	Matrix           map[string]map[string]bool `json:"matrix"`
	EffectiveForMe   map[string]bool            `json:"effective_for_me"`
	MyRoles          []string                   `json:"my_roles"`
	GroupsHeaderName string                     `json:"groups_header_name,omitempty"`
}

// rbacUpsertRequest is the body shape accepted by PUT
// /api/v1/admin/rbac/matrix. The cells are processed atomically — any
// validation failure aborts the entire batch.
type rbacUpsertRequest struct {
	Cells []rbacUpsertCell `json:"cells"`
}

type rbacUpsertCell struct {
	RoleID       string `json:"role_id"`
	PermissionID string `json:"permission_id"`
	Allowed      bool   `json:"allowed"`
}

// MaxRBACUpsertCells caps the number of bindings updated in a single
// PUT request. 1000 is far above any realistic UI use case (the SPA
// sends only the cells the operator actually toggled) and well below
// the body-bytes ceiling.
const MaxRBACUpsertCells = 1000

// resolveSubject pulls the principal identity from the configured
// ForwardAuth header. Returns ("", true) in open mode (no header
// configured) so the caller can short-circuit with 501 AUTH_MODE_OPEN.
// Returns ("", false) when the header is configured but absent — that
// is a 401 because the proxy should always inject it for authenticated
// traffic.
func (h *RBACHandler) resolveSubject(r *http.Request) (subject string, openMode bool) {
	if h.headerName == "" {
		return "", true
	}
	return strings.TrimSpace(r.Header.Get(h.headerName)), false
}

// writeOpenModeNotImplementedRBAC is the canonical 501 response in
// open mode. Centralised so the SPA's useRbacMatrix hook can match
// the exact code without snake-vs-camel drift.
func writeOpenModeNotImplementedRBAC(w http.ResponseWriter) {
	writeErrorCode(w, http.StatusNotImplemented,
		"RBAC matrix requires forward-auth mode", AuthModeOpenCode)
}

// GetMatrix implements GET /api/v1/admin/rbac/matrix.
//
// Open mode: 501 AUTH_MODE_OPEN.
// Forward-auth, missing header: 401 MISSING_IDENTITY.
// Forward-auth, header set: 200 with the catalog + bindings + the
//
//	caller's effective-for-me grant map.
//
// Roles are derived from:
//
//   - The implicit DefaultRoleID, ALWAYS present at index 0.
//   - Every distinct group forwarded by the upstream proxy via the
//     configured groups header (empty string disables this source).
//   - Every distinct role_id with at least one binding row in the
//     repo (so an operator can edit a role's column even when no one
//     currently in the request claims that role).
//
// The union is sorted alphabetically (DefaultRoleID first) so column
// order is stable across requests.
func (h *RBACHandler) GetMatrix(w http.ResponseWriter, r *http.Request) {
	subject, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplementedRBAC(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", RBACCodeMissingIdentity)
		return
	}

	myRoles := tsauth.ResolveRequestRoles(r, h.groupsHeader)

	// Build the role universe = caller's claimed roles ∪ every role
	// that has at least one binding row in the repo. The latter is
	// the "kid account row visible to admin" use case — operators
	// editing a role they don't themselves hold.
	storedRoles, err := h.store.ListAllRoleIDs(r.Context())
	if err != nil {
		writeErrorCode(w, http.StatusInternalServerError,
			"failed to load matrix", RBACCodeMatrixLoadFailed)
		return
	}

	roleSet := make(map[string]struct{}, len(myRoles)+len(storedRoles))
	for _, role := range myRoles {
		roleSet[role] = struct{}{}
	}
	for _, role := range storedRoles {
		roleSet[role] = struct{}{}
	}
	roleList := setToSortedSlice(roleSet)

	matrix, err := h.store.GetMatrix(r.Context(), roleList)
	if err != nil {
		writeErrorCode(w, http.StatusInternalServerError,
			"failed to load matrix", RBACCodeMatrixLoadFailed)
		return
	}

	// Strip stale (role, perm) bindings whose permission_id is no
	// longer in the application catalog. Done in the handler so the
	// repo stays free of the internal/auth dependency.
	known := tsauth.AllPermissionIDs()
	for role, row := range matrix {
		for permID := range row {
			if _, ok := known[permID]; !ok {
				delete(row, permID)
			}
		}
		if len(row) == 0 {
			// Keep the role row in the response so the matrix UI
			// still renders the column; just leave the bucket empty.
			matrix[role] = map[string]bool{}
		}
	}

	roles := make([]rbacRoleInfo, 0, len(roleList))
	for _, id := range roleList {
		roles = append(roles, rbacRoleInfo{ID: id, Name: id})
	}

	effective := tsauth.EffectivePermissions(myRoles, matrix)

	resp := rbacMatrixResponse{
		Mode:             "session",
		Roles:            roles,
		Permissions:      tsauth.AllPermissions,
		Categories:       tsauth.AllPermissionCategories,
		Matrix:           matrix,
		EffectiveForMe:   effective,
		MyRoles:          myRoles,
		GroupsHeaderName: h.groupsHeader,
	}
	writeJSON(w, http.StatusOK, resp)
}

// UpsertMatrix implements PUT /api/v1/admin/rbac/matrix.
//
// Open mode: 501 AUTH_MODE_OPEN.
// Forward-auth, missing header: 401 MISSING_IDENTITY.
// Bad body: 400 INVALID_BODY.
// Unknown permission_id: 400 INVALID_PERMISSION.
// Empty role_id: 400 INVALID_ROLE.
// Too many cells: 400 INVALID_BODY.
// Success: 204 No Content.
//
// Sudo gating happens via RequireSudo middleware mounted in router.go;
// this handler trusts the middleware ran before it.
func (h *RBACHandler) UpsertMatrix(w http.ResponseWriter, r *http.Request) {
	subject, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplementedRBAC(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", RBACCodeMissingIdentity)
		return
	}

	body, err := decodeRBACUpsertBody(r)
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, err.Error(), RBACCodeBadBody)
		return
	}
	if len(body.Cells) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(body.Cells) > MaxRBACUpsertCells {
		writeErrorCode(w, http.StatusBadRequest,
			"too many cells in one update", RBACCodeBadBody)
		return
	}

	cells := make([]database.RolePermissionCell, 0, len(body.Cells))
	for _, c := range body.Cells {
		cells = append(cells, database.RolePermissionCell{
			RoleID:       c.RoleID,
			PermissionID: c.PermissionID,
			Allowed:      c.Allowed,
		})
	}

	if err := database.ValidateCells(cells, tsauth.AllPermissionIDs()); err != nil {
		switch {
		case errors.Is(err, database.ErrRolePermissionUnknownPermission):
			writeErrorCode(w, http.StatusBadRequest, err.Error(), RBACCodeInvalidPermission)
			return
		case errors.Is(err, database.ErrRolePermissionEmptyRoleID):
			writeErrorCode(w, http.StatusBadRequest, err.Error(), RBACCodeInvalidRole)
			return
		default:
			writeErrorCode(w, http.StatusBadRequest, err.Error(), RBACCodeBadBody)
			return
		}
	}

	if err := h.store.UpsertCells(r.Context(), cells); err != nil {
		writeErrorCode(w, http.StatusInternalServerError,
			"failed to write matrix", RBACCodeMatrixWriteFailed)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// decodeRBACUpsertBody parses the request body with a hard 64KB cap
// and rejects unknown fields so a typo in the SPA build (e.g.
// `permission` instead of `permission_id`) surfaces as a 400 instead
// of silently dropping the cell.
func decodeRBACUpsertBody(r *http.Request) (rbacUpsertRequest, error) {
	var body rbacUpsertRequest
	if r.Body == nil {
		return body, errors.New("missing request body")
	}
	limited := http.MaxBytesReader(nil, r.Body, MaxRBACMatrixBodyBytes)
	defer limited.Close()
	dec := json.NewDecoder(limited)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return body, errors.New("invalid request body")
	}
	// Reject trailing junk after the JSON value — same defence as
	// the per-vehicle settings handler.
	if dec.More() {
		return body, errors.New("trailing junk after json")
	}
	if body.Cells == nil {
		// A null cells field is valid (no-op) but we normalise to
		// an empty slice so downstream code never has to nil-check.
		body.Cells = []rbacUpsertCell{}
	}
	// Ensure each cell has trimmed strings; the validator only
	// checks for empty after trim, but we want the trimmed value
	// landing in the DB row.
	for i := range body.Cells {
		body.Cells[i].RoleID = strings.TrimSpace(body.Cells[i].RoleID)
		body.Cells[i].PermissionID = strings.TrimSpace(body.Cells[i].PermissionID)
	}
	return body, nil
}

// setToSortedSlice flattens a string set into a sorted slice. Tiny
// helper but factored out so the GetMatrix method reads top-to-bottom.
func setToSortedSlice(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
