package smartmedia

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

func (h *Handler) soundtrack(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.journey_soundtrack")
	defer span.End()
	scope, ok := h.scope(w, r)
	if !ok {
		return
	}
	journeyID, parseErr := strconv.ParseInt(chi.URLParam(r, "journeyID"), 10, 64)
	if parseErr != nil || journeyID <= 0 {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "select a completed journey")
		return
	}
	journey := port.JourneyScope{Scope: scope, JourneyID: journeyID}
	var err error
	var outcome string
	switch r.Method {
	case http.MethodGet:
		review, readErr := h.soundtracks.Read(ctx, journey)
		if readErr == nil {
			metrics.RecordJourneySoundtrack(review.Reason)
			httputil.Respond(w, http.StatusOK, review)
			return
		}
		err = readErr
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		body, decodeErr := httputil.DecodeAndValidate[domain.SoundtrackConfirmation](r)
		if decodeErr == nil {
			err = h.soundtracks.Confirm(ctx, journey, body)
		} else {
			err = smartmediasvc.ErrInvalidInput
		}
		outcome = "confirmed"
	case http.MethodPatch, http.MethodDelete:
		id, idErr := strconv.ParseInt(r.URL.Query().Get("review_id"), 10, 64)
		if idErr != nil || id <= 0 {
			err = smartmediasvc.ErrInvalidInput
			break
		}
		if r.Method == http.MethodDelete {
			err, outcome = h.soundtracks.Clear(ctx, journey, id), "cleared"
			break
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		body, decodeErr := httputil.DecodeAndValidate[struct {
			Action string `json:"action"`
		}](r)
		if decodeErr != nil || (body.Action != "pause" && body.Action != "snooze") {
			err = smartmediasvc.ErrInvalidInput
			break
		}
		err, outcome = h.soundtracks.Hold(ctx, journey, id, body.Action == "snooze"), body.Action
	}
	switch {
	case err == nil:
		metrics.RecordJourneySoundtrack(outcome)
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "journey not found for the selected vehicle")
	case errors.Is(err, port.ErrChanged):
		httputil.RespondError(w, http.StatusConflict, "SOUNDTRACK_REVIEW_CHANGED", "reopen the current journey review before continuing")
	case errors.Is(err, smartmediasvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid private soundtrack request")
	default:
		respondError(w, span, err)
	}
}
