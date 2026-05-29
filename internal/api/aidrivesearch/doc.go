// Package aidrivesearch hosts the natural-language drive search and replay AI handler.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// This package isolates the nl-drive-search-replay HTTP surface and its drive
// replay hydrator from the flat internal/api parent. The package
// depends only on AI orchestration primitives, shared API infrastructure, and the
// search subpackage; it MUST NOT import its parent api package.
//
// # Scope
//
// In-scope (lives here):
//   - Handler for POST /api/v1/ai/drives/search.
//   - NewHandler constructor used by router wiring.
//   - Drive replay hydrator used by trip.RegisterDriveSearchTools.
//
// Out-of-scope (remains in parent api): AIHandlers aggregation and route
// registration in ai_routes.go.
package aidrivesearch
