package fsm

import "errors"

var (
	// ErrInvalidTransition is returned when no transition exists for the given state+event.
	ErrInvalidTransition = errors.New("invalid state transition")

	// ErrGuardRejected is returned when a guard prevents the transition.
	ErrGuardRejected = errors.New("transition guard rejected")

	// ErrNoSubFSM is returned when FireSub is called for a state with no SubFSM.
	ErrNoSubFSM = errors.New("no SubFSM registered for state")

	// ErrSubFSMInactive is returned when FireSub is called on an inactive SubFSM.
	ErrSubFSMInactive = errors.New("SubFSM is not active")

	// ErrDuplicateTransition is returned when the same From+Event pair is registered twice.
	ErrDuplicateTransition = errors.New("duplicate transition")

	// ErrNoInitialState is returned when Build() is called without setting an initial state.
	ErrNoInitialState = errors.New("no initial state set")
)
