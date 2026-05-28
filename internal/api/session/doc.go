// Package session serves the active sessions / device-management endpoints.
//
// It owns the provider-agnostic TeslaSync session-binding surface consumed
// by the SPA settings page:
//
//	GET    /api/v1/auth/sessions
//	DELETE /api/v1/auth/sessions/{id}
//	DELETE /api/v1/auth/sessions/all-others
//
// Open-mode responses intentionally use AUTH_MODE_OPEN so clients can render
// the authentication-required placeholder without polling the upstream IdP.
//
// Layer: handler
package session
