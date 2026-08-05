package fleetops

import (
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

func (h *Handler) ListAssignments(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "list_assignments")
	defer span.End()
	vehicleID, err := optionalID(r.URL.Query().Get("vehicle_id"), "vehicle_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_assignments", err)
		return
	}
	driverID, err := optionalID(r.URL.Query().Get("driver_id"), "driver_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_assignments", err)
		return
	}
	at, err := optionalTime(r.URL.Query().Get("at"), "at")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_assignments", err)
		return
	}
	limit, offset := listPage(r)
	page, err := h.service.ListAssignments(ctx, dbfleetops.AssignmentFilter{
		VehicleID: vehicleID, DriverID: driverID, At: at, Limit: limit, Offset: offset,
	})
	if err != nil {
		writeHandlerError(ctx, span, w, "list_assignments", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) GetAssignment(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "get_assignment")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := h.service.GetAssignment(ctx, id)
	if err != nil {
		writeHandlerError(ctx, span, w, "get_assignment", err)
		return
	}
	if item == nil {
		writeNotFound(w, "assignment")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) CreateAssignment(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "create_assignment")
	defer span.End()
	var item models.FleetVehicleDriverAssignment
	if !decodeBody(w, r, &item) {
		return
	}
	if item.VehicleID <= 0 || item.DriverID <= 0 || item.StartsAt.IsZero() {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id, driver_id, and starts_at are required")
		return
	}
	if err := h.service.CreateAssignment(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "create_assignment", err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdateAssignment(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "update_assignment")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var item models.FleetVehicleDriverAssignment
	if !decodeBody(w, r, &item) {
		return
	}
	if item.VehicleID <= 0 || item.DriverID <= 0 || item.StartsAt.IsZero() || item.Version <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id, driver_id, starts_at, and version are required")
		return
	}
	item.ID = id
	if err := h.service.UpdateAssignment(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "update_assignment", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) DeleteAssignment(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "delete_assignment")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteAssignment(ctx, id, version); err != nil {
		writeHandlerError(ctx, span, w, "delete_assignment", err)
		return
	}
	httpx.WriteJSON(w, http.StatusNoContent, nil)
}

func (h *Handler) ListReservations(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "list_reservations")
	defer span.End()
	vehicleID, err := optionalID(r.URL.Query().Get("vehicle_id"), "vehicle_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_reservations", err)
		return
	}
	driverID, err := optionalID(r.URL.Query().Get("driver_id"), "driver_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_reservations", err)
		return
	}
	costCenterID, err := optionalID(r.URL.Query().Get("cost_center_id"), "cost_center_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_reservations", err)
		return
	}
	status := r.URL.Query().Get("status")
	if !validEnum(status, "requested", "confirmed", "cancelled", "completed") {
		httpx.WriteError(w, http.StatusBadRequest, "invalid reservation status")
		return
	}
	from, err := optionalTime(r.URL.Query().Get("from"), "from")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_reservations", err)
		return
	}
	to, err := optionalTime(r.URL.Query().Get("to"), "to")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_reservations", err)
		return
	}
	if from != nil && to != nil && !to.After(*from) {
		httpx.WriteError(w, http.StatusBadRequest, "to must be after from")
		return
	}
	limit, offset := listPage(r)
	page, err := h.service.ListReservations(ctx, dbfleetops.ReservationFilter{
		VehicleID: vehicleID, DriverID: driverID, CostCenterID: costCenterID,
		Status: status, From: from, To: to, Limit: limit, Offset: offset,
	})
	if err != nil {
		writeHandlerError(ctx, span, w, "list_reservations", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) GetReservation(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "get_reservation")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := h.service.GetReservation(ctx, id)
	if err != nil {
		writeHandlerError(ctx, span, w, "get_reservation", err)
		return
	}
	if item == nil {
		writeNotFound(w, "reservation")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) CreateReservation(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "create_reservation")
	defer span.End()
	var item models.FleetReservation
	if !decodeBody(w, r, &item) {
		return
	}
	if item.VehicleID <= 0 || !requiredText(item.Title) ||
		item.StartsAt.IsZero() || item.EndsAt.IsZero() {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id, title, starts_at, and ends_at are required")
		return
	}
	if err := h.service.CreateReservation(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "create_reservation", err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdateReservation(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "update_reservation")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var item models.FleetReservation
	if !decodeBody(w, r, &item) {
		return
	}
	if item.VehicleID <= 0 || !requiredText(item.Title) ||
		item.StartsAt.IsZero() || item.EndsAt.IsZero() || item.Version <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id, title, starts_at, ends_at, and version are required")
		return
	}
	item.ID = id
	if err := h.service.UpdateReservation(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "update_reservation", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) DeleteReservation(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "delete_reservation")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteReservation(ctx, id, version); err != nil {
		writeHandlerError(ctx, span, w, "delete_reservation", err)
		return
	}
	httpx.WriteJSON(w, http.StatusNoContent, nil)
}

func (h *Handler) UtilizationForecast(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "utilization_forecast")
	defer span.End()
	vehicleID, err := optionalID(r.URL.Query().Get("vehicle_id"), "vehicle_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "utilization_forecast", err)
		return
	}
	now := time.Now().UTC()
	from := utcDay(now)
	to := from.Add(14 * 24 * time.Hour)
	if raw := r.URL.Query().Get("from"); raw != "" {
		parsed, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil {
			httpx.WriteError(w, http.StatusBadRequest, "from must be RFC3339")
			return
		}
		from = parsed
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		parsed, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil {
			httpx.WriteError(w, http.StatusBadRequest, "to must be RFC3339")
			return
		}
		to = parsed
	}
	forecast, err := h.service.UtilizationForecast(ctx, vehicleID, from, to)
	if err != nil {
		writeHandlerError(ctx, span, w, "utilization_forecast", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, forecast)
}
