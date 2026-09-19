package alerts

import (
	"net/http"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
)

func (h *AlertHandler) checkRuleChannels(w http.ResponseWriter, r *http.Request, ids []int64) bool {
	if len(ids) == 0 {
		return true
	}
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.channels.validate")
	defer span.End()
	if len(ids) > 100 {
		writeError(w, http.StatusBadRequest, "select at most 100 notification channels")
		return false
	}
	seen := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			writeError(w, http.StatusBadRequest, "channel IDs must be positive and unique")
			return false
		}
		seen[id] = true
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
