package apibulk

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// MaxIDs keeps synchronous bulk transactions short. Resource handlers may use a
// legacy cap, but new endpoints should adopt this default.
const MaxIDs = 500

// IDsBody is the canonical request body for delete-only bulk endpoints
// (alerts, charging, drives). The body must validate as
// `{"ids":[1,2,3]}` — extra fields are rejected by DisallowUnknownFields
// so a typo doesn't silently no-op.
type IDsBody struct {
	IDs []int64 `json:"ids"`
}

// OpBody is the canonical request body for op-driven bulk endpoints
// (automations, geofences). The op field is allowlisted per-resource:
// the apibulk layer only validates that it is present, the resource
// handler decides which op values are legal.
type OpBody struct {
	IDs []int64 `json:"ids"`
	Op  string  `json:"op"`
}

// FailedID encodes per-id failure context. Reason is a stable string
// (e.g. "not_found", "forbidden") that callers can switch on without
// parsing the human-readable detail. The frontend treats unknown reason
// values as opaque "operation failed" messages.
type FailedID struct {
	ID     int64  `json:"id"`
	Reason string `json:"reason"`
}

// OperationResult is the canonical response shape for bulk endpoints.
// Requested is the de-duplicated ID count actually processed. Exactly one of
// Deleted / Updated is populated to match the verb the caller invoked; the
// omitted field is encoded as `omitempty` so the response stays compact.
// Failed is always present (possibly empty) so the frontend can render an
// unconditional "failed: N" badge.
type OperationResult struct {
	Requested int64      `json:"requested"`
	Deleted   *int64     `json:"deleted,omitempty"`
	Updated   *int64     `json:"updated,omitempty"`
	Failed    []FailedID `json:"failed"`
}

// Sentinel errors returned by DecodeIDsRequest / DecodeOpBody. Callers
// map them to HTTP status codes via WriteBadRequest, which preserves
// the human-readable text without leaking JSON parser details.
var (
	ErrBodyInvalid = errors.New(`invalid request body: expected {"ids":[...]}`)
	ErrIDsEmpty    = errors.New("ids must be a non-empty array")
	ErrIDsTooMany  = fmt.Errorf("ids exceeds %d cap", MaxIDs)
)

// DecodeIDsRequest reads `{"ids":[...]}`, validates the cap, and returns
// deduplicated ids. Sentinel errors let callers map failures to HTTP status
// without parsing message text.
func DecodeIDsRequest(r *http.Request) ([]int64, error) {
	var body IDsBody
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return nil, ErrBodyInvalid
	}
	if len(body.IDs) == 0 {
		return nil, ErrIDsEmpty
	}
	if len(body.IDs) > MaxIDs {
		return nil, ErrIDsTooMany
	}
	return DedupeInt64s(body.IDs), nil
}

// DecodeOpBody validates op-driven bulk bodies with the same cap and dedupe
// contract as DecodeIDsRequest. The resource handler allowlists Op values.
func DecodeOpBody(r *http.Request) (OpBody, error) {
	var body OpBody
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return OpBody{}, ErrBodyInvalid
	}
	if len(body.IDs) == 0 {
		return OpBody{}, ErrIDsEmpty
	}
	if len(body.IDs) > MaxIDs {
		return OpBody{}, ErrIDsTooMany
	}
	body.IDs = DedupeInt64s(body.IDs)
	return body, nil
}

// DedupeInt64s returns a new slice with duplicates removed, preserving
// first-seen order. Used so a caller passing the same id twice doesn't
// inflate the affected-row count (which would mismatch the failed[]
// pairing computed by ComputeMissingIDs).
func DedupeInt64s(in []int64) []int64 {
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

// ComputeMissingIDs returns ids that appear in `requested` but not in
// `existing`. Used to build the `failed: [{id, "not_found"}]` slice
// without caring about input order.
//
// The returned slice is non-nil even when no ids are missing so that
// the JSON response always emits `"failed": []` rather than
// `"failed": null` — the frontend assumes the field is always an array.
func ComputeMissingIDs(requested, existing []int64) []FailedID {
	if len(requested) == 0 {
		return []FailedID{}
	}
	have := make(map[int64]struct{}, len(existing))
	for _, id := range existing {
		have[id] = struct{}{}
	}
	missing := make([]FailedID, 0)
	for _, id := range requested {
		if _, ok := have[id]; ok {
			continue
		}
		missing = append(missing, FailedID{ID: id, Reason: "not_found"})
	}
	return missing
}

// ComputeDeleteFailures preserves deterministic request order while
// distinguishing an ID that was absent during preflight from one that changed
// between preflight and DELETE ... RETURNING. The latter is a retry-safe
// conflict, not a misleading "not_found" response.
func ComputeDeleteFailures(requested, existing, deleted []int64) []FailedID {
	if len(requested) == 0 {
		return []FailedID{}
	}
	existingSet := make(map[int64]struct{}, len(existing))
	for _, id := range existing {
		existingSet[id] = struct{}{}
	}
	deletedSet := make(map[int64]struct{}, len(deleted))
	for _, id := range deleted {
		deletedSet[id] = struct{}{}
	}

	failed := make([]FailedID, 0)
	for _, id := range requested {
		if _, found := existingSet[id]; !found {
			failed = append(failed, FailedID{ID: id, Reason: "not_found"})
			continue
		}
		if _, removed := deletedSet[id]; !removed {
			failed = append(failed, FailedID{ID: id, Reason: "conflict"})
		}
	}
	return failed
}

// WriteBadRequest maps the sentinel decode errors to a 400 response in
// the standard flat error envelope. Callers should `return` after
// invoking this. Non-sentinel errors are passed through verbatim — the
// caller is responsible for sanitizing any value that might leak
// internal detail.
func WriteBadRequest(w http.ResponseWriter, err error) {
	httpx.WriteError(w, http.StatusBadRequest, err.Error())
}
