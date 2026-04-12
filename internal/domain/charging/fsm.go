package charging

import "github.com/ev-dev-labs/teslasync/internal/domain/fsm"

// Charging session FSM states.
const (
	StatePending    fsm.State = "pending"
	StateConnecting fsm.State = "connecting"
	StateCharging   fsm.State = "charging"
	StateCompleting fsm.State = "completing"
	StateCompleted  fsm.State = "completed"
	StateFailed     fsm.State = "failed"
)

// Charging session FSM events.
const (
	EventConnect     fsm.Event = "connect"
	EventStartCharge fsm.Event = "start_charge"
	EventComplete    fsm.Event = "complete"
	EventFail        fsm.Event = "fail"
	EventRetry       fsm.Event = "retry"
)

// NewChargingFSM creates the charging session state machine definition.
func NewChargingFSM() *fsm.Definition {
	return fsm.NewDefinition("charging_session").
		InitialState(StatePending).
		// Normal flow
		Transition(StatePending, EventConnect, StateConnecting).
		Transition(StateConnecting, EventStartCharge, StateCharging).
		Transition(StateCharging, EventComplete, StateCompleting).
		Transition(StateCompleting, EventComplete, StateCompleted).
		// Failure from any active state
		Transition(StatePending, EventFail, StateFailed).
		Transition(StateConnecting, EventFail, StateFailed).
		Transition(StateCharging, EventFail, StateFailed).
		Transition(StateCompleting, EventFail, StateFailed).
		// Retry from failed
		Transition(StateFailed, EventRetry, StatePending).
		Build()
}
