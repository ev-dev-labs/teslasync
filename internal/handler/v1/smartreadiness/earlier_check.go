package smartreadiness

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

func (h *Handler) AdvanceCheck(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.advance_check")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging readiness")
	if !ok {
		return
	}
	planID, idErr := positiveID(chi.URLParam(r, "planID"))
	if idErr != nil {
		h.handleError(w, span, idErr)
		return
	}
	input, err := decode[struct {
		VehicleID        int64     `json:"vehicle_id" validate:"required,gt=0"`
		ExpectedVersion  int64     `json:"expected_version" validate:"required,gt=0"`
		ExpectedCheckAt  time.Time `json:"expected_check_at"`
		CheckAt          time.Time `json:"check_at"`
		PreviewExpiresAt time.Time `json:"preview_expires_at"`
	}](w, r)
	if err != nil {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid earlier charging check")
		return
	}
	key := domain.StopPlanKey{PlanID: planID, Subject: subject, VehicleID: input.VehicleID}
	err = h.service.AdvanceCheck(ctx, key, input.ExpectedVersion, input.ExpectedCheckAt, input.CheckAt, input.PreviewExpiresAt)
	switch {
	case errors.Is(err, port.ErrEarlierCheck):
		httputil.RespondError(w, http.StatusConflict, "EARLIER_CHECK_CHANGED", "refresh the charging estimate before changing the check")
	case err != nil:
		h.handleError(w, span, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
