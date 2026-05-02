package api

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/fsm"
)

// VehicleFSMSnapshot is a point-in-time view of one vehicle's FSM state.
// Exposed via /fsm/stats so the frontend can flag FSMs that are stale despite
// the vehicle actively streaming telemetry.
type VehicleFSMSnapshot struct {
	VehicleID                  int64     `json:"vehicle_id"`
	State                      string    `json:"state"`
	LastTransitionAt           time.Time `json:"last_transition_at"`
	SecondsSinceLastTransition float64   `json:"seconds_since_last_transition"`
	IsGearCapable              bool      `json:"is_gear_capable"`
}

// FSMDebugResponse is the JSON response for the FSM debug endpoint.
type FSMDebugResponse struct {
	VehicleID       int64            `json:"vehicle_id"`
	FSM             fsm.FSMDebugInfo `json:"fsm"`
	LastProcessedAt *time.Time       `json:"last_processed_at,omitempty"`
	HasActiveDrive  bool             `json:"has_active_drive"`
	HasActiveCharge bool             `json:"has_active_charge"`
	Reconciliation  *ReconcileDebug  `json:"reconciliation,omitempty"`
}

// ReconcileDebug holds reconciliation diagnostics for the debug endpoint.
type ReconcileDebug struct {
	ExpectedState string `json:"expected_state"`
	Confidence    string `json:"confidence"`
	Reason        string `json:"reason"`
	FreshestAt    string `json:"freshest_at,omitempty"`
	Mismatch      bool   `json:"mismatch"`
}
