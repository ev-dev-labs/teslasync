// Package rbac serves the admin RBAC matrix endpoints for inspecting
// and updating TeslaSync-local role permission bindings.
//
// It backs:
//
//	GET /api/v1/admin/rbac/matrix
//	PUT /api/v1/admin/rbac/matrix
//
// The handler is provider-agnostic: roles are local group names supplied
// by forward-auth headers plus role IDs already present in the
// role_permissions table, while permissions come from the internal/auth
// catalog.
//
// Layer: handler
package rbac
