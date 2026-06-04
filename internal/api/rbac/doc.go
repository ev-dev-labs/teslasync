// Package rbac serves the admin RBAC matrix endpoints.
//
// Roles are TeslaSync-local group names or existing role_permissions entries;
// permissions come from the internal/auth catalog, not the upstream IdP.
//
// Layer: handler
package rbac
