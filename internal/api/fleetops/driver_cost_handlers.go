package fleetops

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

func (h *Handler) ListDrivers(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "list_drivers")
	defer span.End()
	status := r.URL.Query().Get("status")
	if !validEnum(status, "active", "inactive") {
		httpx.WriteError(w, http.StatusBadRequest, "status must be active or inactive")
		return
	}
	limit, offset := listPage(r)
	page, err := h.service.ListDrivers(ctx, dbfleetops.DriverFilter{
		Status: status, Search: r.URL.Query().Get("search"), Limit: limit, Offset: offset,
	})
	if err != nil {
		writeHandlerError(ctx, span, w, "list_drivers", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) GetDriver(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "get_driver")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := h.service.GetDriver(ctx, id)
	if err != nil {
		writeHandlerError(ctx, span, w, "get_driver", err)
		return
	}
	if item == nil {
		writeNotFound(w, "driver")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) CreateDriver(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "create_driver")
	defer span.End()
	var item models.FleetDriver
	if !decodeBody(w, r, &item) {
		return
	}
	if !requiredText(item.DisplayName) || !requiredText(item.ReferenceCode) {
		httpx.WriteError(w, http.StatusBadRequest, "display_name and reference_code are required")
		return
	}
	if err := h.service.CreateDriver(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "create_driver", err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdateDriver(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "update_driver")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var item models.FleetDriver
	if !decodeBody(w, r, &item) {
		return
	}
	if item.Version <= 0 || !requiredText(item.DisplayName) || !requiredText(item.ReferenceCode) {
		httpx.WriteError(w, http.StatusBadRequest, "version, display_name, and reference_code are required")
		return
	}
	item.ID = id
	if err := h.service.UpdateDriver(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "update_driver", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) DeleteDriver(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "delete_driver")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteDriver(ctx, id, version); err != nil {
		writeHandlerError(ctx, span, w, "delete_driver", err)
		return
	}
	httpx.WriteJSON(w, http.StatusNoContent, nil)
}

type costCenterRequest struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Active  *bool  `json:"active"`
	Version int    `json:"version"`
}

func (h *Handler) ListCostCenters(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "list_cost_centers")
	defer span.End()
	active, err := optionalBool(r.URL.Query().Get("active"), "active")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_cost_centers", err)
		return
	}
	limit, offset := listPage(r)
	page, err := h.service.ListCostCenters(ctx, dbfleetops.CostCenterFilter{
		Active: active, Search: r.URL.Query().Get("search"), Limit: limit, Offset: offset,
	})
	if err != nil {
		writeHandlerError(ctx, span, w, "list_cost_centers", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) GetCostCenter(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "get_cost_center")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := h.service.GetCostCenter(ctx, id)
	if err != nil {
		writeHandlerError(ctx, span, w, "get_cost_center", err)
		return
	}
	if item == nil {
		writeNotFound(w, "cost center")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) CreateCostCenter(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "create_cost_center")
	defer span.End()
	var req costCenterRequest
	if !decodeBody(w, r, &req) {
		return
	}
	if !requiredText(req.Code) || !requiredText(req.Name) {
		httpx.WriteError(w, http.StatusBadRequest, "code and name are required")
		return
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	item := models.FleetCostCenter{Code: req.Code, Name: req.Name, Active: active}
	if err := h.service.CreateCostCenter(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "create_cost_center", err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdateCostCenter(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "update_cost_center")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req costCenterRequest
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Active == nil || req.Version <= 0 || !requiredText(req.Code) || !requiredText(req.Name) {
		httpx.WriteError(w, http.StatusBadRequest, "code, name, active, and version are required")
		return
	}
	item := models.FleetCostCenter{
		ID: id, Code: req.Code, Name: req.Name, Active: *req.Active, Version: req.Version,
	}
	if err := h.service.UpdateCostCenter(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "update_cost_center", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) DeleteCostCenter(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "delete_cost_center")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteCostCenter(ctx, id, version); err != nil {
		writeHandlerError(ctx, span, w, "delete_cost_center", err)
		return
	}
	httpx.WriteJSON(w, http.StatusNoContent, nil)
}
