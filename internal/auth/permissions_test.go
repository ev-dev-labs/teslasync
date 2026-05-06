// Phase-46 / Prompt 44 — Permissions catalog + role-resolution tests.
//
// Covers the pure helpers in permissions.go:
//   - ParseGroupsHeader: trimming, dedup, sort, empty edge cases
//   - ResolveRequestRoles: header missing/empty/configured paths
//   - EffectivePermissions: union semantics across multiple roles
//   - PermissionByID + AllPermissionIDs: catalog round-trip
package auth

import (
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestParseGroupsHeader_EmptyInput(t *testing.T) {
	if got := ParseGroupsHeader(""); got != nil {
		t.Fatalf("ParseGroupsHeader(\"\") = %v, want nil", got)
	}
	if got := ParseGroupsHeader("   "); len(got) != 0 {
		t.Fatalf("ParseGroupsHeader(whitespace) = %v, want empty", got)
	}
}

func TestParseGroupsHeader_TrimsAndDedupsAndSorts(t *testing.T) {
	got := ParseGroupsHeader("  beta , alpha , beta ,, charlie")
	want := []string{"alpha", "beta", "charlie"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseGroupsHeader = %v, want %v", got, want)
	}
}

func TestResolveRequestRoles_NoHeaderConfigured(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-Groups", "admin,reader")

	roles := ResolveRequestRoles(req, "")
	if !reflect.DeepEqual(roles, []string{DefaultRoleID}) {
		t.Fatalf("with empty groupsHeader, got %v want [%s]", roles, DefaultRoleID)
	}
}

func TestResolveRequestRoles_HeaderPresent(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-Groups", "admin,reader,user")

	roles := ResolveRequestRoles(req, "X-Forwarded-Groups")
	// DefaultRoleID at index 0; "user" forwarded by upstream is
	// suppressed (de-dup against DefaultRoleID); admin + reader
	// follow in sorted order.
	want := []string{DefaultRoleID, "admin", "reader"}
	if !reflect.DeepEqual(roles, want) {
		t.Fatalf("ResolveRequestRoles = %v, want %v", roles, want)
	}
}

func TestResolveRequestRoles_HeaderAbsent(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	roles := ResolveRequestRoles(req, "X-Forwarded-Groups")
	if !reflect.DeepEqual(roles, []string{DefaultRoleID}) {
		t.Fatalf("absent header should yield default only, got %v", roles)
	}
}

func TestEffectivePermissions_UnionAcrossRoles(t *testing.T) {
	matrix := map[string]map[string]bool{
		"reader": {"fleet.read": true, "fleet.export": false},
		"admin":  {"fleet.export": true, "admin.audit": true},
	}
	got := EffectivePermissions([]string{"reader", "admin"}, matrix)

	if !got["fleet.read"] {
		t.Fatalf("fleet.read should be granted via reader")
	}
	if !got["fleet.export"] {
		t.Fatalf("fleet.export should be granted via admin even though reader denied")
	}
	if !got["admin.audit"] {
		t.Fatalf("admin.audit should be granted via admin")
	}
	if got["admin.rbac"] {
		t.Fatalf("admin.rbac has no row → should default to false")
	}
}

func TestEffectivePermissions_DefaultsAllToFalse(t *testing.T) {
	got := EffectivePermissions(nil, map[string]map[string]bool{})
	if len(got) != len(AllPermissions) {
		t.Fatalf("missing permissions in result: got %d entries, want %d", len(got), len(AllPermissions))
	}
	for _, p := range AllPermissions {
		if got[p.ID] {
			t.Fatalf("%s should default to false with no roles", p.ID)
		}
	}
}

func TestPermissionByID(t *testing.T) {
	if _, ok := PermissionByID("fleet.read"); !ok {
		t.Fatalf("fleet.read should be a known catalog id")
	}
	if _, ok := PermissionByID("nope.bogus"); ok {
		t.Fatalf("unknown id should NOT round-trip")
	}
}

func TestAllPermissionIDs_MatchesCatalog(t *testing.T) {
	ids := AllPermissionIDs()
	if len(ids) != len(AllPermissions) {
		t.Fatalf("AllPermissionIDs cardinality mismatch: %d vs catalog %d", len(ids), len(AllPermissions))
	}
	for _, p := range AllPermissions {
		if _, ok := ids[p.ID]; !ok {
			t.Fatalf("missing %q in AllPermissionIDs", p.ID)
		}
	}
}

func TestAllPermissionCategories_NonEmpty(t *testing.T) {
	if len(AllPermissionCategories) == 0 {
		t.Fatalf("AllPermissionCategories should not be empty")
	}
	known := make(map[PermissionCategory]struct{}, len(AllPermissionCategories))
	for _, c := range AllPermissionCategories {
		known[c] = struct{}{}
	}
	for _, p := range AllPermissions {
		if _, ok := known[p.Category]; !ok {
			t.Fatalf("permission %q has uncategorized %q (not in AllPermissionCategories)", p.ID, p.Category)
		}
	}
}
