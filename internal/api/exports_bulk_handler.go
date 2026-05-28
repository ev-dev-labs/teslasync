package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
)

// MaxBulkExportIDs caps the size of a single export-bulk request. Lower than
// the default int64 MaxBulkIDs because export-job ids are UUID strings and
// the typical user backlog is bounded — 200 is enough to wipe months of
// stale jobs in one shot without holding a long transaction.
const MaxBulkExportIDs = 200

// exportBulkStore is the narrow surface needed by the export bulk endpoint;
// implemented by *exportdb.ExportJobRepo and substitutable in tests.
type exportBulkStore interface {
	FilterExistingStringIDs(ctx context.Context, ids []string) ([]string, error)
	BulkDeleteByIDs(ctx context.Context, ids []string) (int64, error)
}

func (h *ExportHandler) exportBulkRepo() exportBulkStore {
	if h.bulkOverride != nil {
		return h.bulkOverride
	}
	if h.jobRepo == nil {
		return nil
	}
	return h.jobRepo
}

// exportBulkBody is the request shape for /export/jobs/bulk.
//   - `ids` is a non-empty array of export-job UUIDs.
//   - `op`  is restricted to the single allowlisted value `delete` for now.
type exportBulkBody struct {
	IDs []string `json:"ids"`
	Op  string   `json:"op"`
}

// Sentinel errors mapped to HTTP 400 by writeBulkBadRequest.
var (
	errExportBulkBodyInvalid = errors.New(`invalid request body: expected {"ids":[...],"op":"..."}`)
	errExportBulkIDsEmpty    = errors.New("ids must be a non-empty array of export-job UUIDs")
	errExportBulkIDsTooMany  = fmt.Errorf("ids exceeds %d cap", MaxBulkExportIDs)
)

// BulkUpdate runs an allowlisted bulk operation across multiple export jobs.
//
// Phase-45 / Prompt 32 — bulk-actions framework. Currently only `op=delete`
// is supported; the switch is left open so future ops (e.g. archive,
// re-process) plug in without changing the request shape.
//
// Contract:
//   - Body: {"ids":["uuid1","uuid2"],"op":"delete"}.
//   - Empty / over-cap (200) / unknown op → 400.
//   - Response: {"deleted": N, "failed": [{"id":"<uuid>","reason":"not_found"}]}.
func (h *ExportHandler) BulkUpdate(w http.ResponseWriter, r *http.Request) {
	store := h.exportBulkRepo()
	if store == nil {
		writeError(w, http.StatusServiceUnavailable, "bulk export operations not configured")
		return
	}

	body, err := decodeExportBulkBody(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	existing, err := store.FilterExistingStringIDs(r.Context(), body.IDs)
	if err != nil {
		log.Error().Err(err).Msg("bulk exports: filter existing ids")
		writeError(w, http.StatusInternalServerError, "failed to validate exports for bulk update")
		return
	}
	failed := computeMissingStringIDs(body.IDs, existing)

	switch body.Op {
	case "delete":
		deleted, err := store.BulkDeleteByIDs(r.Context(), existing)
		if err != nil {
			log.Error().Err(err).Msg("bulk exports: delete")
			writeError(w, http.StatusInternalServerError, "failed to bulk delete exports")
			return
		}
		if h.db != nil {
			logAuditFromRequest(h.db, r, "", "bulk_delete", "export_job", nil,
				fmt.Sprintf("bulk_delete count=%d failed=%d", deleted, len(failed)))
		}
		writeJSON(w, http.StatusOK, exportBulkResult{Deleted: &deleted, Failed: failed})
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown op %q; expected delete", body.Op))
	}
}

// exportBulkResult mirrors bulkOperationResult but uses string ids in the
// `failed` slice so callers can correlate against UUID-style export-job ids.
type exportBulkResult struct {
	Deleted *int64               `json:"deleted,omitempty"`
	Failed  []exportBulkFailedID `json:"failed"`
}

type exportBulkFailedID struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

func decodeExportBulkBody(r *http.Request) (exportBulkBody, error) {
	var body exportBulkBody
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return exportBulkBody{}, errExportBulkBodyInvalid
	}
	if len(body.IDs) == 0 {
		return exportBulkBody{}, errExportBulkIDsEmpty
	}
	if len(body.IDs) > MaxBulkExportIDs {
		return exportBulkBody{}, errExportBulkIDsTooMany
	}
	body.IDs = dedupeStrings(body.IDs)
	return body, nil
}

func dedupeStrings(in []string) []string {
	if len(in) <= 1 {
		return in
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, id := range in {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func computeMissingStringIDs(requested, existing []string) []exportBulkFailedID {
	if len(requested) == 0 {
		return []exportBulkFailedID{}
	}
	have := make(map[string]struct{}, len(existing))
	for _, id := range existing {
		have[id] = struct{}{}
	}
	missing := make([]exportBulkFailedID, 0)
	for _, id := range requested {
		if _, ok := have[id]; ok {
			continue
		}
		missing = append(missing, exportBulkFailedID{ID: id, Reason: "not_found"})
	}
	return missing
}
