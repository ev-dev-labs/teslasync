package ownershipintel

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

type warrantyReminderService interface {
	Settings(context.Context, port.WarrantyReminderKey) (domain.WarrantyReminderSettings, error)
	Set(context.Context, port.WarrantyReminderKey, bool) error
}

func (h *Handler) WithWarrantyReminders(service warrantyReminderService) *Handler {
	h.warrantyReminders = service
	return h
}

func (h *Handler) WarrantyReminder(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "ownershipintel.warranty_reminder")
	defer span.End()
	subject, ok := personalhandler.Subject(w, r, h.headerName, "warranty mileage analysis")
	if !ok {
		return
	}
	if subject == personal.OpenSubject || subject == domain.LegacyOpenSubject {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "warranty reminders require a verified identity")
		return
	}
	vehicleID, vehicleErr := parseVehicleID(r)
	warrantyID, idErr := strconv.ParseInt(chi.URLParam(r, "warrantyID"), 10, 64)
	if vehicleErr != nil || idErr != nil || warrantyID <= 0 {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "positive vehicle and warranty identifiers are required")
		return
	}
	key := port.WarrantyReminderKey{Subject: subject, VehicleID: vehicleID, WarrantyID: warrantyID}
	if r.Method == http.MethodGet {
		state, err := h.warrantyReminders.Settings(ctx, key)
		if err != nil {
			h.handleError(w, span, "read private warranty reminder", err)
			return
		}
		httputil.Respond(w, http.StatusOK, state)
		return
	}
	if r.Method == http.MethodPut {
		var input struct {
			Confirmed bool `json:"local_analysis_confirmed"`
		}
		if err := decodeBody(w, r, &input); err != nil || !input.Confirmed {
			httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "confirm private local warranty distance analysis")
			return
		}
	}
	if err := h.warrantyReminders.Set(ctx, key, r.Method == http.MethodPut); err != nil {
		h.handleError(w, span, "update private warranty reminder", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
