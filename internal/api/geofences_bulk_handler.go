package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
)

// geofenceBulkStore is the narrow surface needed by the geofence bulk
// endpoint; implemented by *geofencedb.GeofenceRepo and substitutable in tests
// via the handler's bulkOverride field.
type geofenceBulkStore interface {
	FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error)
	BulkDelete(ctx context.Context, ids []int64) (int64, error)
}

func (h *GeofenceHandler) geofenceBulkRepo() geofenceBulkStore {
	if h.bulkOverride != nil {
		return h.bulkOverride
	}
	if h.geofenceRepo == nil {
		return nil
	}
	return h.geofenceRepo
}

// BulkUpdate runs an allowlisted bulk operation across multiple geofences.
//
// Phase-45 / Prompt 32 — bulk-actions framework. Currently only `op=delete`
// is supported; future ops (e.g. category re-tag) plug into the same switch
// without changing the request shape.
//
// Contract mirrors the other bulk handlers:
//   - Body: {"ids":[1,2,3],"op":"delete"}.
//   - Empty / over-cap / unknown op → 400.
//   - Response: {"deleted": N, "failed": [{"id":X,"reason":"not_found"}]}.
func (h *GeofenceHandler) BulkUpdate(w http.ResponseWriter, r *http.Request) {
	store := h.geofenceBulkRepo()
	if store == nil {
		writeError(w, http.StatusServiceUnavailable, "bulk geofence operations not configured")
		return
	}

	body, err := decodeAutomationBulkBody(r)
	if err != nil {
		writeBulkBadRequest(w, err)
		return
	}

	existing, err := store.FilterExistingIDs(r.Context(), body.IDs)
	if err != nil {
		log.Error().Err(err).Msg("bulk geofences: filter existing ids")
		writeError(w, http.StatusInternalServerError, "failed to validate geofences for bulk update")
		return
	}
	failed := computeMissingIDs(body.IDs, existing)

	switch body.Op {
	case "delete":
		deleted, err := store.BulkDelete(r.Context(), existing)
		if err != nil {
			log.Error().Err(err).Msg("bulk geofences: delete")
			writeError(w, http.StatusInternalServerError, "failed to bulk delete geofences")
			return
		}
		if h.db != nil {
			logAuditFromRequest(h.db, r, "", "bulk_delete", "geofence", nil,
				fmt.Sprintf("bulk_delete count=%d failed=%d", deleted, len(failed)))
		}
		writeJSON(w, http.StatusOK, bulkOperationResult{Deleted: &deleted, Failed: failed})
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown op %q; expected delete", body.Op))
	}
}
