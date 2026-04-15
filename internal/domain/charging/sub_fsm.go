package charging

import "github.com/ev-dev-labs/teslasync/internal/domain/fsm"

// Charging phase SubFSM states (within the "charging" parent state).
const (
	SubStateStarting fsm.State = "charging.starting"
	SubStateRamping  fsm.State = "charging.ramping"
	SubStateSteady   fsm.State = "charging.steady"
	SubStateTapering fsm.State = "charging.tapering"
	SubStateComplete fsm.State = "charging.complete"
)

// Charging phase SubFSM events.
const (
	SubEventHandshakeOK  fsm.Event = "handshake_ok"
	SubEventRampComplete fsm.Event = "ramp_complete"
	SubEventTaperStart   fsm.Event = "taper_start"
	SubEventTargetHit    fsm.Event = "target_hit"
	SubEventError        fsm.Event = "charge_error"
)

// NewChargingSubFSM creates the charging phase sub-state machine.
func NewChargingSubFSM() *fsm.Definition {
	return fsm.NewDefinition("charging_phase").
		InitialState(SubStateStarting).
		// Normal flow
		Transition(SubStateStarting, SubEventHandshakeOK, SubStateRamping).
		Transition(SubStateRamping, SubEventRampComplete, SubStateSteady).
		Transition(SubStateSteady, SubEventTaperStart, SubStateTapering).
		Transition(SubStateTapering, SubEventTargetHit, SubStateComplete).
		// Error from any active state
		Transition(SubStateStarting, SubEventError, SubStateComplete).
		Transition(SubStateRamping, SubEventError, SubStateComplete).
		Transition(SubStateSteady, SubEventError, SubStateComplete).
		Transition(SubStateTapering, SubEventError, SubStateComplete).
		Build()
}
