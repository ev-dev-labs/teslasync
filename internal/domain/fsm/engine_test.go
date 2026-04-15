package fsm

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// --- Definition Tests ---

func TestDefinition_Build(t *testing.T) {
	def := NewDefinition("test").
		InitialState("a").
		Transition("a", "go_b", "b").
		Transition("b", "go_c", "c").
		Build()

	if def.Name != "test" {
		t.Errorf("expected name 'test', got %q", def.Name)
	}
	if def.InitialSt != "a" {
		t.Errorf("expected initial state 'a', got %q", def.InitialSt)
	}
}

func TestDefinition_FindTransition(t *testing.T) {
	def := NewDefinition("test").
		InitialState("idle").
		Transition("idle", "start", "running").
		Transition("running", "stop", "idle").
		Build()

	tests := []struct {
		name      string
		from      State
		event     Event
		wantTo    State
		wantFound bool
	}{
		{"valid transition", "idle", "start", "running", true},
		{"valid transition back", "running", "stop", "idle", true},
		{"invalid - wrong state", "idle", "stop", "", false},
		{"invalid - unknown event", "idle", "unknown", "", false},
		{"invalid - unknown state", "unknown", "start", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans, found := def.FindTransition(tt.from, tt.event)
			if found != tt.wantFound {
				t.Errorf("FindTransition() found = %v, want %v", found, tt.wantFound)
			}
			if found && trans.To != tt.wantTo {
				t.Errorf("FindTransition() To = %q, want %q", trans.To, tt.wantTo)
			}
		})
	}
}

func TestDefinition_DuplicateTransition_Panics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Error("expected panic for duplicate transition")
		}
	}()
	NewDefinition("dup").
		InitialState("a").
		Transition("a", "go", "b").
		Transition("a", "go", "c").
		Build()
}

func TestDefinition_NoInitialState_Panics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Error("expected panic for missing initial state")
		}
	}()
	NewDefinition("noinit").
		Transition("a", "go", "b").
		Build()
}

func TestDefinition_MustBuild_Error(t *testing.T) {
	_, err := NewDefinition("noinit").
		Transition("a", "go", "b").
		MustBuild()
	if err == nil {
		t.Error("expected error from MustBuild with no initial state")
	}
	if !errors.Is(err, ErrNoInitialState) {
		t.Errorf("expected ErrNoInitialState, got %v", err)
	}
}

func TestDefinition_States(t *testing.T) {
	def := NewDefinition("test").
		InitialState("a").
		Transition("a", "go_b", "b").
		Transition("b", "go_c", "c").
		Build()

	states := def.States()
	if len(states) != 3 {
		t.Errorf("expected 3 states, got %d", len(states))
	}
	for _, s := range []State{"a", "b", "c"} {
		if !def.HasState(s) {
			t.Errorf("expected definition to have state %q", s)
		}
	}
}

// --- Engine Tests ---

type testEntity struct {
	ID   string
	Name string
}

func newTestFSM() *Definition {
	return NewDefinition("test_lifecycle").
		InitialState("idle").
		Transition("idle", "start", "running").
		Transition("running", "pause", "paused").
		Transition("running", "stop", "idle").
		Transition("paused", "resume", "running").
		Transition("paused", "stop", "idle").
		Build()
}

func TestEngine_Fire_ValidTransitions(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	entity := &testEntity{ID: "1", Name: "test"}
	ctx := context.Background()

	tests := []struct {
		name  string
		from  State
		event Event
		want  State
	}{
		{"idle to running", "idle", "start", "running"},
		{"running to paused", "running", "pause", "paused"},
		{"paused to running", "paused", "resume", "running"},
		{"running to idle", "running", "stop", "idle"},
		{"paused to idle", "paused", "stop", "idle"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := engine.Fire(ctx, entity, tt.from, tt.event)
			if err != nil {
				t.Fatalf("Fire() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Fire() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEngine_Fire_InvalidTransition(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1"}

	_, err := engine.Fire(ctx, entity, "idle", "stop")
	if err == nil {
		t.Fatal("expected error for invalid transition")
	}
	if !errors.Is(err, ErrInvalidTransition) {
		t.Errorf("expected ErrInvalidTransition, got: %v", err)
	}
}

func TestEngine_Fire_GuardRejects(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1"}

	// Add a guard that always rejects
	engine.AddGuard(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, event Event) (bool, error) {
			return false, nil
		},
	)

	_, err := engine.Fire(ctx, entity, "idle", "start")
	if err == nil {
		t.Fatal("expected error when guard rejects")
	}
	if !errors.Is(err, ErrGuardRejected) {
		t.Errorf("expected ErrGuardRejected, got: %v", err)
	}
}

func TestEngine_Fire_GuardPasses(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1", Name: "allowed"}

	engine.AddGuard(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, event Event) (bool, error) {
			return e.Name == "allowed", nil
		},
	)

	got, err := engine.Fire(ctx, entity, "idle", "start")
	if err != nil {
		t.Fatalf("Fire() error: %v", err)
	}
	if got != "running" {
		t.Errorf("Fire() = %q, want 'running'", got)
	}
}

func TestEngine_Fire_GuardError(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1"}

	engine.AddGuard(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, event Event) (bool, error) {
			return false, fmt.Errorf("db connection failed")
		},
	)

	_, err := engine.Fire(ctx, entity, "idle", "start")
	if err == nil {
		t.Fatal("expected error from guard")
	}
}

func TestEngine_Fire_MultipleGuards_AllMustPass(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1"}

	callCount := 0
	engine.AddGuard(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, event Event) (bool, error) {
			callCount++
			return true, nil
		},
	)
	engine.AddGuard(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, event Event) (bool, error) {
			callCount++
			return false, nil // second guard rejects
		},
	)

	_, err := engine.Fire(ctx, entity, "idle", "start")
	if err == nil {
		t.Fatal("expected error when second guard rejects")
	}
	if callCount != 2 {
		t.Errorf("expected both guards called, got %d calls", callCount)
	}
}

func TestEngine_Fire_HookExecutionOrder(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1"}

	var order []string

	engine.OnExit("idle", func(ctx context.Context, e *testEntity, t Transition) error {
		order = append(order, "on_exit_idle")
		return nil
	})
	engine.BeforeTransitionHook(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, t Transition) error {
			order = append(order, "before_transition")
			return nil
		},
	)
	engine.AfterTransitionHook(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, t Transition) error {
			order = append(order, "after_transition")
			return nil
		},
	)
	engine.OnEnter("running", func(ctx context.Context, e *testEntity, t Transition) error {
		order = append(order, "on_enter_running")
		return nil
	})

	_, err := engine.Fire(ctx, entity, "idle", "start")
	if err != nil {
		t.Fatalf("Fire() error: %v", err)
	}

	expected := []string{"on_exit_idle", "before_transition", "after_transition", "on_enter_running"}
	if len(order) != len(expected) {
		t.Fatalf("expected %d hook calls, got %d: %v", len(expected), len(order), order)
	}
	for i, want := range expected {
		if order[i] != want {
			t.Errorf("hook[%d] = %q, want %q", i, order[i], want)
		}
	}
}

func TestEngine_Fire_OnExitError_AbortTransition(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1"}

	engine.OnExit("idle", func(ctx context.Context, e *testEntity, t Transition) error {
		return fmt.Errorf("cleanup failed")
	})

	state, err := engine.Fire(ctx, entity, "idle", "start")
	if err == nil {
		t.Fatal("expected error from on_exit hook")
	}
	if state != "idle" {
		t.Errorf("state should remain 'idle' on error, got %q", state)
	}
}

func TestEngine_Fire_BeforeTransitionError_AbortTransition(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())
	ctx := context.Background()
	entity := &testEntity{ID: "1"}

	engine.BeforeTransitionHook(
		Transition{From: "idle", Event: "start", To: "running"},
		func(ctx context.Context, e *testEntity, t Transition) error {
			return fmt.Errorf("precondition failed")
		},
	)

	state, err := engine.Fire(ctx, entity, "idle", "start")
	if err == nil {
		t.Fatal("expected error from before_transition hook")
	}
	if state != "idle" {
		t.Errorf("state should remain 'idle' on error, got %q", state)
	}
}

func TestEngine_CanFire(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())

	if !engine.CanFire("idle", "start") {
		t.Error("expected CanFire(idle, start) = true")
	}
	if engine.CanFire("idle", "stop") {
		t.Error("expected CanFire(idle, stop) = false")
	}
}

func TestEngine_AvailableEvents(t *testing.T) {
	engine := NewEngine[*testEntity](newTestFSM())

	events := engine.AvailableEvents("running")
	if len(events) != 2 {
		t.Errorf("expected 2 events from 'running', got %d", len(events))
	}

	eventSet := make(map[Event]bool)
	for _, e := range events {
		eventSet[e] = true
	}
	if !eventSet["pause"] || !eventSet["stop"] {
		t.Errorf("expected events [pause, stop], got %v", events)
	}
}

// --- SubFSM Tests ---

func newParentFSM() *Definition {
	return NewDefinition("parent").
		InitialState("idle").
		Transition("idle", "activate", "active").
		Transition("active", "deactivate", "idle").
		Transition("active", "complete", "done").
		Build()
}

func newChildFSM() *Definition {
	return NewDefinition("child").
		InitialState("step1").
		Transition("step1", "next", "step2").
		Transition("step2", "finish", "finished").
		Build()
}

func TestSubFSM_ActivateOnParentEnter(t *testing.T) {
	engine := NewEngine[*testEntity](newParentFSM())
	entity := &testEntity{ID: "1"}
	ctx := context.Background()

	engine.RegisterSubFSM("active", newChildFSM(), SubFSMConfig{
		TerminalStates:  []State{"finished"},
		OnTerminalEvent: "complete",
		ResetOnExit:     true,
	})

	// Fire parent to "active"
	_, err := engine.Fire(ctx, entity, "idle", "activate")
	if err != nil {
		t.Fatalf("Fire() error: %v", err)
	}

	sub, ok := engine.GetSubFSM("active")
	if !ok {
		t.Fatal("expected SubFSM to be registered")
	}
	if !sub.Active {
		t.Error("expected SubFSM to be active after entering parent state")
	}
	if sub.CurrentState != "step1" {
		t.Errorf("expected SubFSM at initial state 'step1', got %q", sub.CurrentState)
	}
}

func TestSubFSM_FireSub_ValidTransitions(t *testing.T) {
	engine := NewEngine[*testEntity](newParentFSM())
	entity := &testEntity{ID: "1"}
	ctx := context.Background()

	engine.RegisterSubFSM("active", newChildFSM(), SubFSMConfig{
		TerminalStates:  []State{"finished"},
		OnTerminalEvent: "complete",
		ResetOnExit:     true,
	})

	// Activate parent
	_, _ = engine.Fire(ctx, entity, "idle", "activate")

	// Fire sub-transitions
	state, err := engine.FireSub(ctx, entity, "active", "next")
	if err != nil {
		t.Fatalf("FireSub() error: %v", err)
	}
	if state != "step2" {
		t.Errorf("FireSub() = %q, want 'step2'", state)
	}
}

func TestSubFSM_TerminalState_BubblesUp(t *testing.T) {
	parentDef := NewDefinition("parent").
		InitialState("idle").
		Transition("idle", "activate", "active").
		Transition("active", "complete", "done").
		Build()

	engine := NewEngine[*testEntity](parentDef)
	entity := &testEntity{ID: "1"}
	ctx := context.Background()

	engine.RegisterSubFSM("active", newChildFSM(), SubFSMConfig{
		TerminalStates:  []State{"finished"},
		OnTerminalEvent: "complete",
		ResetOnExit:     true,
	})

	// Activate parent
	_, _ = engine.Fire(ctx, entity, "idle", "activate")

	// Progress sub-FSM to step2
	_, _ = engine.FireSub(ctx, entity, "active", "next")

	// Finish sub-FSM → should trigger parent "complete" event
	subState, err := engine.FireSub(ctx, entity, "active", "finish")
	if err != nil {
		t.Fatalf("FireSub() error: %v", err)
	}
	if subState != "finished" {
		t.Errorf("SubFSM state = %q, want 'finished'", subState)
	}
}

func TestSubFSM_DeactivateOnParentExit(t *testing.T) {
	engine := NewEngine[*testEntity](newParentFSM())
	entity := &testEntity{ID: "1"}
	ctx := context.Background()

	engine.RegisterSubFSM("active", newChildFSM(), SubFSMConfig{
		TerminalStates:  []State{"finished"},
		OnTerminalEvent: "complete",
		ResetOnExit:     true,
	})

	// Activate and advance sub-FSM
	_, _ = engine.Fire(ctx, entity, "idle", "activate")
	_, _ = engine.FireSub(ctx, entity, "active", "next")

	// Deactivate parent
	_, err := engine.Fire(ctx, entity, "active", "deactivate")
	if err != nil {
		t.Fatalf("Fire() error: %v", err)
	}

	sub, _ := engine.GetSubFSM("active")
	if sub.Active {
		t.Error("expected SubFSM to be deactivated after parent exit")
	}
	if sub.CurrentState != "step1" {
		t.Errorf("expected SubFSM reset to initial state 'step1', got %q", sub.CurrentState)
	}
}

func TestSubFSM_FireSub_NoSubFSM(t *testing.T) {
	engine := NewEngine[*testEntity](newParentFSM())
	entity := &testEntity{ID: "1"}
	ctx := context.Background()

	_, err := engine.FireSub(ctx, entity, "idle", "next")
	if !errors.Is(err, ErrNoSubFSM) {
		t.Errorf("expected ErrNoSubFSM, got: %v", err)
	}
}

func TestSubFSM_FireSub_Inactive(t *testing.T) {
	engine := NewEngine[*testEntity](newParentFSM())
	entity := &testEntity{ID: "1"}
	ctx := context.Background()

	engine.RegisterSubFSM("active", newChildFSM(), SubFSMConfig{
		TerminalStates:  []State{"finished"},
		OnTerminalEvent: "complete",
		ResetOnExit:     true,
	})

	// Don't activate parent — sub-FSM should be inactive
	_, err := engine.FireSub(ctx, entity, "active", "next")
	if !errors.Is(err, ErrSubFSMInactive) {
		t.Errorf("expected ErrSubFSMInactive, got: %v", err)
	}
}

func TestSubFSM_FireSub_InvalidTransition(t *testing.T) {
	engine := NewEngine[*testEntity](newParentFSM())
	entity := &testEntity{ID: "1"}
	ctx := context.Background()

	engine.RegisterSubFSM("active", newChildFSM(), SubFSMConfig{
		TerminalStates:  []State{"finished"},
		OnTerminalEvent: "complete",
		ResetOnExit:     true,
	})

	_, _ = engine.Fire(ctx, entity, "idle", "activate")

	_, err := engine.FireSub(ctx, entity, "active", "finish") // can't finish from step1
	if !errors.Is(err, ErrInvalidTransition) {
		t.Errorf("expected ErrInvalidTransition, got: %v", err)
	}
}
