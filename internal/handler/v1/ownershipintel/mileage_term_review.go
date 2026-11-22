package ownershipintel

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	mileagesvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/mileageterm"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/mileageterm"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/mileageterm"
)

type mileageTermService interface {
	Read(context.Context, port.Scope) (domain.Review, error)
	Save(context.Context, port.Scope, domain.Settings) error
	Delete(context.Context, port.Scope, int64) error
	Dismiss(context.Context, port.Scope, int64, time.Time) error
}

func (h *Handler) WithMileageTermReviews(service mileageTermService) *Handler {
	h.mileageTerm = service
	return h
}

func (h *Handler) MileageTermReview(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.MileageTermReview")
	defer span.End()
	subject, ok := personalhandler.Subject(w, r, h.headerName, "mileage term review")
	if !ok {
		return
	}
	if subject == personal.OpenSubject || subject == "open-mode" {
		writeError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "mileage reviews require a verified sign-in")
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	scope := port.Scope{Subject: subject, VehicleID: vehicleID}
	var outcome string
	switch r.Method {
	case http.MethodGet:
		var review domain.Review
		review, err = h.mileageTerm.Read(ctx, scope)
		if err == nil {
			writeJSON(w, http.StatusOK, review)
		}
	case http.MethodPut:
		var input struct {
			domain.Settings
			ExpectedID     *int64   `json:"expected_plan_id"`
			Opening        *float64 `json:"opening_odometer_m"`
			TermsConfirmed bool     `json:"terms_confirmed"`
		}
		if decodeBody(w, r, &input) != nil || input.ExpectedID == nil || input.Opening == nil ||
			input.Settings.ID != 0 || !input.Paused && !input.TermsConfirmed {
			err = mileagesvc.ErrInvalidSettings
			break
		}
		input.Settings.ID = *input.ExpectedID
		input.Settings.OpeningM = *input.Opening
		err = h.mileageTerm.Save(ctx, scope, input.Settings)
		outcome = "confirmed"
		if input.Paused {
			outcome = "paused"
		}
	case http.MethodPatch:
		var input struct {
			ID      int64     `json:"plan_id"`
			Through time.Time `json:"through"`
		}
		if decodeBody(w, r, &input) != nil {
			err = mileagesvc.ErrInvalidSettings
			break
		}
		err = h.mileageTerm.Dismiss(ctx, scope, input.ID, input.Through)
		outcome = "dismissed"
	case http.MethodDelete:
		var id int64
		id, err = strconv.ParseInt(r.URL.Query().Get("plan_id"), 10, 64)
		if err != nil || id <= 0 {
			err = mileagesvc.ErrInvalidSettings
			break
		}
		err = h.mileageTerm.Delete(ctx, scope, id)
		outcome = "cleared"
	}
	switch {
	case errors.Is(err, port.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "mileage review not found")
	case errors.Is(err, port.ErrChanged):
		writeError(w, http.StatusConflict, "MILEAGE_REVIEW_CHANGED", "refresh the private mileage review before changing it")
	case errors.Is(err, mileagesvc.ErrInvalidSettings):
		validationError(w, span, err)
	case err != nil:
		h.handleError(w, span, "manage mileage term review", errors.New("private mileage review operation failed"))
	case outcome != "":
		metrics.RecordMileageTermReview(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
