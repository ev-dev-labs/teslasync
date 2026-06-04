// Package auth defines the permission catalog and role-resolution helpers.
//
// This file is the single source of truth for the application-level
// permission catalog the RBAC matrix admin page renders. Adding a new
// permission is a two-file change:
//
//  1. Append a Permission{ID, Name, Category} to AllPermissions below
//  2. Reference its constant ID from the handler / service that
//     wants to gate on it
//
// The catalog is deliberately a hand-maintained slice rather than a
// database table because:
//
//   - The set is a property of the deployed binary, not operator data
//   - Migrations + grep-friendliness > runtime configurability
//   - A typo in the ID flags at compile time, not as a silent miss
//
// PROVIDER-AGNOSTIC ROLE MODEL
// ----------------------------
// TeslaSync does not own a users / roles registry. When the install is
// in forward-auth mode, the upstream proxy may forward role/group
// claims via an additional header (e.g. X-Forwarded-Groups for
// Authentik / Authelia, X-Auth-Groups for oauth2-proxy). The header
// name is configured via the TESLASYNC_RBAC_GROUPS_HEADER environment
// variable; the value is split on commas and each token is treated as
// an opaque role id.
//
// In open mode (no FORWARD_AUTH_HEADER, no groups header) only the
// implicit "user" role exists and the matrix endpoint returns 501
// AUTH_MODE_OPEN — there are no per-subject claims to authorise
// against, so the matrix is meaningless and the SPA renders an inline
// placeholder explaining the auth-mode requirement.
package auth

import (
	"net/http"
	"os"
	"sort"
	"strings"
)

// PermissionCategory is the logical grouping displayed as a section
// header in the matrix UI. A small enumerated set keeps the page
// scannable; new categories should be added sparingly.
type PermissionCategory string

const (
	// PermissionCategoryFleet covers everything that touches a vehicle
	// or its data — viewing, exporting, editing.
	PermissionCategoryFleet PermissionCategory = "fleet"
	// PermissionCategoryCommands covers Tesla command dispatch — wake,
	// honk, lock, climate, charging.
	PermissionCategoryCommands PermissionCategory = "commands"
	// PermissionCategoryAutomation covers automation rules + schedules.
	PermissionCategoryAutomation PermissionCategory = "automation"
	// PermissionCategoryNotifications covers alerts + delivery channels.
	PermissionCategoryNotifications PermissionCategory = "notifications"
	// PermissionCategoryAdmin covers operator surfaces — backups,
	// API keys, audit, settings, RBAC itself.
	PermissionCategoryAdmin PermissionCategory = "admin"
)

// AllPermissionCategories is the canonical render order for the
// matrix UI's section headers.
var AllPermissionCategories = []PermissionCategory{
	PermissionCategoryFleet,
	PermissionCategoryCommands,
	PermissionCategoryAutomation,
	PermissionCategoryNotifications,
	PermissionCategoryAdmin,
}

// Permission is a single capability the operator can grant or deny per
// role. ID MUST be a stable, lowercase, dotted string; the database
// row keys on it, so a renamed permission orphans existing bindings
// (callers will see the cell snap back to "no opinion → false").
type Permission struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Category PermissionCategory `json:"category"`
}

// AllPermissions is the hand-maintained catalog. The order here is
// preserved by the matrix endpoint so the SPA renders rows in the
// same sequence operators saw in any prior session.
//
// IDs are namespaced by category (fleet.*, commands.*, …) so a quick
// `grep -r '"fleet.read"'` finds every gate that consumes a
// permission. Names are short imperative phrases ("View vehicles",
// "Send commands") so the matrix grid stays scannable.
var AllPermissions = []Permission{
	// Fleet
	{ID: "fleet.read", Name: "View vehicles & telemetry", Category: PermissionCategoryFleet},
	{ID: "fleet.export", Name: "Export drives & charging history", Category: PermissionCategoryFleet},
	{ID: "fleet.edit", Name: "Edit drives, charges & locations", Category: PermissionCategoryFleet},
	{ID: "fleet.delete", Name: "Delete vehicles & sessions", Category: PermissionCategoryFleet},
	// Commands
	{ID: "commands.read", Name: "View command history", Category: PermissionCategoryCommands},
	{ID: "commands.send", Name: "Send Tesla commands (wake, lock, honk)", Category: PermissionCategoryCommands},
	{ID: "commands.charging", Name: "Start / stop charging", Category: PermissionCategoryCommands},
	{ID: "commands.climate", Name: "Set climate preconditioning", Category: PermissionCategoryCommands},
	// Automation
	{ID: "automation.read", Name: "View automations", Category: PermissionCategoryAutomation},
	{ID: "automation.edit", Name: "Create & edit automations", Category: PermissionCategoryAutomation},
	{ID: "automation.run", Name: "Trigger automations manually", Category: PermissionCategoryAutomation},
	// Notifications
	{ID: "notifications.read", Name: "View notifications & rules", Category: PermissionCategoryNotifications},
	{ID: "notifications.edit", Name: "Create & edit alert rules", Category: PermissionCategoryNotifications},
	{ID: "notifications.channels", Name: "Manage notification channels", Category: PermissionCategoryNotifications},
	// Admin
	{ID: "admin.settings", Name: "Edit install-wide settings", Category: PermissionCategoryAdmin},
	{ID: "admin.api_keys", Name: "Manage API keys", Category: PermissionCategoryAdmin},
	{ID: "admin.backup", Name: "Run backups & restores", Category: PermissionCategoryAdmin},
	{ID: "admin.audit", Name: "View audit log", Category: PermissionCategoryAdmin},
	{ID: "admin.rbac", Name: "Edit RBAC matrix", Category: PermissionCategoryAdmin},
	{ID: "admin.users", Name: "View active sessions & devices", Category: PermissionCategoryAdmin},
}

// AllPermissionIDs returns the set of catalog IDs as a Go set. The
// repo uses this to filter out unknown permission_ids on read so a
// rolled-back deploy doesn't leak orphan rows into the response.
func AllPermissionIDs() map[string]struct{} {
	out := make(map[string]struct{}, len(AllPermissions))
	for _, p := range AllPermissions {
		out[p.ID] = struct{}{}
	}
	return out
}

// PermissionByID returns the catalog entry for id and true when found.
// Used by the handler to validate every PUT body against the catalog
// before touching the repo — an unknown id is a 400, not a silent
// upsert that creates dead rows.
func PermissionByID(id string) (Permission, bool) {
	for _, p := range AllPermissions {
		if p.ID == id {
			return p, true
		}
	}
	return Permission{}, false
}

// RBACGroupsHeaderEnv is the environment variable name carrying the
// HTTP header that holds comma-separated group/role claims for the
// authenticated subject. Empty means "no role claims forwarded — the
// matrix endpoint reports the implicit default role only".
const RBACGroupsHeaderEnv = "TESLASYNC_RBAC_GROUPS_HEADER"

// DefaultRoleID is the role assigned to every authenticated subject
// when no groups header is configured (or the header is absent on a
// given request). The matrix endpoint always reports this role row
// even when role_permissions has no DefaultRoleID rows so the SPA can
// always render at least one column.
const DefaultRoleID = "user"

// RBACGroupsHeaderName reads the configured groups-header name from
// the environment. Returns the trimmed value (possibly empty). Kept
// as a function — not a captured constant — so tests can mutate the
// env without churning a global.
func RBACGroupsHeaderName() string {
	return strings.TrimSpace(os.Getenv(RBACGroupsHeaderEnv))
}

// ParseGroupsHeader splits the raw header value into a sorted, de-
// duplicated slice of role ids. Empty tokens (from "a,,b" or "a, ,b")
// are dropped. Whitespace around each token is trimmed.
//
// The result is sorted so the output of the matrix endpoint is
// deterministic across requests; without sort, two requests from the
// same browser could see role columns swap places.
func ParseGroupsHeader(raw string) []string {
	if raw == "" {
		return nil
	}
	seen := make(map[string]struct{})
	var out []string
	for _, tok := range strings.Split(raw, ",") {
		t := strings.TrimSpace(tok)
		if t == "" {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// ResolveRequestRoles returns the list of role ids derivable from r,
// in stable sorted order. Always includes DefaultRoleID at index 0
// when at least one role is present, so the matrix UI can highlight
// the implicit default alongside any forwarded groups. Returns
// {DefaultRoleID} when no groups header is configured OR the request
// header is absent.
func ResolveRequestRoles(r *http.Request, groupsHeader string) []string {
	out := []string{DefaultRoleID}
	if groupsHeader == "" || r == nil {
		return out
	}
	raw := strings.TrimSpace(r.Header.Get(groupsHeader))
	groups := ParseGroupsHeader(raw)
	if len(groups) == 0 {
		return out
	}
	// De-dup against DefaultRoleID so the response doesn't list it
	// twice when an upstream provider happens to forward "user" as a
	// real group name.
	for _, g := range groups {
		if g == DefaultRoleID {
			continue
		}
		out = append(out, g)
	}
	return out
}

// EffectivePermissions computes the merged grant map for a subject
// holding the given roles, against the supplied per-role bindings
// view. A permission resolves to true when ANY role grants it; the
// implicit DefaultRoleID with no bindings grants nothing.
//
// matrix is the same shape returned by RolePermissionsRepo.GetMatrix:
// matrix[roleID][permID] = allowed. Roles missing from the matrix
// are treated as "no opinion" (no grants).
func EffectivePermissions(roles []string, matrix map[string]map[string]bool) map[string]bool {
	out := make(map[string]bool, len(AllPermissions))
	for _, p := range AllPermissions {
		out[p.ID] = false
	}
	for _, role := range roles {
		row, ok := matrix[role]
		if !ok {
			continue
		}
		for permID, allowed := range row {
			if allowed {
				out[permID] = true
			}
		}
	}
	return out
}
