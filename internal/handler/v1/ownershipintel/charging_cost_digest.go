package ownershipintel

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	costsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/costtrend"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/costtrend"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/costtrend"
)

type chargingCostService interface {
	Read(context.Context, port.Scope) (domain.Review, error)
	Save(context.Context, port.Scope, domain.Settings) error
	Delete(context.Context, port.Scope, int64) error
	Dismiss(context.Context, port.Scope, int64, time.Time) error
}

func (h *Handler) WithChargingCostReviews(service chargingCostService) *Handler {
	h.chargingCost = service
	return h
}

func (h *Handler) ChargingCostDigest(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ChargingCostDigest")
	defer span.End()
	subject, ok := personalhandler.Subject(w, r, h.headerName, "monthly charging cost digest")
	if !ok {
		return
	}
	if subject == personaldomain.OpenSubject || subject == "open-mode" {
		writeError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "charging cost digests require a verified sign-in")
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
		review, err = h.chargingCost.Read(ctx, scope)
		if err == nil {
			writeJSON(w, http.StatusOK, review)
		}
	case http.MethodPut:
		var input struct {
			ExpectedID *int64 `json:"expected_plan_id"`
			TimeZone   string `json:"time_zone"`
			Currency   string `json:"currency"`
			Material   int64  `json:"material_change_minor"`
			Paused     bool   `json:"paused"`
			Confirmed  bool   `json:"local_review_confirmed"`
		}
		if decodeBody(w, r, &input) != nil || input.ExpectedID == nil || (!input.Paused && !input.Confirmed) {
			err = costsvc.ErrInvalidSettings
			break
		}
		err = h.chargingCost.Save(ctx, scope, domain.Settings{
			ID: *input.ExpectedID, TimeZone: input.TimeZone, Currency: input.Currency,
			MaterialChangeMinor: input.Material, Paused: input.Paused,
		})
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
			err = costsvc.ErrInvalidSettings
			break
		}
		err = h.chargingCost.Dismiss(ctx, scope, input.ID, input.Through)
		outcome = "dismissed"
	case http.MethodDelete:
		var id int64
		id, err = strconv.ParseInt(r.URL.Query().Get("plan_id"), 10, 64)
		if err != nil || id <= 0 {
			err = costsvc.ErrInvalidSettings
			break
		}
		err = h.chargingCost.Delete(ctx, scope, id)
		outcome = "cleared"
	}
	switch {
	case errors.Is(err, port.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "charging cost review not found")
	case errors.Is(err, port.ErrChanged):
		writeError(w, http.StatusConflict, "CHARGING_COST_DIGEST_CHANGED", "refresh the private charging cost review before changing it")
	case errors.Is(err, costsvc.ErrInvalidSettings):
		validationError(w, span, err)
	case err != nil:
		h.handleError(w, span, "manage charging cost digest", errors.New("private charging cost digest operation failed"))
	case outcome != "":
		metrics.RecordChargingCostDigest(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
