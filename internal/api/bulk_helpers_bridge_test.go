package api

import (
	"errors"
	"reflect"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
)

// This file pins the parent-package bridge in internal/api/bulk_helpers.go
// to the canonical implementations in internal/api/apibulk. The bridge is
// Phase R2.0f's mechanism for keeping ~9 in-parent bulk handlers compiling
// against the historic symbols (MaxBulkIDs, bulkOperationResult,
// decodeBulkIDsRequest, ...) without per-call-site edits during the R2
// wave's incremental resource-handler carve.
//
// If any test in this file fails, the bridge has drifted from apibulk
// and consumers of the parent symbols may see surprising behaviour.
// Fix the drift in bulk_helpers.go — do not change the assertions here.

func TestBulkBridge_ConstAlias_MaxBulkIDs(t *testing.T) {
	if MaxBulkIDs != apibulk.MaxIDs {
		t.Fatalf("MaxBulkIDs = %d, want apibulk.MaxIDs = %d (alias drift)",
			MaxBulkIDs, apibulk.MaxIDs)
	}
}

func TestBulkBridge_TypeAliases_AreIdentical(t *testing.T) {
	// Go true type aliases share the same reflect.Type. If the bridge ever
	// declares these as distinct types (`type bulkFailedID struct{...}`
	// instead of `type bulkFailedID = apibulk.FailedID`), reflect.TypeOf
	// would return different Types and code passing parent values to
	// apibulk-typed parameters would stop compiling.
	cases := []struct {
		name   string
		parent any
		canon  any
	}{
		{"bulkIDsBody", bulkIDsBody{}, apibulk.IDsBody{}},
		{"bulkFailedID", bulkFailedID{}, apibulk.FailedID{}},
		{"bulkOperationResult", bulkOperationResult{}, apibulk.OperationResult{}},
		{"automationBulkBody", automationBulkBody{}, apibulk.OpBody{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if reflect.TypeOf(c.parent) != reflect.TypeOf(c.canon) {
				t.Fatalf("%s: parent type %v != canonical %v (alias became distinct type)",
					c.name, reflect.TypeOf(c.parent), reflect.TypeOf(c.canon))
			}
		})
	}
}

func TestBulkBridge_SentinelVars_PointToCanonical(t *testing.T) {
	// Var bridges are NOT true aliases — they are independent vars
	// initially pointing to the same value. errors.Is is the right
	// comparison: it returns true for identical error values (==) and
	// would survive even if the canonical value were wrapped, but here
	// we want the strict reference-equality guarantee that the bridge
	// has not silently substituted its own sentinel.
	cases := []struct {
		name   string
		parent error
		canon  error
	}{
		{"errBulkBodyInvalid", errBulkBodyInvalid, apibulk.ErrBodyInvalid},
		{"errBulkIDsEmpty", errBulkIDsEmpty, apibulk.ErrIDsEmpty},
		{"errBulkIDsTooMany", errBulkIDsTooMany, apibulk.ErrIDsTooMany},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if !errors.Is(c.parent, c.canon) {
				t.Errorf("%s: errors.Is(parent, canonical) = false — bridge silently substituted",
					c.name)
			}
			if c.parent.Error() != c.canon.Error() {
				t.Errorf("%s: msg drift parent=%q canonical=%q",
					c.name, c.parent.Error(), c.canon.Error())
			}
		})
	}
}

func TestBulkBridge_DedupeWrapper_DelegatesToCanonical(t *testing.T) {
	in := []int64{1, 2, 1, 3, 2, 4}
	parent := dedupeInt64s(in)
	canon := apibulk.DedupeInt64s(in)
	if !reflect.DeepEqual(parent, canon) {
		t.Fatalf("dedupe drift: parent=%v canonical=%v", parent, canon)
	}
}

func TestBulkBridge_ComputeMissingIDsWrapper_DelegatesToCanonical(t *testing.T) {
	parent := computeMissingIDs([]int64{1, 2, 3}, []int64{2})
	canon := apibulk.ComputeMissingIDs([]int64{1, 2, 3}, []int64{2})
	if !reflect.DeepEqual(parent, canon) {
		t.Fatalf("missing-ids drift: parent=%v canonical=%v", parent, canon)
	}
	// Wrapper return type is the bridge alias — assert it converts to
	// the canonical slice without copying.
	var asCanonical []apibulk.FailedID = parent
	if !reflect.DeepEqual(asCanonical, canon) {
		t.Errorf("bridge-aliased return not assignable to canonical slice")
	}
}
