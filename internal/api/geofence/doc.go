// Package geofence hosts the CRUD and bulk handlers for /api/v1/geofences.
// The endpoints share one store and wire shape, so they live in one carved-out
// resource subpackage with apperror/apibulk/apiparams/httpx for shared API
// infrastructure.
//
// Layer: handler
//
// The AI geofence-suggestion cluster remains in the parent package until its
// own carve; this package receives an AuditFunc callback instead of importing
// parent audit helpers. Tests substitute the bulk store via WithBulkStore.
package geofence
