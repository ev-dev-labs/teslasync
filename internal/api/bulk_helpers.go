package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
)

// This file is the parent-side BRIDGE to internal/api/apibulk (Phase R2.0f).
//
// Every symbol declared here re-exports the canonical apibulk equivalent
// using Go's native type/const/var alias machinery, plus 1-line wrapper
// functions for the helpers. The bridge exists so that the ~9 parent-
// package bulk handlers (alerts, automations, charging, drives,
// exports, geofences/bulk, push, saved_views, ...) keep compiling
// against `MaxBulkIDs`, `bulkOperationResult`, `decodeBulkIDsRequest`,
// etc. without per-call-site edits while the Phase R2 wave carves
// resource handlers into subpackages one by one.
//
// New handlers — and any handler being moved into a resource
// subpackage — MUST import `internal/api/apibulk` and call its
// exported API directly. Adding new callers of the wrappers here
// extends the bridge's lifetime unnecessarily.
//
// Deletion of this bridge is gated on every bulk handler living in a
// resource subpackage at the end of Phase R2.

// MaxBulkIDs is a TRUE const alias for apibulk.MaxIDs. New code should
// reference apibulk.MaxIDs directly.
const MaxBulkIDs = apibulk.MaxIDs

// Type aliases (TRUE Go aliases — identical underlying type, no
// distinct method set, struct-literal interchangeable).
type (
	bulkIDsBody         = apibulk.IDsBody
	bulkFailedID        = apibulk.FailedID
	bulkOperationResult = apibulk.OperationResult
	automationBulkBody  = apibulk.OpBody
)

// Sentinel error var bridges. These are NOT true Go aliases — they are
// independent vars initially pointing to the same error value. Treat
// as read-only; tests must not reassign these vars from parent code.
var (
	errBulkBodyInvalid = apibulk.ErrBodyInvalid
	errBulkIDsEmpty    = apibulk.ErrIDsEmpty
	errBulkIDsTooMany  = apibulk.ErrIDsTooMany
)

// decodeBulkIDsRequest is a 1-line wrapper around apibulk.DecodeIDsRequest.
func decodeBulkIDsRequest(r *http.Request) ([]int64, error) {
	return apibulk.DecodeIDsRequest(r)
}

// decodeAutomationBulkBody is a 1-line wrapper around apibulk.DecodeOpBody.
// The historic parent name is retained for the bridge era; new code
// should call apibulk.DecodeOpBody directly.
func decodeAutomationBulkBody(r *http.Request) (automationBulkBody, error) {
	return apibulk.DecodeOpBody(r)
}

// dedupeInt64s is a 1-line wrapper around apibulk.DedupeInt64s.
func dedupeInt64s(in []int64) []int64 {
	return apibulk.DedupeInt64s(in)
}

// computeMissingIDs is a 1-line wrapper around apibulk.ComputeMissingIDs.
func computeMissingIDs(requested, existing []int64) []bulkFailedID {
	return apibulk.ComputeMissingIDs(requested, existing)
}

// writeBulkBadRequest is a 1-line wrapper around apibulk.WriteBadRequest.
func writeBulkBadRequest(w http.ResponseWriter, err error) {
	apibulk.WriteBadRequest(w, err)
}
