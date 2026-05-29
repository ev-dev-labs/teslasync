package automation

import (
	"context"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
)

// automationBulkStore is the narrow surface needed by the automation bulk
// endpoint; implemented by *dbauto.AutomationRepo and substitutable in
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

// /automations/bulk uses the parent bulk_helpers.go bridge to apibulk.

// BulkUpdate runs allowlisted automation bulk operations in one transaction.
// It pre-validates membership so per-id misses are returned in failed[] and
// mid-batch write failures roll back the whole operation.
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

// decodeAutomationBulkBody now lives in internal/api/bulk_helpers.go as
// a bridge to apibulk.DecodeOpBody (Phase R2.0f).
