package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// MaxBulkIDs caps the size of a single bulk request. Operations that exceed
// this should be paginated client-side; staying synchronous keeps the
// transaction short and avoids long-running locks (Phase-40 / Prompt 51).
const MaxBulkIDs = 500

// bulkIDsRequest is the canonical request body shape for bulk endpoints
// added by Phase-40 / Prompt 51 (drives, charging sessions, alert rules).
//
// Note: the legacy notification bulk endpoints declare a separate
// `bulkIDsRequest` in notification_handler.go for back-compat (they cap at
// 1000 and return only `{updated|deleted}`). The new endpoints standardize
// on the contract documented below — see `bulkOperationResult`.
type bulkIDsBody struct {
	IDs []int64 `json:"ids"`
}

// bulkFailedID encodes per-id failure context. `Reason` is a stable string
// (e.g. "not_found", "forbidden") that callers can switch on without parsing
// human-readable detail.
type bulkFailedID struct {
	ID     int64  `json:"id"`
	Reason string `json:"reason"`
}

// bulkOperationResult is the canonical response shape for the new bulk
// endpoints. Exactly one of Deleted / Updated is populated to match the
// caller's verb.
type bulkOperationResult struct {
	Deleted *int64         `json:"deleted,omitempty"`
	Updated *int64         `json:"updated,omitempty"`
	Failed  []bulkFailedID `json:"failed"`
}

// decodeBulkIDsRequest reads a JSON body of the shape `{"ids":[1,2,3]}` and
// validates the cap. Returns a deduplicated slice of ids.
//
// Errors are pre-categorized so the caller can map them to specific HTTP
// status codes:
//   - errBulkBodyInvalid → 400 (JSON parse failure)
//   - errBulkIDsEmpty    → 400 (zero-length list)
//   - errBulkIDsTooMany  → 400 (over MaxBulkIDs)
var (
	errBulkBodyInvalid = errors.New("invalid request body: expected {\"ids\":[...]}")
	errBulkIDsEmpty    = errors.New("ids must be a non-empty array")
	errBulkIDsTooMany  = fmt.Errorf("ids exceeds %d cap", MaxBulkIDs)
)

func decodeBulkIDsRequest(r *http.Request) ([]int64, error) {
	var body bulkIDsBody
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return nil, errBulkBodyInvalid
	}
	if len(body.IDs) == 0 {
		return nil, errBulkIDsEmpty
	}
	if len(body.IDs) > MaxBulkIDs {
		return nil, errBulkIDsTooMany
	}
	return dedupeInt64s(body.IDs), nil
}

// dedupeInt64s returns a new slice with duplicates removed, preserving
// first-seen order. Used so a caller passing the same id twice doesn't
// inflate the affected-row count (which would mismatch the failed[] pairing).
func dedupeInt64s(in []int64) []int64 {
	if len(in) <= 1 {
		return in
	}
	seen := make(map[int64]struct{}, len(in))
	out := make([]int64, 0, len(in))
	for _, id := range in {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// computeMissingIDs returns ids that appear in `requested` but not in
// `existing`. Used to build the `failed: [{id, "not_found"}]` slice without
// caring about input order.
func computeMissingIDs(requested, existing []int64) []bulkFailedID {
	if len(requested) == 0 {
		return []bulkFailedID{}
	}
	have := make(map[int64]struct{}, len(existing))
	for _, id := range existing {
		have[id] = struct{}{}
	}
	missing := make([]bulkFailedID, 0)
	for _, id := range requested {
		if _, ok := have[id]; ok {
			continue
		}
		missing = append(missing, bulkFailedID{ID: id, Reason: "not_found"})
	}
	return missing
}

// writeBulkBadRequest maps the sentinel decode errors to a writeError call.
// Callers should `return` after invoking this.
func writeBulkBadRequest(w http.ResponseWriter, err error) {
	writeError(w, http.StatusBadRequest, err.Error())
}
