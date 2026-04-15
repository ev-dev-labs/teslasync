package charging

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

func TestChargingFSM_ValidTransitions(t *testing.T) {
	def := NewChargingFSM()
	engine := fsm.NewEngine[*ChargingSession](def)
	ctx := context.Background()
	s := &ChargingSession{ID: "cs1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
		want  fsm.State
	}{
		{"pending → connecting", StatePending, EventConnect, StateConnecting},
		{"connecting → charging", StateConnecting, EventStartCharge, StateCharging},
		{"charging → completing", StateCharging, EventComplete, StateCompleting},
		{"completing → completed", StateCompleting, EventComplete, StateCompleted},
		{"pending → failed", StatePending, EventFail, StateFailed},
		{"connecting → failed", StateConnecting, EventFail, StateFailed},
		{"charging → failed", StateCharging, EventFail, StateFailed},
		{"failed → pending (retry)", StateFailed, EventRetry, StatePending},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := engine.Fire(ctx, s, tt.from, tt.event)
			if err != nil {
				t.Fatalf("Fire() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Fire() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestChargingFSM_InvalidTransitions(t *testing.T) {
	def := NewChargingFSM()
	engine := fsm.NewEngine[*ChargingSession](def)
	ctx := context.Background()
	s := &ChargingSession{ID: "cs1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
	}{
		{"completed cannot retry", StateCompleted, EventRetry},
		{"pending cannot complete", StatePending, EventComplete},
		{"completed cannot fail", StateCompleted, EventFail},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := engine.Fire(ctx, s, tt.from, tt.event)
			if err == nil {
				t.Error("expected error for invalid transition")
			}
			if !errors.Is(err, fsm.ErrInvalidTransition) {
				t.Errorf("expected ErrInvalidTransition, got: %v", err)
			}
		})
	}
}

func TestChargingSubFSM_FullLifecycle(t *testing.T) {
	subDef := NewChargingSubFSM()
	ctx := context.Background()

	// Use the parent engine approach to test SubFSM
	parentDef := NewChargingFSM()
	engine := fsm.NewEngine[*ChargingSession](parentDef)

	engine.RegisterSubFSM(StateCharging, subDef, fsm.SubFSMConfig{
		TerminalStates:  []fsm.State{SubStateComplete},
		OnTerminalEvent: EventComplete,
		ResetOnExit:     true,
	})

	s := &ChargingSession{ID: "cs1"}

	// Progress to charging state
	_, _ = engine.Fire(ctx, s, StatePending, EventConnect)
	_, _ = engine.Fire(ctx, s, StateConnecting, EventStartCharge)

	// SubFSM should be active
	sub, ok := engine.GetSubFSM(StateCharging)
	if !ok || !sub.Active {
		t.Fatal("expected SubFSM to be active in charging state")
	}
	if sub.CurrentState != SubStateStarting {
		t.Errorf("expected sub-state 'charging.starting', got %q", sub.CurrentState)
	}

	// Progress through sub-states
	st, err := engine.FireSub(ctx, s, StateCharging, SubEventHandshakeOK)
	if err != nil {
		t.Fatalf("FireSub error: %v", err)
	}
	if st != SubStateRamping {
		t.Errorf("expected 'charging.ramping', got %q", st)
	}

	st, err = engine.FireSub(ctx, s, StateCharging, SubEventRampComplete)
	if err != nil {
		t.Fatalf("FireSub error: %v", err)
	}
	if st != SubStateSteady {
		t.Errorf("expected 'charging.steady', got %q", st)
	}

	st, err = engine.FireSub(ctx, s, StateCharging, SubEventTaperStart)
	if err != nil {
		t.Fatalf("FireSub error: %v", err)
	}
	if st != SubStateTapering {
		t.Errorf("expected 'charging.tapering', got %q", st)
	}

	// Target hit → triggers terminal → fires parent complete event
	st, err = engine.FireSub(ctx, s, StateCharging, SubEventTargetHit)
	if err != nil {
		t.Fatalf("FireSub error: %v", err)
	}
	if st != SubStateComplete {
		t.Errorf("expected 'charging.complete', got %q", st)
	}
}

func TestChargingSubFSM_ErrorFromAnyState(t *testing.T) {
	subDef := NewChargingSubFSM()

	tests := []struct {
		name      string
		fromState fsm.State
	}{
		{"error from starting", SubStateStarting},
		{"error from ramping", SubStateRamping},
		{"error from steady", SubStateSteady},
		{"error from tapering", SubStateTapering},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trans, ok := subDef.FindTransition(tt.fromState, SubEventError)
			if !ok {
				t.Errorf("expected error transition from %s", tt.fromState)
			}
			if trans.To != SubStateComplete {
				t.Errorf("expected transition to 'charging.complete', got %q", trans.To)
			}
		})
	}
}

func TestChargingGuards(t *testing.T) {
	ctx := context.Background()

	t.Run("CanStartCharging_connected_lowBattery", func(t *testing.T) {
		s := &ChargingSession{ChargerConnected: true, StartBatteryLevel: 50}
		ok, err := CanStartCharging(ctx, s, EventStartCharge)
		if err != nil || !ok {
			t.Error("expected guard to pass")
		}
	})

	t.Run("CanStartCharging_notConnected", func(t *testing.T) {
		s := &ChargingSession{ChargerConnected: false, StartBatteryLevel: 50}
		ok, _ := CanStartCharging(ctx, s, EventStartCharge)
		if ok {
			t.Error("expected guard to reject when not connected")
		}
	})

	t.Run("CanStartCharging_fullBattery", func(t *testing.T) {
		s := &ChargingSession{ChargerConnected: true, StartBatteryLevel: 100}
		ok, _ := CanStartCharging(ctx, s, EventStartCharge)
		if ok {
			t.Error("expected guard to reject when battery is full")
		}
	})

	t.Run("CanComplete_valid", func(t *testing.T) {
		s := &ChargingSession{EnergyAddedKWh: 10.5, StartBatteryLevel: 50, EndBatteryLevel: 80}
		ok, err := CanComplete(ctx, s, EventComplete)
		if err != nil || !ok {
			t.Error("expected guard to pass")
		}
	})

	t.Run("CanComplete_noEnergy", func(t *testing.T) {
		s := &ChargingSession{EnergyAddedKWh: 0, StartBatteryLevel: 50, EndBatteryLevel: 50}
		ok, _ := CanComplete(ctx, s, EventComplete)
		if ok {
			t.Error("expected guard to reject when no energy added")
		}
	})
}

func TestChargingValidation(t *testing.T) {
	tests := []struct {
		name    string
		session ChargingSession
		wantErr bool
	}{
		{
			name:    "valid session",
			session: ChargingSession{VehicleID: "v1", ChargerType: "dc", StartBatteryLevel: 50},
			wantErr: false,
		},
		{
			name:    "missing vehicle ID",
			session: ChargingSession{ChargerType: "ac"},
			wantErr: true,
		},
		{
			name:    "invalid charger type",
			session: ChargingSession{VehicleID: "v1", ChargerType: "wireless"},
			wantErr: true,
		},
		{
			name:    "invalid battery level",
			session: ChargingSession{VehicleID: "v1", StartBatteryLevel: 150},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.session.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
