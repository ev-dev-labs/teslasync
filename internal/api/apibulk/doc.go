// Package apibulk hosts the bulk-endpoint contract that every resource
// handler in internal/api/* shares: the canonical request/response shapes
// (IDsBody, OpBody, OperationResult, FailedID), the MaxIDs cap, the
// sentinel decode errors, and the helper functions that map between
// HTTP body and Go types (DecodeIDsRequest, DecodeOpBody,
// ComputeMissingIDs, DedupeInt64s, WriteBadRequest).
//
// # Layer
//
// Layer: handler
//
// apibulk is shared HANDLER-LAYER infrastructure — it is the bulk-API
// analog of internal/api/apperror. Both are sibling subpackages that
// every resource subpackage (geofence, vehicle, drives, charging, ...)
// is expected to depend on directly, rather than re-exporting them
// through a parent bridge.
//
// # Why it exists
//
// Nine resource handlers (alerts, automations, charging, drives,
// exports, geofences, notifications/push, saved_views, ...) all expose
// bulk endpoints of the shape:
//
//	POST /<resource>/bulk
//	Body: {"ids":[1,2,3]}                       (delete-only resources)
//	Body: {"ids":[1,2,3],"op":"enable"|"delete"} (op-driven resources)
//	Resp: {"deleted":N,"failed":[{"id":X,"reason":"not_found"}]}
//
// The shape MUST stay byte-identical across handlers because the
// frontend dispatches them through a single TanStack Query hook that
// switches on the URL alone, not on the response schema.
//
// Before R2.0f every bulk handler called into a flat parent
// internal/api/bulk_helpers.go. As the Phase R2 wave carves resource
// handlers into subpackages, each handler's bulk endpoint loses access
// to those helpers (subpkg → parent imports would create cycles).
// apibulk lifts the contract into its own subpackage so every resource
// subpackage can import it directly without coupling to the parent.
//
// # Scope
//
// apibulk owns:
//   - The cap (MaxIDs = 500). Per-resource handlers MAY choose a
//     different cap (e.g. notifications.bulkIDsRequest historically
//     allows 1000) and should declare it locally; the cap that lives
//     in apibulk is the canonical default for new endpoints.
//   - The wire shapes (IDsBody, OpBody, OperationResult, FailedID).
//   - The sentinel decode errors (ErrBodyInvalid, ErrIDsEmpty,
//     ErrIDsTooMany) so handlers can map them to 400 responses without
//     parsing the human-readable detail.
//   - The pure helpers (ComputeMissingIDs, DedupeInt64s).
//   - The HTTP-coupled helpers (DecodeIDsRequest, DecodeOpBody,
//     WriteBadRequest).
//
// apibulk deliberately does NOT own:
//   - Audit logging (logAuditFromRequest). That belongs to a future
//     apiaudit carve because most non-bulk handlers also audit.
//   - Per-resource bulk repos (driveBulkStore, geofenceBulkStore,
//     etc). Those are the resource subpackage's concern — apibulk
//     has no business knowing what a drive or geofence is.
//   - The bulk *handler methods* themselves. Each resource subpackage
//     owns its own BulkUpdate(...) method/handler, parameterized by
//     the per-resource store.
//
// # Bridge in the parent
//
// internal/api/bulk_helpers.go remains as a thin BRIDGE to apibulk
// (type aliases for the wire shapes, const alias for MaxIDs, var
// bridges for the sentinel errors, one-line wrapper functions for
// the helpers). Existing parent-package handlers and tests keep
// compiling against MaxBulkIDs / bulkOperationResult / etc. without
// any per-call-site edits. The bridge can be deleted at the end of
// Phase R2 once every bulk handler lives in a resource subpackage.
//
// # Wire-shape contract
//
// All bulk endpoints respond with a FLAT JSON object. The frontend
// (web/src/api/hooks/useBulkActions.ts) reads .deleted, .updated,
// and .failed[].reason without any envelope. Adding fields here is
// breaking — coordinate with frontend.
package apibulk
