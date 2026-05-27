package fsm

import (
	"context"
	"fmt"
)

// SubFSMConfig configures how a SubFSM relates to its parent state.
type SubFSMConfig struct {
	// TerminalStates lists SubFSM states that signal completion to the parent.
	TerminalStates []State
	// OnTerminalEvent is the event fired on the PARENT engine when the SubFSM
	// reaches a terminal state.
	OnTerminalEvent Event
	// ResetOnExit: if true, SubFSM resets to its initial state when the parent
	// exits the state that owns this SubFSM.
	ResetOnExit bool
}

// SubFSMInstance tracks the runtime state of an active SubFSM.
type SubFSMInstance struct {
	Definition   *Definition
	Config       SubFSMConfig
	CurrentState State
	Active       bool
}

// RegisterSubFSM attaches a SubFSM to a specific parent state.
// When the parent enters that state, the SubFSM is activated.
// When the parent exits, the SubFSM is deactivated (and optionally reset).
func (e *Engine[T]) RegisterSubFSM(parentState State, subDef *Definition, config SubFSMConfig) {
	e.subFSMs[parentState] = &SubFSMInstance{
		Definition:   subDef,
		Config:       config,
		CurrentState: subDef.InitialSt,
		Active:       false,
	}

	// Auto-activate SubFSM when entering the parent state
	e.OnEnter(parentState, func(ctx context.Context, entity T, t Transition) error {
		sub := e.subFSMs[parentState]
		sub.Active = true
		sub.CurrentState = sub.Definition.InitialSt
		return nil
	})

	// Auto-deactivate SubFSM when exiting the parent state
	e.OnExit(parentState, func(ctx context.Context, entity T, t Transition) error {
		sub := e.subFSMs[parentState]
		if sub.Active && config.ResetOnExit {
			sub.Active = false
			sub.CurrentState = sub.Definition.InitialSt
		}
		return nil
	})
}

// GetSubFSM returns the SubFSM instance for a given parent state, if registered.
func (e *Engine[T]) GetSubFSM(parentState State) (*SubFSMInstance, bool) {
	sub, ok := e.subFSMs[parentState]
	return sub, ok
}

// FireSub attempts a state transition within an active SubFSM.
// If the SubFSM reaches a terminal state, it fires the configured event on the parent.
func (e *Engine[T]) FireSub(
	ctx context.Context,
	entity T,
	parentState State,
	subEvent Event,
) (State, error) {
	sub, ok := e.subFSMs[parentState]
	if !ok {
		return "", fmt.Errorf("no SubFSM registered for state %s: %w", parentState, ErrNoSubFSM)
	}
	if !sub.Active {
		return "", fmt.Errorf("SubFSM for state %s is not active: %w", parentState, ErrSubFSMInactive)
	}

	ctx, span := e.tracer.StartSpan(ctx, "SubFSM.Fire", map[string]string{
		"fsm.parent_state": string(parentState),
		"fsm.sub_name":     sub.Definition.Name,
		"fsm.sub_current":  string(sub.CurrentState),
		"fsm.sub_event":    string(subEvent),
	})
	defer span.End()

	transition, ok := sub.Definition.FindTransition(sub.CurrentState, subEvent)
	if !ok {
		err := fmt.Errorf(
			"SubFSM %s: no transition from %s on event %s: %w",
			sub.Definition.Name, sub.CurrentState, subEvent, ErrInvalidTransition,
		)
		span.RecordError(err)
		span.SetStatus(StatusError, "invalid_sub_transition")
		return sub.CurrentState, err
	}

	sub.CurrentState = transition.To
	newSubState := sub.CurrentState
	span.SetAttribute("fsm.sub_new_state", string(newSubState))

	// Check if SubFSM reached a terminal state → bubble up to parent.
	// We capture newSubState before firing the parent event because the parent's
	// OnExit hook may reset the SubFSM.
	for _, terminal := range sub.Config.TerminalStates {
		if newSubState == terminal {
			// Fire the parent transition (may reset SubFSM via OnExit hook)
			_, err := e.Fire(ctx, entity, parentState, sub.Config.OnTerminalEvent)
			if err != nil {
				// Parent.Fire already recorded its own error on the
				// inner span; surface the failure here too so the
				// SubFSM.Fire span is also marked red.
				span.RecordError(err)
				span.SetStatus(StatusError, "parent_transition_failed")
			} else {
				span.SetStatus(StatusOk, "")
			}
			return newSubState, err
		}
	}

	span.SetStatus(StatusOk, "")
	return newSubState, nil
}
