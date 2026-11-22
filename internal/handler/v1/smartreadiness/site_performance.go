package smartreadiness

import (
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

func (h *Handler) SitePerformance(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.site_performance")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging site performance")
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	settings, err := h.service.SitePerformanceSettings(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, settings)
}

func (h *Handler) SaveSitePerformance(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.save_site_performance")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging site performance")
	if !ok {
		return
	}
	type request struct {
		VehicleID int64  `json:"vehicle_id"`
		PlaceID   *int64 `json:"charging_place_id"`
		Enabled   *bool  `json:"enabled"`
	}
	body, err := decode[request](w, r)
	if err != nil || body.Enabled == nil || *body.Enabled != (body.PlaceID != nil) {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	if err := h.service.SetSitePerformance(ctx, subject, body.VehicleID, body.PlaceID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
