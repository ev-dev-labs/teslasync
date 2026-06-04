package geofence

import (
	"context"
	"fmt"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"

	"github.com/rs/zerolog/log"
)

// BulkStore is the narrow surface needed by the geofence bulk endpoint;
// implemented by *geofencedb.GeofenceRepo and substitutable in tests via
// WithBulkStore(...).
type BulkStore interface {
	FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error)
	BulkDelete(ctx context.Context, ids []int64) (int64, error)
}

// BulkUpdate runs an allowlisted bulk operation across multiple geofences.
//
// Bulk-actions framework. Currently only `op=delete`
// is supported; future ops (e.g. category re-tag) plug into the same switch
// without changing the request shape.
//
// Contract mirrors the other bulk handlers:
//   - Body: {"ids":[1,2,3],"op":"delete"}.
//   - Empty / over-cap / unknown op → 400.
//   - Response: {"deleted": N, "failed": [{"id":X,"reason":"not_found"}]}.
//
// Audit row is written via h.audit when configured; absent an audit
// callback the delete still happens but no audit_logs row is appended.
func (h *Handler) BulkUpdate(w http.ResponseWriter, r *http.Request) {
	if h.bulk == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "bulk geofence operations not configured")
		return
	}

	body, err := apibulk.DecodeOpBody(r)
	if err != nil {
		apibulk.WriteBadRequest(w, err)
		return
	}

	existing, err := h.bulk.FilterExistingIDs(r.Context(), body.IDs)
	if err != nil {
		log.Error().Err(err).Msg("bulk geofences: filter existing ids")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to validate geofences for bulk update")
		return
	}
	failed := apibulk.ComputeMissingIDs(body.IDs, existing)

	switch body.Op {
	case "delete":
		deleted, err := h.bulk.BulkDelete(r.Context(), existing)
		if err != nil {
			log.Error().Err(err).Msg("bulk geofences: delete")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to bulk delete geofences")
			return
		}
		if h.audit != nil {
			h.audit(r, "bulk_delete", nil,
				fmt.Sprintf("bulk_delete count=%d failed=%d", deleted, len(failed)))
		}
		httpx.WriteJSON(w, http.StatusOK, apibulk.OperationResult{Deleted: &deleted, Failed: failed})
	default:
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("unknown op %q; expected delete", body.Op))
	}
}
