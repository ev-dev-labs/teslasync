package smartcommute

import (
	"net/http"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
)

type trafficDriveRequest struct {
	VehicleID int64 `json:"vehicle_id"`
	DriveID   int64 `json:"drive_id"`
}

func (h *Handler) PreviewTrafficTrace(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.preview_traffic_trace")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	request, err := decode[trafficDriveRequest](w, r)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	result, err := h.service.PreviewTrafficTrace(ctx, subject, request.VehicleID, routineID, request.DriveID)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, result)
}

type trafficConsentRequest struct {
	trafficDriveRequest
	Fingerprint      string `json:"fingerprint"`
	ShareWithHERE    bool   `json:"share_with_here"`
	LeadS            int    `json:"lead_s"`
	MinSavingsS      int64  `json:"min_savings_s"`
	ArrivalDeadlineS *int   `json:"arrival_deadline_s"`
}

func (h *Handler) SaveTrafficConsent(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.save_traffic_consent")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	request, err := decode[trafficConsentRequest](w, r)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	err = h.service.SaveTrafficConsent(ctx, subject, domain.TrafficConsentInput{
		VehicleID: request.VehicleID, RoutineID: routineID, DriveID: request.DriveID,
		Fingerprint: request.Fingerprint, ShareWithHERE: request.ShareWithHERE,
		LeadS: request.LeadS, MinSavingsS: request.MinSavingsS,
		ArrivalDeadlineS: request.ArrivalDeadlineS,
	})
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteTrafficConsent(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.delete_traffic_consent")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	if err := h.service.DeleteTrafficConsent(ctx, subject, vehicleID, routineID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SkipTrafficToday(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.skip_traffic_today")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	request, err := decode[vehicleRequest](w, r)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	if err := h.service.SkipTrafficToday(ctx, subject, request.VehicleID, routineID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
