package api

import (
	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
)

// This file is the parent-side bridge to internal/api/apibulk (Phase R2.0f).
// It keeps legacy parent bulk handlers compiling during the resource-package
// carve; new or moved handlers must import apibulk directly. Delete this bridge
// once every bulk handler lives in a resource subpackage.

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

// dedupeInt64s is a 1-line wrapper around apibulk.DedupeInt64s.
func dedupeInt64s(in []int64) []int64 {
	return apibulk.DedupeInt64s(in)
}

// computeMissingIDs is a 1-line wrapper around apibulk.ComputeMissingIDs.
func computeMissingIDs(requested, existing []int64) []bulkFailedID {
	return apibulk.ComputeMissingIDs(requested, existing)
}
