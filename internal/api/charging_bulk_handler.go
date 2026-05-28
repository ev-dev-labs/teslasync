package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
)

// chargingBulkStore is the narrow surface needed by BulkDelete; implemented
// by *chargingdb.ChargingRepo and substitutable in tests.
type chargingBulkStore interface {
	FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error)
	BulkDelete(ctx context.Context, ids []int64) (int64, error)
}

func (h *ChargingHandler) chargingBulkRepo() chargingBulkStore {
	if h.bulkOverride != nil {
		return h.bulkOverride
	}
	return h.chargingRepo
}

// BulkDelete removes multiple charging sessions in a single transaction.
//
// Phase-40 / Prompt 51 — standardized bulk-action endpoint.
//
// Contract:
//   - Body: {"ids":[1,2,3]}, capped at MaxBulkIDs (500). Empty or oversized → 400.
//   - Response: {"deleted": <int>, "failed": [{"id": <int>, "reason": "not_found"}]}.
//   - Pre-validates which IDs exist via FilterExistingIDs so the caller can
//     pair `failed[]` per id without parsing detail strings.
//   - All deletes happen in a single Postgres transaction; a failure
//     mid-batch rolls back any partially-applied writes.
//   - Audit-logged once with `bulk_delete count=N` in detail.
func (h *ChargingHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	ids, err := decodeBulkIDsRequest(r)
	if err != nil {
		writeBulkBadRequest(w, err)
		return
	}

	store := h.chargingBulkRepo()
	existing, err := store.FilterExistingIDs(r.Context(), ids)
	if err != nil {
		log.Error().Err(err).Msg("bulk delete charging sessions: filter existing ids")
		writeError(w, http.StatusInternalServerError, "failed to validate charging sessions for bulk delete")
		return
	}
	failed := computeMissingIDs(ids, existing)

	deleted, err := store.BulkDelete(r.Context(), existing)
	if err != nil {
		log.Error().Err(err).Msg("bulk delete charging sessions")
		writeError(w, http.StatusInternalServerError, "failed to bulk delete charging sessions")
		return
	}

	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, "bulk_delete", "charging_session", nil,
			fmt.Sprintf("bulk_delete count=%d failed=%d", deleted, len(failed)))
	}

	writeJSON(w, http.StatusOK, bulkOperationResult{
		Deleted: &deleted,
		Failed:  failed,
	})
}
