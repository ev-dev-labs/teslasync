// Phase-46 / Prompt 44 — RolePermissionsRepo unit tests.
//
// The repo's queries themselves require a live PostgreSQL connection,
// so DB integration coverage lives in the API handler tests (which use
// an in-memory fake store). These tests cover the parts that are
// pure-Go and easily verifiable without a database round-trip:
//
//   - GetMatrix on an empty role list short-circuits without touching
//     the (nil) pool.
//   - ValidateCells rejects unknown permission ids.
//   - ValidateCells rejects empty role ids.
//   - ValidateCells passes a valid batch.
//   - DeleteRole rejects an empty role id.
//   - UpsertCells with no cells short-circuits.
//
// IMPORTANT — this file deliberately does NOT import internal/auth.
// internal/auth imports internal/database (for AuthSessionsRepo), so
// the same _test.go importing auth would form a cycle inside the
// `go test ./internal/database/...` test binary. Tests stub the
// known-permissions set with a small inline map instead.
package database

import (
	"context"
	"errors"
	"testing"
)

// testKnownPermissions is the inline stand-in for the auth catalog —
// kept tiny on purpose; the breadth of catalog coverage lives in
// internal/auth/permissions_test.go.
var testKnownPermissions = map[string]struct{}{
	"fleet.read":  {},
	"admin.audit": {},
}

func TestRolePermissionsRepo_GetMatrix_EmptyRolesShortCircuits(t *testing.T) {
	repo := NewRolePermissionsRepo(nil) // nil DB intentionally.
	got, err := repo.GetMatrix(context.Background(), nil)
	if err != nil {
		t.Fatalf("GetMatrix(nil) error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty map, got %v", got)
	}
}

func TestRolePermissionsRepo_GetMatrix_NoPoolReturnsError(t *testing.T) {
	repo := NewRolePermissionsRepo(nil)
	_, err := repo.GetMatrix(context.Background(), []string{"admin"})
	if err == nil {
		t.Fatalf("expected error when pool is nil")
	}
}

func TestValidateCells_RejectsUnknownPermission(t *testing.T) {
	cells := []RolePermissionCell{
		{RoleID: "admin", PermissionID: "fleet.read", Allowed: true},
		{RoleID: "admin", PermissionID: "bogus.permission", Allowed: true},
	}
	err := ValidateCells(cells, testKnownPermissions)
	if !errors.Is(err, ErrRolePermissionUnknownPermission) {
		t.Fatalf("err = %v, want ErrRolePermissionUnknownPermission", err)
	}
}

func TestValidateCells_RejectsEmptyRoleID(t *testing.T) {
	cells := []RolePermissionCell{
		{RoleID: "  ", PermissionID: "fleet.read", Allowed: true},
	}
	err := ValidateCells(cells, testKnownPermissions)
	if !errors.Is(err, ErrRolePermissionEmptyRoleID) {
		t.Fatalf("err = %v, want ErrRolePermissionEmptyRoleID", err)
	}
}

func TestValidateCells_PassesForKnownCatalog(t *testing.T) {
	var cells []RolePermissionCell
	for id := range testKnownPermissions {
		cells = append(cells, RolePermissionCell{
			RoleID:       "admin",
			PermissionID: id,
			Allowed:      true,
		})
	}
	if err := ValidateCells(cells, testKnownPermissions); err != nil {
		t.Fatalf("expected entire catalog to validate, got %v", err)
	}
}

func TestRolePermissionsRepo_DeleteRole_RejectsEmpty(t *testing.T) {
	repo := NewRolePermissionsRepo(nil)
	err := repo.DeleteRole(context.Background(), "  ")
	if !errors.Is(err, ErrRolePermissionEmptyRoleID) {
		t.Fatalf("err = %v, want ErrRolePermissionEmptyRoleID", err)
	}
}

func TestRolePermissionsRepo_UpsertCells_EmptySliceShortCircuits(t *testing.T) {
	repo := NewRolePermissionsRepo(nil) // pool nil, but no cells = no DB call.
	if err := repo.UpsertCells(context.Background(), nil); err != nil {
		t.Fatalf("UpsertCells(nil) error: %v", err)
	}
}

func TestRolePermissionsRepo_UpsertCells_RejectsEmptyRoleIDBeforeDB(t *testing.T) {
	repo := NewRolePermissionsRepo(nil)
	cells := []RolePermissionCell{
		{RoleID: "  ", PermissionID: "fleet.read", Allowed: true},
	}
	err := repo.UpsertCells(context.Background(), cells)
	// Empty-roleID guard MUST fire before the nil-pool check.
	if !errors.Is(err, ErrRolePermissionEmptyRoleID) {
		t.Fatalf("err = %v, want ErrRolePermissionEmptyRoleID", err)
	}
}
