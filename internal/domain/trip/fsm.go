package trip

import "github.com/ev-dev-labs/teslasync/internal/domain/fsm"

// Trip FSM states.
const (
	StateStarted    fsm.State = "started"
	StateInProgress fsm.State = "in_progress"
	StatePaused     fsm.State = "paused"
	StateCompleted  fsm.State = "completed"
	StateCancelled  fsm.State = "cancelled"
)

// Trip FSM events.
const (
	EventBegin    fsm.Event = "begin"
	EventPause    fsm.Event = "pause"
	EventResume   fsm.Event = "resume"
	EventComplete fsm.Event = "complete"
	EventCancel   fsm.Event = "cancel"
)

// NewTripFSM creates the trip state machine definition.
func NewTripFSM() *fsm.Definition {
	return fsm.NewDefinition("trip").
		InitialState(StateStarted).
		Transition(StateStarted, EventBegin, StateInProgress).
		Transition(StateInProgress, EventPause, StatePaused).
		Transition(StateInProgress, EventComplete, StateCompleted).
		Transition(StateInProgress, EventCancel, StateCancelled).
		Transition(StatePaused, EventResume, StateInProgress).
		Transition(StatePaused, EventCancel, StateCancelled).
		Transition(StateStarted, EventCancel, StateCancelled).
		Build()
}
