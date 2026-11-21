package ownershipintel

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	tariffsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/monthlytariff"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/monthlytariff"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/monthlytariff"
)

type monthlyTariffService interface {
	Read(context.Context, port.Scope) (domain.Review, error)
	Save(context.Context, port.Scope, domain.Settings) error
	Delete(context.Context, port.Scope, int64) error
	Dismiss(context.Context, port.Scope, int64, time.Time) error
}

func (h *Handler) WithMonthlyTariffReviews(service monthlyTariffService) *Handler {
	h.monthlyTariff = service
	return h
}

func (h *Handler) MonthlyTariffReview(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.MonthlyTariffReview")
	defer span.End()
	subject, ok := personalhandler.Subject(w, r, h.headerName, "monthly tariff review")
	if !ok {
		return
	}
	if subject == personal.OpenSubject || subject == "open-mode" {
		writeError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "monthly tariff reviews require a verified sign-in")
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
		review, err = h.monthlyTariff.Read(ctx, scope)
		if err == nil {
			writeJSON(w, http.StatusOK, review)
		}
	case http.MethodPut:
		var input struct {
			domain.Settings
			ExpectedID     *int64 `json:"expected_plan_id"`
			SwitchFee      *int64 `json:"switch_fee_minor"`
			TermsConfirmed bool   `json:"same_site_terms_confirmed"`
		}
		if decodeBody(w, r, &input) != nil || input.ExpectedID == nil || input.SwitchFee == nil ||
			input.Settings.ID != 0 || !input.Paused && !input.TermsConfirmed {
			err = tariffsvc.ErrInvalidSettings
			break
		}
		input.Settings.ID = *input.ExpectedID
		input.Settings.SwitchFeeMinor = *input.SwitchFee
		err = h.monthlyTariff.Save(ctx, scope, input.Settings)
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
			err = tariffsvc.ErrInvalidSettings
			break
		}
		err = h.monthlyTariff.Dismiss(ctx, scope, input.ID, input.Through)
		outcome = "dismissed"
	case http.MethodDelete:
		var id int64
		id, err = strconv.ParseInt(r.URL.Query().Get("plan_id"), 10, 64)
		if err != nil || id <= 0 {
			err = tariffsvc.ErrInvalidSettings
			break
		}
		err = h.monthlyTariff.Delete(ctx, scope, id)
		outcome = "cleared"
	}
	switch {
	case errors.Is(err, port.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "monthly tariff review not found")
	case errors.Is(err, port.ErrChanged):
		writeError(w, http.StatusConflict, "MONTHLY_TARIFF_REVIEW_CHANGED", "refresh the private review and applicable tariff terms before changing it")
	case errors.Is(err, tariffsvc.ErrInvalidSettings):
		validationError(w, span, err)
	case err != nil:
		h.handleError(w, span, "manage monthly tariff review", errors.New("private monthly tariff review operation failed"))
	case outcome != "":
		metrics.RecordMonthlyTariffReview(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
