// Package geofence hosts the HTTP handlers for the /api/v1/geofences
// resource cluster. It owns the CRUD endpoints (List, Create, Get,
// Update, Delete) AND the bulk endpoint (/geofences/bulk → BulkUpdate)
// — both are tightly coupled to the same store (*geofencedb.GeofenceRepo)
// and the same wire shapes, so they live in the same subpackage.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved out of the flat parent internal/api/ in Phase R2b. The carve
// follows the pattern set by R2a (backup) — one subpackage per resource
// cluster — and depends on the shared infrastructure subpackages from
// R2.0d / R2.0e / R2.0f:
//
//   - internal/api/apperror  — typed error catalog (ErrGeofenceNotFound,
//     ErrGeofenceInvalidCoords, ErrInvalidJSON, etc.).
//   - internal/api/apibulk   — bulk-endpoint catalog (DecodeOpBody,
//     OperationResult, ComputeMissingIDs, WriteBadRequest, MaxIDs).
//   - internal/api/apiparams — request-binding helpers (URLParamInt64).
//   - internal/api/httpx     — response-writing helpers (WriteJSON,
//     WriteError).
//
// # Scope
//
// In-scope (lives here):
//   - geofenceCreateRequest, coalesceGeofenceRequestSpellings,
//     circleToPolygonWKT, geofenceCircleSegments, decodeGeofenceWriteBody,
//     validateGeofence — request parsing + validation.
//   - Handler (CRUD: List/Create/Get/Update/Delete).
//   - BulkStore interface + BulkUpdate method.
//   - Option / NewHandler with WithBulkStore + WithAuditFunc.
//
// Out-of-scope (still in parent):
//   - The AI-suggest-new-geofences handler cluster
//     (ai_suggest_new_geofences_*) which has its own
//     AISuggestGeofenceValidator that byte-equivalently mirrors
//     validateGeofence. Coupling that cluster into this subpackage
//     would mean importing the AI cluster's signal-store + suggestion
//     pipeline; instead the AI cluster keeps its local copy and stays
//     in parent until R2e (AI cluster carve).
//   - logAuditFromRequest itself — still in parent's audit.go until a
//     future apiaudit carve. This subpackage receives an AuditFunc
//     callback at construction time so it can audit bulk_delete events
//     without importing the parent.
//
// # Test-time substitution
//
// The Handler's bulk store is injected via WithBulkStore(s BulkStore)
// — there is NO exported test-only field. Production code calls
// NewHandler(db) and lets the constructor wire *geofencedb.GeofenceRepo
// as both the CRUD repo and the bulk store. Tests call
// NewHandler(nil, WithBulkStore(fake)).
package geofence
