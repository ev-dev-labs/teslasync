package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
)

// automationBulkStore is the narrow surface needed by the automation bulk
// endpoint; implemented by *database.AutomationRepo and substitutable in
// tests via the handler's bulkOverride field.
type automationBulkStore interface {
	FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error)
	BulkSetEnabled(ctx context.Context, ids []int64, enabled bool) (int64, error)
	BulkDelete(ctx context.Context, ids []int64) (int64, error)
}

func (h *AutomationHandler) automationBulkRepo() automationBulkStore {
	if h.bulkOverride != nil {
		return h.bulkOverride
	}
	if h.bulkRepo == nil {
		return nil
	}
	return h.bulkRepo
}

// automationBulkBody is the request shape for /automations/bulk.
//   - `ids`  must be a non-empty array of automation ids (capped at MaxBulkIDs).
//   - `op`   is one of the allowlisted values: enable | disable | delete.
//
// Any other op string returns 400 — strict allowlisting prevents accidental
// privileged operations being added in the future without an explicit code
// change here. Phase-45 / Prompt 32 — bulk-actions framework.
type automationBulkBody struct {
	IDs []int64 `json:"ids"`
	Op  string  `json:"op"`
}

// BulkUpdate runs an allowlisted bulk operation across multiple automations
// inside a single transaction.
//
// Contract:
//   - Body: {"ids":[1,2,3],"op":"enable"|"disable"|"delete"}
//   - `ids` empty / over MaxBulkIDs → 400.
//   - Unknown `op` → 400.
//   - Response: {"updated"|"deleted": N, "failed": [{"id":X,"reason":"not_found"}]}.
//   - Pre-validates membership via FilterExistingIDs so partial failures
//     are surfaced per-id without parsing detail strings.
//   - All writes happen in a single Postgres transaction; mid-batch failure
//     rolls back any partially-applied writes.
//   - Audit-logged once with op + cardinality in detail.
func (h *AutomationHandler) BulkUpdate(w http.ResponseWriter, r *http.Request) {
	store := h.automationBulkRepo()
	if store == nil {
		writeError(w, http.StatusServiceUnavailable, "bulk automation operations not configured")
		return
	}

	body, err := decodeAutomationBulkBody(r)
	if err != nil {
		writeBulkBadRequest(w, err)
		return
	}

	existing, err := store.FilterExistingIDs(r.Context(), body.IDs)
	if err != nil {
		log.Error().Err(err).Msg("bulk automations: filter existing ids")
		writeError(w, http.StatusInternalServerError, "failed to validate automations for bulk update")
		return
	}
	failed := computeMissingIDs(body.IDs, existing)

	switch body.Op {
	case "enable", "disable":
		enabled := body.Op == "enable"
		updated, err := store.BulkSetEnabled(r.Context(), existing, enabled)
		if err != nil {
			log.Error().Err(err).Str("op", body.Op).Msg("bulk automations: set enabled")
			writeError(w, http.StatusInternalServerError, "failed to bulk update automations")
			return
		}
		if h.db != nil {
			logAuditFromRequest(h.db, r, "", "bulk_"+body.Op, "automation", nil,
				fmt.Sprintf("bulk_%s count=%d failed=%d", body.Op, updated, len(failed)))
		}
		// Notify worker so trigger configurations reload promptly.
		if h.mqttPublisher != nil {
			for _, id := range existing {
				h.mqttPublisher.PublishReload(r.Context(), "toggled", id)
			}
		}
		writeJSON(w, http.StatusOK, bulkOperationResult{Updated: &updated, Failed: failed})
	case "delete":
		deleted, err := store.BulkDelete(r.Context(), existing)
		if err != nil {
			log.Error().Err(err).Msg("bulk automations: delete")
			writeError(w, http.StatusInternalServerError, "failed to bulk delete automations")
			return
		}
		if h.db != nil {
			logAuditFromRequest(h.db, r, "", "bulk_delete", "automation", nil,
				fmt.Sprintf("bulk_delete count=%d failed=%d", deleted, len(failed)))
		}
		if h.mqttPublisher != nil {
			for _, id := range existing {
				h.mqttPublisher.PublishReload(r.Context(), "deleted", id)
			}
		}
		writeJSON(w, http.StatusOK, bulkOperationResult{Deleted: &deleted, Failed: failed})
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown op %q; expected enable|disable|delete", body.Op))
	}
}

// decodeAutomationBulkBody parses + validates the request body for the
// /automations/bulk endpoint. Reuses the same MaxBulkIDs cap and dedupe
// behaviour as decodeBulkIDsRequest so the contract is consistent.
func decodeAutomationBulkBody(r *http.Request) (automationBulkBody, error) {
	var body automationBulkBody
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return automationBulkBody{}, errBulkBodyInvalid
	}
	if len(body.IDs) == 0 {
		return automationBulkBody{}, errBulkIDsEmpty
	}
	if len(body.IDs) > MaxBulkIDs {
		return automationBulkBody{}, errBulkIDsTooMany
	}
	body.IDs = dedupeInt64s(body.IDs)
	return body, nil
}
