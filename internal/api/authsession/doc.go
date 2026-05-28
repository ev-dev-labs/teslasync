// Package authsession serves the ForwardAuth session-info endpoint
// consumed by the SPA session monitor.
//
// GET /api/v1/auth/session is mounted outside the ForwardAuth-protected
// API subrouter and always returns 200 OK so an expired upstream session
// cannot send the polling hook into an infinite expired-session loop.
//
// Layer: handler
package authsession
