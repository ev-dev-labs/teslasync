package vehicle

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

func TestVehicleFSM_ValidTransitions(t *testing.T) {
	def := NewVehicleFSM()
	engine := fsm.NewEngine[*Vehicle](def)
	ctx := context.Background()
	v := &Vehicle{ID: "v1", VIN: "5YJ3E1EA7KF123456"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
		want  fsm.State
	}{
		{"unknown → online", StateUnknown, EventComeOnline, StateOnline},
		{"online → driving", StateOnline, EventStartDrive, StateDriving},
		{"online → charging", StateOnline, EventPlugIn, StateCharging},
		{"online → asleep", StateOnline, EventSleep, StateAsleep},
		{"online → offline", StateOnline, EventGoOffline, StateOffline},
		{"driving → online", StateDriving, EventStopDrive, StateOnline},
		{"driving → charging", StateDriving, EventPlugIn, StateCharging},
		{"charging → online", StateCharging, EventUnplug, StateOnline},
		{"asleep → online", StateAsleep, EventWake, StateOnline},
		{"asleep → offline", StateAsleep, EventGoOffline, StateOffline},
		{"offline → online", StateOffline, EventComeOnline, StateOnline},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := engine.Fire(ctx, v, tt.from, tt.event)
			if err != nil {
				t.Fatalf("Fire() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Fire() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestVehicleFSM_InvalidTransitions(t *testing.T) {
	def := NewVehicleFSM()
	engine := fsm.NewEngine[*Vehicle](def)
	ctx := context.Background()
	v := &Vehicle{ID: "v1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
	}{
		{"unknown cannot sleep", StateUnknown, EventSleep},
		{"asleep cannot drive", StateAsleep, EventStartDrive},
		{"driving cannot sleep", StateDriving, EventSleep},
		{"charging cannot drive", StateCharging, EventStartDrive},
		{"offline cannot drive", StateOffline, EventStartDrive},
		{"offline cannot sleep", StateOffline, EventSleep},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := engine.Fire(ctx, v, tt.from, tt.event)
			if err == nil {
				t.Error("expected error for invalid transition")
			}
			if !errors.Is(err, fsm.ErrInvalidTransition) {
				t.Errorf("expected ErrInvalidTransition, got: %v", err)
			}
		})
	}
}

func TestVehicleGuards(t *testing.T) {
	ctx := context.Background()

	t.Run("CanStartDrive_online", func(t *testing.T) {
		v := &Vehicle{FSMState: StateOnline}
		ok, err := CanStartDrive(ctx, v, EventStartDrive)
		if err != nil || !ok {
			t.Error("expected CanStartDrive to pass for online vehicle")
		}
	})

	t.Run("CanStartDrive_asleep", func(t *testing.T) {
		v := &Vehicle{FSMState: StateAsleep}
		ok, err := CanStartDrive(ctx, v, EventStartDrive)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ok {
			t.Error("expected CanStartDrive to reject asleep vehicle")
		}
	})

	t.Run("CanPlugIn_online", func(t *testing.T) {
		v := &Vehicle{FSMState: StateOnline}
		ok, err := CanPlugIn(ctx, v, EventPlugIn)
		if err != nil || !ok {
			t.Error("expected CanPlugIn to pass for online vehicle")
		}
	})

	t.Run("CanPlugIn_driving", func(t *testing.T) {
		v := &Vehicle{FSMState: StateDriving}
		ok, err := CanPlugIn(ctx, v, EventPlugIn)
		if err != nil || !ok {
			t.Error("expected CanPlugIn to pass for driving vehicle")
		}
	})

	t.Run("CanSleep_online", func(t *testing.T) {
		v := &Vehicle{FSMState: StateOnline}
		ok, err := CanSleep(ctx, v, EventSleep)
		if err != nil || !ok {
			t.Error("expected CanSleep to pass for online vehicle")
		}
	})

	t.Run("CanSleep_charging", func(t *testing.T) {
		v := &Vehicle{FSMState: StateCharging}
		ok, err := CanSleep(ctx, v, EventSleep)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ok {
			t.Error("expected CanSleep to reject charging vehicle")
		}
	})
}

func TestValidation(t *testing.T) {
	tests := []struct {
		name    string
		vehicle Vehicle
		wantErr bool
	}{
		{
			name:    "valid vehicle",
			vehicle: Vehicle{VIN: "5YJ3E1EA7KF123456", Year: 2020, DisplayName: "My Tesla"},
			wantErr: false,
		},
		{
			name:    "invalid VIN length",
			vehicle: Vehicle{VIN: "short", Year: 2020, DisplayName: "My Tesla"},
			wantErr: true,
		},
		{
			name:    "VIN with invalid chars",
			vehicle: Vehicle{VIN: "5YJ3E1EA7KF12345O", Year: 2020, DisplayName: "My Tesla"},
			wantErr: true,
		},
		{
			name:    "year too old",
			vehicle: Vehicle{VIN: "5YJ3E1EA7KF123456", Year: 2010, DisplayName: "My Tesla"},
			wantErr: true,
		},
		{
			name:    "empty display name",
			vehicle: Vehicle{VIN: "5YJ3E1EA7KF123456", Year: 2020, DisplayName: ""},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.vehicle.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestDetectModelFromVIN(t *testing.T) {
	tests := []struct {
		vin  string
		want string
	}{
		{"5YJS1234567890123", "Model S"},
		{"5YJ31234567890123", "Model 3"},
		{"5YJX1234567890123", "Model X"},
		{"7SAY1234567890123", "Model Y"},
		{"abc", "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := DetectModelFromVIN(tt.vin)
			if got != tt.want {
				t.Errorf("DetectModelFromVIN(%q) = %q, want %q", tt.vin, got, tt.want)
			}
		})
	}
}
