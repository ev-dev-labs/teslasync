package fsm

import "fmt"

// Definition is an immutable FSM definition with a transition table.
type Definition struct {
	Name         string
	InitialSt    State
	transitions  map[transitionKey]State
	allStates    map[State]bool
}

type transitionKey struct {
	from  State
	event Event
}

// FindTransition looks up the target state for a given (from, event) pair.
func (d *Definition) FindTransition(from State, event Event) (Transition, bool) {
	to, ok := d.transitions[transitionKey{from, event}]
	if !ok {
		return Transition{}, false
	}
	return Transition{From: from, Event: event, To: to}, true
}

// States returns all states referenced in the definition.
func (d *Definition) States() []State {
	states := make([]State, 0, len(d.allStates))
	for s := range d.allStates {
		states = append(states, s)
	}
	return states
}

// HasState returns true if the state exists in this definition.
func (d *Definition) HasState(s State) bool {
	return d.allStates[s]
}

// DefinitionBuilder provides a fluent API for constructing FSM definitions.
type DefinitionBuilder struct {
	name        string
	initialSt   State
	transitions map[transitionKey]State
	allStates   map[State]bool
	err         error
}

// NewDefinition starts building an FSM definition with the given name.
func NewDefinition(name string) *DefinitionBuilder {
	return &DefinitionBuilder{
		name:        name,
		transitions: make(map[transitionKey]State),
		allStates:   make(map[State]bool),
	}
}

// InitialState sets the initial state of the FSM.
func (b *DefinitionBuilder) InitialState(s State) *DefinitionBuilder {
	b.initialSt = s
	b.allStates[s] = true
	return b
}

// Transition registers an allowed state transition.
func (b *DefinitionBuilder) Transition(from State, event Event, to State) *DefinitionBuilder {
	if b.err != nil {
		return b
	}
	key := transitionKey{from, event}
	if _, exists := b.transitions[key]; exists {
		b.err = fmt.Errorf("fsm %s: transition from %s on event %s already defined: %w",
			b.name, from, event, ErrDuplicateTransition)
		return b
	}
	b.transitions[key] = to
	b.allStates[from] = true
	b.allStates[to] = true
	return b
}

// Build validates and returns the immutable Definition.
func (b *DefinitionBuilder) Build() *Definition {
	if b.err != nil {
		panic(b.err)
	}
	if b.initialSt == "" {
		panic(fmt.Errorf("fsm %s: %w", b.name, ErrNoInitialState))
	}
	return &Definition{
		Name:        b.name,
		InitialSt:   b.initialSt,
		transitions: b.transitions,
		allStates:   b.allStates,
	}
}

// MustBuild is like Build but returns an error instead of panicking.
func (b *DefinitionBuilder) MustBuild() (*Definition, error) {
	if b.err != nil {
		return nil, b.err
	}
	if b.initialSt == "" {
		return nil, fmt.Errorf("fsm %s: %w", b.name, ErrNoInitialState)
	}
	return &Definition{
		Name:        b.name,
		InitialSt:   b.initialSt,
		transitions: b.transitions,
		allStates:   b.allStates,
	}, nil
}
