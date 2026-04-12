package notification

import "github.com/ev-dev-labs/teslasync/internal/domain/fsm"

// Notification FSM states.
const (
	StatePending  fsm.State = "pending"
	StateSending  fsm.State = "sending"
	StateSent     fsm.State = "sent"
	StateFailed   fsm.State = "failed"
	StateRetrying fsm.State = "retrying"
)

// Notification FSM events.
const (
	EventSend    fsm.Event = "send"
	EventConfirm fsm.Event = "confirm"
	EventFail    fsm.Event = "fail"
	EventRetry   fsm.Event = "retry"
)

// NewNotificationFSM creates the notification state machine definition.
func NewNotificationFSM() *fsm.Definition {
	return fsm.NewDefinition("notification").
		InitialState(StatePending).
		Transition(StatePending, EventSend, StateSending).
		Transition(StateSending, EventConfirm, StateSent).
		Transition(StateSending, EventFail, StateFailed).
		Transition(StateFailed, EventRetry, StateRetrying).
		Transition(StateRetrying, EventSend, StateSending).
		Build()
}
