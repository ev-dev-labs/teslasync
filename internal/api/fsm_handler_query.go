package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/fsm"
	"github.com/ev-dev-labs/teslasync/internal/fsm/charge"
	"github.com/ev-dev-labs/teslasync/internal/fsm/drive"
	"github.com/go-chi/chi/v5"
)

// CurrentState returns the FSM state for a vehicle.
func (h *FSMHandler) CurrentState(vehicleID int64) string {
	h.mu.Lock()
	m, exists := h.machines[vehicleID]
	h.mu.Unlock()
	if !exists {
		return ""
	}
	return string(m.Current())
}

// ActiveDrive returns the drive sub-FSM context for a vehicle, if active.
func (h *FSMHandler) ActiveDrive(vehicleID int64) *drive.Context {
	h.mu.Lock()
	d, ok := h.drives[vehicleID]
	h.mu.Unlock()
	if !ok {
		return nil
	}
	ctx := d.Context()
	return &ctx
}

// ActiveDriveState returns the state and context of the active drive sub-FSM.
func (h *FSMHandler) ActiveDriveState(vehicleID int64) (string, *drive.Context) {
	h.mu.Lock()
	d, ok := h.drives[vehicleID]
	h.mu.Unlock()
	if !ok {
		return "", nil
	}
	ctx := d.Context()
	return string(d.State()), &ctx
}

// ActiveCharge returns the charge sub-FSM context for a vehicle, if active.
func (h *FSMHandler) ActiveCharge(vehicleID int64) *charge.Context {
	h.mu.Lock()
	c, ok := h.charges[vehicleID]
	h.mu.Unlock()
	if !ok {
		return nil
	}
	ctx := c.Context()
	return &ctx
}

// ActiveChargeState returns the state and context of the active charge sub-FSM.
func (h *FSMHandler) ActiveChargeState(vehicleID int64) (string, *charge.Context) {
	h.mu.Lock()
	c, ok := h.charges[vehicleID]
	h.mu.Unlock()
	if !ok {
		return "", nil
	}
	ctx := c.Context()
	return string(c.State()), &ctx
}

// Stats returns the number of active FSM instances.
func (h *FSMHandler) Stats() map[string]int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return map[string]int{
		"vehicles": len(h.machines),
		"drives":   len(h.drives),
		"charges":  len(h.charges),
	}
}

// VehicleSnapshots returns one snapshot per known vehicle FSM.
func (h *FSMHandler) VehicleSnapshots() []VehicleFSMSnapshot {
	h.mu.Lock()
	machines := make(map[int64]*fsm.VehicleFSM, len(h.machines))
	for id, m := range h.machines {
		machines[id] = m
	}
	h.mu.Unlock()

	now := time.Now()
	out := make([]VehicleFSMSnapshot, 0, len(machines))
	for id, m := range machines {
		last := m.LastTransitionAt()
		out = append(out, VehicleFSMSnapshot{
			VehicleID:                  id,
			State:                      string(m.Current()),
			LastTransitionAt:           last,
			SecondsSinceLastTransition: now.Sub(last).Seconds(),
			IsGearCapable:              m.IsGearCapable(),
		})
	}
	return out
}

// HandleDebug returns diagnostic FSM information for a vehicle.
func (h *FSMHandler) HandleDebug(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := chi.URLParam(r, "vehicleID")
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	h.mu.Lock()
	m := h.machines[vehicleID]
	_, hasDrive := h.drives[vehicleID]
	_, hasCharge := h.charges[vehicleID]
	lastProc := h.lastProcessed[vehicleID]
	store := h.localSignals
	h.mu.Unlock()

	if m == nil {
		writeError(w, http.StatusNotFound, "no FSM for vehicle")
		return
	}

	resp := FSMDebugResponse{
		VehicleID:       vehicleID,
		FSM:             m.DebugInfo(),
		HasActiveDrive:  hasDrive,
		HasActiveCharge: hasCharge,
	}
	if !lastProc.IsZero() {
		resp.LastProcessedAt = &lastProc
	}

	if store != nil {
		result := fsm.DeriveExpectedState(vehicleID, store, time.Now())
		rd := &ReconcileDebug{
			Confidence: result.Confidence.String(),
			Reason:     result.Reason,
		}
		if result.Confidence > fsm.ConfidenceNone {
			rd.ExpectedState = string(result.ExpectedState)
			rd.FreshestAt = result.FreshestAt.Format(time.RFC3339)
			rd.Mismatch = result.ExpectedState != fsm.State(resp.FSM.CurrentState)
		}
		resp.Reconciliation = rd
	}

	writeJSON(w, http.StatusOK, resp)
}
