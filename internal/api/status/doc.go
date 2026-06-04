// Package status serves the operator-grade /api/v1/status endpoints,
// including the stable status snapshot, component/resource views,
// uptime disclosure, live SSE stream, and incidents CRUD surface.
//
// The package owns only HTTP shape mapping and route handlers; health,
// maintenance, and incident persistence remain in their existing backend
// services and repositories.
//
// Layer: handler
package status
