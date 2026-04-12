package fsm

import "context"

// State represents a named state in the machine.
type State string

// Event represents a trigger that may cause a state transition.
type Event string

// Guard is a predicate that must return true for a transition to proceed.
// Guards receive the transition context and can inspect the entity being transitioned.
// Guards must be pure — no side effects.
type Guard[T any] func(ctx context.Context, entity T, event Event) (bool, error)

// Action is a side-effect executed during a transition.
// Actions are NOT allowed to change the FSM state — they react to transitions.
type Action[T any] func(ctx context.Context, entity T, transition Transition) error

// Transition describes a single allowed state change.
type Transition struct {
	From  State
	Event Event
	To    State
}

// HookType defines when a hook fires relative to a transition.
type HookType int

const (
	// BeforeTransition fires before state change (can abort via error).
	BeforeTransition HookType = iota
	// AfterTransition fires after state change (cannot abort — state already changed).
	AfterTransition
	// OnEnterState fires when entering a state (any transition into it).
	OnEnterState
	// OnExitState fires when leaving a state (any transition out of it).
	OnExitState
)

// TransitionRecord captures a completed transition for audit/history.
type TransitionRecord struct {
	FSMName  string
	From     State
	Event    Event
	To       State
}
