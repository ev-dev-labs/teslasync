package alerts

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
)

func (h *AlertHandler) BulkDeleteRules(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.rules.bulk_delete")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	repo, ok := h.bulkRuleRepo.(interface {
		BulkDelete(context.Context, []int64) ([]int64, error)
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "bulk deletion not configured")
		return
	}
	var body apibulk.IDsBody
	_, err := decodeStrictAlertRequest(r, &body, nil)
	if err != nil {
		span.RecordError(err)
		apibulk.WriteBadRequest(w, err)
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > apibulk.MaxIDs {
		writeError(w, http.StatusBadRequest, "select between 1 and 500 rule IDs")
		return
	}
	for _, id := range body.IDs {
		if id <= 0 {
			writeError(w, http.StatusBadRequest, "rule IDs must be positive")
			return
		}
	}
	ids := apibulk.DedupeInt64s(body.IDs)
	deleted, err := repo.BulkDelete(ctx, ids)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("bulk delete alert rules failed")
		writeError(w, http.StatusInternalServerError, "failed to delete alert rules")
		return
	}
	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, "bulk_delete", "alert_rule", nil,
			fmt.Sprintf("requested=%d deleted=%d", len(ids), len(deleted)))
	}
	log.Info().Str("trace_id", span.SpanContext().TraceID().String()).Int("deleted", len(deleted)).Msg("alert rules deleted")
	writeJSON(w, http.StatusOK, struct {
		DeletedIDs []int64 `json:"deleted_ids"`
	}{deleted})
}

// BulkEnableRules sets enabled=TRUE for every rule in the request body's
// `ids` array.
func (h *AlertHandler) BulkEnableRules(w http.ResponseWriter, r *http.Request) {
	h.bulkSetRulesEnabled(w, r, true)
}

// BulkDisableRules sets enabled=FALSE for every rule in the request body's
// `ids` array.
func (h *AlertHandler) BulkDisableRules(w http.ResponseWriter, r *http.Request) {
	h.bulkSetRulesEnabled(w, r, false)
}

// bulkSetRulesEnabled is the shared implementation of BulkEnableRules and
// BulkDisableRules. Contract:
//   - Body: {"ids":[1,2,3]}, capped at MaxBulkIDs (500). Empty or oversized → 400.
//   - Response: {"updated": N, "failed": [{"id": X, "reason": "not_found"}]}.
//   - Pre-validates IDs through bulkRuleRepo.FilterExistingIDs so the caller
//     can detect partial failures without parsing detail strings.
//   - Update happens in a single transaction; mid-batch failure rolls back
//     any partially-applied writes.
//   - Audit-logged once with cardinality + new value in detail.
//
// Returns 503 when the bulk repository was not wired — only happens in
// hand-built test setups; production NewAlertHandler always provides it.
func (h *AlertHandler) bulkSetRulesEnabled(w http.ResponseWriter, r *http.Request, enabled bool) {
	if h.bulkRuleRepo == nil {
		writeError(w, http.StatusServiceUnavailable, "bulk rule operations not configured")
		return
	}

	ids, err := apibulk.DecodeIDsRequest(r)
	if err != nil {
		apibulk.WriteBadRequest(w, err)
		return
	}

	existing, err := h.bulkRuleRepo.FilterExistingIDs(r.Context(), ids)
	if err != nil {
		log.Error().Err(err).Msg("bulk set rules enabled: filter existing ids")
		writeError(w, http.StatusInternalServerError, "failed to validate alert rules for bulk update")
		return
	}
	failed := apibulk.ComputeMissingIDs(ids, existing)

	updated, err := h.bulkRuleRepo.BulkSetEnabled(r.Context(), existing, enabled)
	if err != nil {
		log.Error().Err(err).Msg("bulk set rules enabled")
		writeError(w, http.StatusInternalServerError, "failed to bulk update alert rules")
		return
	}

	action := "bulk_disable"
	if enabled {
		action = "bulk_enable"
	}
	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, action, "alert_rule", nil,
			fmt.Sprintf("%s count=%d failed=%d", action, updated, len(failed)))
	}

	writeJSON(w, http.StatusOK, apibulk.OperationResult{
		Updated: &updated,
		Failed:  failed,
	})
}
