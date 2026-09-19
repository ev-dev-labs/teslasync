package alerts

import (
	"net/http"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
)

func (h *AlertHandler) checkRuleChannels(w http.ResponseWriter, r *http.Request, ids []int64) bool {
	return h.checkRuleChannelSets(w, r, ids)
}

func (h *AlertHandler) checkRuleChannelSets(w http.ResponseWriter, r *http.Request, sets ...[]int64) bool {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.channels.validate")
	defer span.End()
	seen := make(map[int64]bool)
	for _, ids := range sets {
		if len(ids) > 100 {
			writeError(w, http.StatusBadRequest, "select at most 100 notification channels")
			return false
		}
		ruleIDs := make(map[int64]bool, len(ids))
		for _, id := range ids {
			if id <= 0 || ruleIDs[id] {
				writeError(w, http.StatusBadRequest, "channel IDs must be positive and unique")
				return false
			}
			ruleIDs[id], seen[id] = true, true
		}
	}
	if len(seen) == 0 {
		return true
	}
	channels, err := h.notifRepo.GetAllChannels(ctx)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to validate rule channels")
		writeError(w, http.StatusInternalServerError, "failed to validate notification channels")
		return false
	}
	for _, ch := range channels {
		if ch != nil {
			delete(seen, ch.ID)
		}
	}
	if len(seen) > 0 {
		writeError(w, http.StatusBadRequest, "a selected notification channel no longer exists")
		return false
	}
	return true
}
