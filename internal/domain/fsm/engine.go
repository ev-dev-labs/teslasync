package fsm

import (
	"context"
	"fmt"
)

// Engine is a generic, type-safe FSM engine that validates transitions,
// enforces guards, fires hooks, and supports SubFSMs.
type Engine[T any] struct {
	definition *Definition
	guards     map[transitionKey][]Guard[T]
	hooks      map[HookType]map[State][]Action[T]
	transHooks map[HookType]map[transitionKey][]Action[T]
	subFSMs    map[State]*SubFSMInstance
	tracer     Tracer
}

// Tracer is an optional interface for tracing FSM transitions.
// If not set, tracing is a no-op. This avoids importing OTel in the domain layer.
type Tracer interface {
	StartSpan(ctx context.Context, name string, attrs map[string]string) (context.Context, SpanEnder)
}

// SpanEnder ends a trace span.
type SpanEnder interface {
	End()
	SetAttribute(key, value string)
}

// noopTracer is the default when no tracer is configured.
type noopTracer struct{}

func (noopTracer) StartSpan(ctx context.Context, _ string, _ map[string]string) (context.Context, SpanEnder) {
	return ctx, noopSpan{}
}

type noopSpan struct{}

func (noopSpan) End()                        {}
func (noopSpan) SetAttribute(_, _ string)    {}

// NewEngine creates an FSM engine for a specific entity type.
func NewEngine[T any](def *Definition) *Engine[T] {
	return &Engine[T]{
		definition: def,
		guards:     make(map[transitionKey][]Guard[T]),
		hooks: map[HookType]map[State][]Action[T]{
			OnEnterState:     {},
			OnExitState:      {},
			BeforeTransition: {},
			AfterTransition:  {},
		},
		transHooks: map[HookType]map[transitionKey][]Action[T]{
			BeforeTransition: {},
			AfterTransition:  {},
		},
		subFSMs: make(map[State]*SubFSMInstance),
		tracer:  noopTracer{},
	}
}

// SetTracer configures a tracer for FSM operations.
func (e *Engine[T]) SetTracer(t Tracer) {
	if t != nil {
		e.tracer = t
	}
}

// Definition returns the underlying FSM definition.
func (e *Engine[T]) Definition() *Definition {
	return e.definition
}

// AddGuard registers a guard for a specific transition.
func (e *Engine[T]) AddGuard(t Transition, g Guard[T]) {
	key := transitionKey{t.From, t.Event}
	e.guards[key] = append(e.guards[key], g)
}

// OnEnter registers an action to execute when entering a state.
func (e *Engine[T]) OnEnter(state State, action Action[T]) {
	e.hooks[OnEnterState][state] = append(e.hooks[OnEnterState][state], action)
}

// OnExit registers an action to execute when exiting a state.
func (e *Engine[T]) OnExit(state State, action Action[T]) {
	e.hooks[OnExitState][state] = append(e.hooks[OnExitState][state], action)
}

// BeforeTransitionHook registers an action to execute before a specific transition.
func (e *Engine[T]) BeforeTransitionHook(t Transition, action Action[T]) {
	key := transitionKey{t.From, t.Event}
	e.transHooks[BeforeTransition][key] = append(e.transHooks[BeforeTransition][key], action)
}

// AfterTransitionHook registers an action to execute after a specific transition.
func (e *Engine[T]) AfterTransitionHook(t Transition, action Action[T]) {
	key := transitionKey{t.From, t.Event}
	e.transHooks[AfterTransition][key] = append(e.transHooks[AfterTransition][key], action)
}

// Fire attempts a state transition. Returns the new state or an error.
//
// Execution order:
//  1. Look up transition in definition
//  2. Evaluate all guards (ALL must pass)
//  3. Fire OnExit hooks for current state
//  4. Fire BeforeTransition hooks
//  5. State changes (caller persists)
//  6. Fire AfterTransition hooks (errors logged, not returned)
//  7. Fire OnEnter hooks for new state (errors logged, not returned)
func (e *Engine[T]) Fire(ctx context.Context, entity T, currentState State, event Event) (State, error) {
	ctx, span := e.tracer.StartSpan(ctx, "FSM.Fire", map[string]string{
		"fsm.name":          e.definition.Name,
		"fsm.current_state": string(currentState),
		"fsm.event":         string(event),
	})
	defer span.End()

	// 1. Look up transition
	transition, ok := e.definition.FindTransition(currentState, event)
	if !ok {
		return currentState, fmt.Errorf(
			"fsm %s: no transition from %s on event %s: %w",
			e.definition.Name, currentState, event, ErrInvalidTransition,
		)
	}

	key := transitionKey{currentState, event}

	// 2. Evaluate guards — ALL must pass
	for _, guard := range e.guards[key] {
		allowed, err := guard(ctx, entity, event)
		if err != nil {
			return currentState, fmt.Errorf("fsm %s guard error: %w", e.definition.Name, err)
		}
		if !allowed {
			return currentState, fmt.Errorf(
				"fsm %s: guard rejected transition %s -[%s]-> %s: %w",
				e.definition.Name, currentState, event, transition.To, ErrGuardRejected,
			)
		}
	}

	// 3. Fire OnExit hooks for current state
	if err := e.fireStateHooks(ctx, entity, OnExitState, currentState, transition); err != nil {
		return currentState, fmt.Errorf("fsm %s on_exit hook: %w", e.definition.Name, err)
	}

	// 4. Fire BeforeTransition hooks
	if err := e.fireTransHooks(ctx, entity, BeforeTransition, key, transition); err != nil {
		return currentState, fmt.Errorf("fsm %s before_transition hook: %w", e.definition.Name, err)
	}

	// 5. State change
	newState := transition.To

	// 6. Fire AfterTransition hooks (errors are non-fatal after state change)
	_ = e.fireTransHooks(ctx, entity, AfterTransition, key, transition)

	// 7. Fire OnEnter hooks for new state (errors are non-fatal after state change)
	_ = e.fireStateHooks(ctx, entity, OnEnterState, newState, transition)

	span.SetAttribute("fsm.new_state", string(newState))
	return newState, nil
}

// CanFire checks whether a transition is possible without executing it.
func (e *Engine[T]) CanFire(currentState State, event Event) bool {
	_, ok := e.definition.FindTransition(currentState, event)
	return ok
}

// AvailableEvents returns all events that can be fired from the given state.
func (e *Engine[T]) AvailableEvents(currentState State) []Event {
	var events []Event
	for key, _ := range e.definition.transitions {
		if key.from == currentState {
			events = append(events, key.event)
		}
	}
	return events
}

func (e *Engine[T]) fireStateHooks(ctx context.Context, entity T, hookType HookType, state State, t Transition) error {
	hooks, ok := e.hooks[hookType][state]
	if !ok {
		return nil
	}
	for _, action := range hooks {
		if err := action(ctx, entity, t); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine[T]) fireTransHooks(ctx context.Context, entity T, hookType HookType, key transitionKey, t Transition) error {
	hooks, ok := e.transHooks[hookType][key]
	if !ok {
		return nil
	}
	for _, action := range hooks {
		if err := action(ctx, entity, t); err != nil {
			return err
		}
	}
	return nil
}
