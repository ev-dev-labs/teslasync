package fleetops

import (
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

type chargingPolicyRequest struct {
	VehicleID     int64                              `json:"vehicle_id"`
	Name          string                             `json:"name"`
	TargetSOCPct  int16                              `json:"target_soc_pct"`
	MaxPowerW     *float64                           `json:"max_power_w"`
	Priority      int16                              `json:"priority"`
	EffectiveFrom time.Time                          `json:"effective_from"`
	EffectiveTo   *time.Time                         `json:"effective_to"`
	Enabled       *bool                              `json:"enabled"`
	Version       int                                `json:"version"`
	Windows       []models.FleetChargingPolicyWindow `json:"windows"`
}

func policyFromRequest(id int64, req chargingPolicyRequest, create bool) models.FleetChargingPolicy {
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if !create && req.Enabled == nil {
		enabled = false
	}
	return models.FleetChargingPolicy{
		ID: id, VehicleID: req.VehicleID, Name: req.Name,
		TargetSOCPct: req.TargetSOCPct, MaxPowerW: req.MaxPowerW,
		Priority: req.Priority, EffectiveFrom: req.EffectiveFrom,
		EffectiveTo: req.EffectiveTo, Enabled: enabled, Version: req.Version,
		Windows: req.Windows,
	}
}

func (h *Handler) ListChargingPolicies(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "list_charging_policies")
	defer span.End()
	vehicleID, err := optionalID(r.URL.Query().Get("vehicle_id"), "vehicle_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_charging_policies", err)
		return
	}
	enabled, err := optionalBool(r.URL.Query().Get("enabled"), "enabled")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_charging_policies", err)
		return
	}
	activeAt, err := optionalTime(r.URL.Query().Get("active_at"), "active_at")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_charging_policies", err)
		return
	}
	limit, offset := listPage(r)
	page, err := h.service.ListChargingPolicies(ctx, dbfleetops.ChargingPolicyFilter{
		VehicleID: vehicleID, Enabled: enabled, ActiveAt: activeAt, Limit: limit, Offset: offset,
	})
	if err != nil {
		writeHandlerError(ctx, span, w, "list_charging_policies", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) GetChargingPolicy(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "get_charging_policy")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := h.service.GetChargingPolicy(ctx, id)
	if err != nil {
		writeHandlerError(ctx, span, w, "get_charging_policy", err)
		return
	}
	if item == nil {
		writeNotFound(w, "charging policy")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) CreateChargingPolicy(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "create_charging_policy")
	defer span.End()
	var req chargingPolicyRequest
	if !decodeBody(w, r, &req) {
		return
	}
	if req.VehicleID <= 0 || !requiredText(req.Name) || req.TargetSOCPct <= 0 ||
		req.EffectiveFrom.IsZero() || len(req.Windows) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id, name, target_soc_pct, effective_from, and windows are required")
		return
	}
	item := policyFromRequest(0, req, true)
	if err := h.service.CreateChargingPolicy(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "create_charging_policy", err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdateChargingPolicy(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "update_charging_policy")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req chargingPolicyRequest
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Enabled == nil || req.Version <= 0 || req.VehicleID <= 0 ||
		!requiredText(req.Name) || req.TargetSOCPct <= 0 ||
		req.EffectiveFrom.IsZero() || len(req.Windows) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "all policy fields, enabled, version, and at least one window are required")
		return
	}
	item := policyFromRequest(id, req, false)
	if err := h.service.UpdateChargingPolicy(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "update_charging_policy", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) DeleteChargingPolicy(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "delete_charging_policy")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteChargingPolicy(ctx, id, version); err != nil {
		writeHandlerError(ctx, span, w, "delete_charging_policy", err)
		return
	}
	httpx.WriteJSON(w, http.StatusNoContent, nil)
}

func (h *Handler) ListWorkOrders(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "list_work_orders")
	defer span.End()
	vehicleID, err := optionalID(r.URL.Query().Get("vehicle_id"), "vehicle_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_work_orders", err)
		return
	}
	costCenterID, err := optionalID(r.URL.Query().Get("cost_center_id"), "cost_center_id")
	if err != nil {
		writeHandlerError(ctx, span, w, "list_work_orders", err)
		return
	}
	status := r.URL.Query().Get("status")
	if !validEnum(status, "open", "scheduled", "in_progress", "completed", "cancelled") {
		httpx.WriteError(w, http.StatusBadRequest, "invalid work order status")
		return
	}
	severity := r.URL.Query().Get("severity")
	if !validEnum(severity, "low", "medium", "high", "critical") {
		httpx.WriteError(w, http.StatusBadRequest, "invalid work order severity")
		return
	}
	limit, offset := listPage(r)
	page, err := h.service.ListWorkOrders(ctx, dbfleetops.WorkOrderFilter{
		VehicleID: vehicleID, CostCenterID: costCenterID, Status: status,
		Severity: severity, Limit: limit, Offset: offset,
	})
	if err != nil {
		writeHandlerError(ctx, span, w, "list_work_orders", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) GetWorkOrder(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "get_work_order")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := h.service.GetWorkOrder(ctx, id)
	if err != nil {
		writeHandlerError(ctx, span, w, "get_work_order", err)
		return
	}
	if item == nil {
		writeNotFound(w, "work order")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) CreateWorkOrder(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "create_work_order")
	defer span.End()
	var item models.FleetMaintenanceWorkOrder
	if !decodeBody(w, r, &item) {
		return
	}
	if item.VehicleID <= 0 || !requiredText(item.Title) {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id and title are required")
		return
	}
	if err := h.service.CreateWorkOrder(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "create_work_order", err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdateWorkOrder(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "update_work_order")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var item models.FleetMaintenanceWorkOrder
	if !decodeBody(w, r, &item) {
		return
	}
	if item.VehicleID <= 0 || !requiredText(item.Title) || item.Version <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id, title, and version are required")
		return
	}
	item.ID = id
	if err := h.service.UpdateWorkOrder(ctx, &item); err != nil {
		writeHandlerError(ctx, span, w, "update_work_order", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) DeleteWorkOrder(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "delete_work_order")
	defer span.End()
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteWorkOrder(ctx, id, version); err != nil {
		writeHandlerError(ctx, span, w, "delete_work_order", err)
		return
	}
	httpx.WriteJSON(w, http.StatusNoContent, nil)
}
