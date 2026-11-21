package ownershipintel

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	renewalsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/subscriptionrenewal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	renewal "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/subscriptionrenewal"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/subscriptionrenewal"
)

type subscriptionRenewalService interface {
	Read(context.Context, port.Scope) (renewalsvc.State, error)
	Save(context.Context, port.Scope, port.Plan) error
	Dismiss(context.Context, port.Scope, string) error
	Clear(context.Context, port.Scope, string) error
}

func (h *Handler) WithSubscriptionRenewals(service subscriptionRenewalService) *Handler {
	h.subscriptionRenewal = service
	return h
}

func (h *Handler) SubscriptionRenewal(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.SubscriptionRenewal")
	defer span.End()
	subject, ok := personalhandler.Subject(w, r, h.headerName, "subscription renewal review")
	if !ok {
		return
	}
	if subject == personal.OpenSubject || subject == domain.LegacyOpenSubject {
		writeError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "renewal reviews require a verified sign-in")
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	subID, err := strconv.ParseInt(r.URL.Query().Get("subscription_id"), 10, 64)
	if err != nil || subID <= 0 {
		validationError(w, span, renewalsvc.ErrInvalid)
		return
	}
	scope := port.Scope{Subject: subject, VehicleID: vehicleID, SubscriptionID: subID}
	var outcome string
	switch r.Method {
	case http.MethodGet:
		var state renewalsvc.State
		state, err = h.subscriptionRenewal.Read(ctx, scope)
		if err == nil {
			writeJSON(w, http.StatusOK, state)
		}
	case http.MethodPut:
		var input struct {
			renewal.Terms
			Revision            *string `json:"expected_revision"`
			SubscriptionVersion int     `json:"subscription_version"`
			Confirmed           bool    `json:"confirmed"`
			Paused              bool    `json:"paused"`
		}
		if decodeBody(w, r, &input) != nil || input.Revision == nil || !input.Paused && !input.Confirmed {
			err = renewalsvc.ErrInvalid
			break
		}
		err = h.subscriptionRenewal.Save(ctx, scope, port.Plan{
			Terms: input.Terms, Revision: *input.Revision, SubscriptionVersion: input.SubscriptionVersion, Paused: input.Paused,
		})
		outcome = "confirmed"
		if input.Paused {
			outcome = "paused"
		}
	case http.MethodPatch:
		var input struct {
			Revision string `json:"expected_revision"`
		}
		if decodeBody(w, r, &input) != nil {
			err = renewalsvc.ErrInvalid
			break
		}
		err = h.subscriptionRenewal.Dismiss(ctx, scope, input.Revision)
		outcome = "dismissed"
	case http.MethodDelete:
		err = h.subscriptionRenewal.Clear(ctx, scope, r.URL.Query().Get("expected_revision"))
		outcome = "cleared"
	}
	switch {
	case errors.Is(err, port.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "subscription not found")
	case errors.Is(err, port.ErrChanged):
		writeError(w, http.StatusConflict, "SUBSCRIPTION_RENEWAL_CHANGED", "refresh the private renewal review before acting")
	case errors.Is(err, renewalsvc.ErrInvalid):
		validationError(w, span, err)
	case err != nil:
		h.handleError(w, span, "manage private subscription renewal", errors.New("private renewal operation failed"))
	case outcome != "":
		metrics.RecordSubscriptionRenewal(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
