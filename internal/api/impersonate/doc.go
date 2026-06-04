// Package impersonate serves the admin impersonation endpoints under
// /api/v1/admin/impersonate. It owns forward-auth mode checks,
// impersonation cookie start/end orchestration, candidate listing, and
// audit row writes for the SPA impersonation flow.
//
// Layer: handler
package impersonate
