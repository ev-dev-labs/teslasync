package fsm

import (
	"testing"
	"time"

	"github.com/rs/zerolog"
	ftproto "github.com/teslamotors/fleet-telemetry/protos"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const testVehicleID int64 = 42

// newTestAdapter builds a SignalAdapter wired to a fresh signal.Store
// and a discarding logger so debug diagnostics never bleed into the
// test runner output.
func newTestAdapter(t *testing.T) (*SignalAdapter, *signal.Store) {
	t.Helper()
	store := signal.New()
	return NewSignalAdapter(store, zerolog.Nop()), store
}

func setSignal(t *testing.T, store *signal.Store, field string, value any) {
	t.Helper()
	store.Set(testVehicleID, field, value, time.Now().UTC())
}

func TestSignalAdapter_Last(t *testing.T) {
	adapter, store := newTestAdapter(t)

	if _, ok := adapter.Last(testVehicleID, "Gear"); ok {
		t.Fatal("Last on missing field should return ok=false")
	}

	setSignal(t, store, "Gear", ftproto.ShiftState_ShiftStateD)
	v, ok := adapter.Last(testVehicleID, "Gear")
	if !ok {
		t.Fatal("Last on present field should return ok=true")
	}
	if v.Raw == nil || v.Timestamp.IsZero() {
		t.Fatalf("Last returned empty Value: %+v", v)
	}
}

func TestSignalAdapter_Gear(t *testing.T) {
	tests := []struct {
		name      string
		setup     func(*signal.Store)
		want      string
		wantOK    bool
	}{
		{
			name:   "missing",
			setup:  func(s *signal.Store) {},
			wantOK: false,
		},
		{
			name: "ftproto enum D",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateD, time.Now().UTC())
			},
			want:   "D",
			wantOK: true,
		},
		{
			name: "ftproto enum P",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateP, time.Now().UTC())
			},
			want:   "P",
			wantOK: true,
		},
		{
			name: "ftproto enum R",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateR, time.Now().UTC())
			},
			want:   "R",
			wantOK: true,
		},
		{
			name: "ftproto enum N",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateN, time.Now().UTC())
			},
			want:   "N",
			wantOK: true,
		},
		{
			name: "long-form Park stripped to P",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", "ShiftStatePark", time.Now().UTC())
			},
			want:   "P",
			wantOK: true,
		},
		{
			name: "ShiftStateUnknown drops",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateUnknown, time.Now().UTC())
			},
			wantOK: false,
		},
		{
			name: "wrong runtime kind (int) drops",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", 5, time.Now().UTC())
			},
			wantOK: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, store := newTestAdapter(t)
			tt.setup(store)
			got, ok := adapter.Gear(testVehicleID)
			if ok != tt.wantOK {
				t.Fatalf("Gear ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && got != tt.want {
				t.Errorf("Gear = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSignalAdapter_Speed(t *testing.T) {
	adapter, store := newTestAdapter(t)

	if _, ok := adapter.Speed(testVehicleID); ok {
		t.Fatal("Speed missing should return ok=false")
	}

	setSignal(t, store, "VehicleSpeed", 27.5)
	got, ok := adapter.Speed(testVehicleID)
	if !ok || got != 27.5 {
		t.Fatalf("Speed = (%v, %v), want (27.5, true)", got, ok)
	}

	// wrong-kind path: VehicleSpeed declared float; storing a string
	// must return (0, false) via the Store.GetFloat type-switch fallback.
	adapterBad, storeBad := newTestAdapter(t)
	storeBad.Set(testVehicleID, "VehicleSpeed", "fast", time.Now().UTC())
	if got, ok := adapterBad.Speed(testVehicleID); ok || got != 0 {
		t.Errorf("Speed wrong-kind = (%v, %v), want (0, false)", got, ok)
	}
}

func TestSignalAdapter_IsCharging(t *testing.T) {
	tests := []struct {
		name   string
		setup  func(*signal.Store)
		want   bool
		wantOK bool
	}{
		{
			name:   "no charge state available",
			setup:  func(s *signal.Store) {},
			wantOK: false,
		},
		{
			name: "ChargeState=Charging",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "ChargeState", ftproto.ChargingState_ChargeStateCharging, time.Now().UTC())
			},
			want:   true,
			wantOK: true,
		},
		{
			name: "ChargeState=Starting",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "ChargeState", ftproto.ChargingState_ChargeStateStarting, time.Now().UTC())
			},
			want:   true,
			wantOK: true,
		},
		{
			name: "ChargeState=Disconnected",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "ChargeState", ftproto.ChargingState_ChargeStateDisconnected, time.Now().UTC())
			},
			want:   false,
			wantOK: true,
		},
		{
			name: "ChargeState=Stopped is not active",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "ChargeState", ftproto.ChargingState_ChargeStateStopped, time.Now().UTC())
			},
			want:   false,
			wantOK: true,
		},
		{
			name: "ChargeState=Complete is not active",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "ChargeState", ftproto.ChargingState_ChargeStateComplete, time.Now().UTC())
			},
			want:   false,
			wantOK: true,
		},
		{
			name: "fallback to DetailedChargeState when ChargeState absent",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "DetailedChargeState", ftproto.DetailedChargeStateValue_DetailedChargeStateCharging, time.Now().UTC())
			},
			want:   true,
			wantOK: true,
		},
		{
			name: "wrong runtime kind on ChargeState (int) is dropped",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "ChargeState", 4, time.Now().UTC())
			},
			wantOK: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, store := newTestAdapter(t)
			tt.setup(store)
			got, ok := adapter.IsCharging(testVehicleID)
			if ok != tt.wantOK {
				t.Fatalf("IsCharging ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && got != tt.want {
				t.Errorf("IsCharging = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSignalAdapter_IsDriving(t *testing.T) {
	tests := []struct {
		name   string
		setup  func(*signal.Store)
		want   bool
		wantOK bool
	}{
		{
			name:   "no signals",
			setup:  func(s *signal.Store) {},
			wantOK: false,
		},
		{
			name: "Gear=D + Speed>0 -> driving",
			setup: func(s *signal.Store) {
				now := time.Now().UTC()
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateD, now)
				s.Set(testVehicleID, "VehicleSpeed", 12.0, now)
			},
			want:   true,
			wantOK: true,
		},
		{
			name: "Gear=R + Speed>0 -> driving",
			setup: func(s *signal.Store) {
				now := time.Now().UTC()
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateR, now)
				s.Set(testVehicleID, "VehicleSpeed", 1.0, now)
			},
			want:   true,
			wantOK: true,
		},
		{
			name: "Gear=D + Speed=0 -> not driving but ok",
			setup: func(s *signal.Store) {
				now := time.Now().UTC()
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateD, now)
				s.Set(testVehicleID, "VehicleSpeed", 0.0, now)
			},
			want:   false,
			wantOK: true,
		},
		{
			name: "Gear=P -> not driving regardless of speed",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateP, time.Now().UTC())
			},
			want:   false,
			wantOK: true,
		},
		{
			name: "Gear=D but speed missing -> ok=false",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", ftproto.ShiftState_ShiftStateD, time.Now().UTC())
			},
			wantOK: false,
		},
		{
			name: "Gear wrong-kind -> ok=false",
			setup: func(s *signal.Store) {
				s.Set(testVehicleID, "Gear", 5, time.Now().UTC())
				s.Set(testVehicleID, "VehicleSpeed", 50.0, time.Now().UTC())
			},
			wantOK: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, store := newTestAdapter(t)
			tt.setup(store)
			got, ok := adapter.IsDriving(testVehicleID)
			if ok != tt.wantOK {
				t.Fatalf("IsDriving ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && got != tt.want {
				t.Errorf("IsDriving = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSignalAdapter_Locked(t *testing.T) {
	adapter, store := newTestAdapter(t)

	if _, ok := adapter.Locked(testVehicleID); ok {
		t.Fatal("Locked missing should return ok=false")
	}

	setSignal(t, store, "Locked", true)
	got, ok := adapter.Locked(testVehicleID)
	if !ok || !got {
		t.Errorf("Locked happy = (%v, %v), want (true, true)", got, ok)
	}

	setSignal(t, store, "Locked", false)
	got, ok = adapter.Locked(testVehicleID)
	if !ok || got {
		t.Errorf("Locked false = (%v, %v), want (false, true)", got, ok)
	}

	// wrong-kind path: store an int into Locked. Locked is declared
	// ValueKindBool so the Store.GetBool type-switch fallback returns
	// (false, false).
	adapterBad, storeBad := newTestAdapter(t)
	storeBad.Set(testVehicleID, "Locked", 1, time.Now().UTC())
	if got, ok := adapterBad.Locked(testVehicleID); ok {
		t.Errorf("Locked wrong-kind = (%v, %v), want ok=false", got, ok)
	}
}

func TestSignalAdapter_SoC(t *testing.T) {
	adapter, store := newTestAdapter(t)

	if _, ok := adapter.SoC(testVehicleID); ok {
		t.Fatal("SoC missing should return ok=false")
	}

	setSignal(t, store, "BatteryLevel", 73.5)
	got, ok := adapter.SoC(testVehicleID)
	if !ok || got != 73.5 {
		t.Errorf("SoC = (%v, %v), want (73.5, true)", got, ok)
	}

	// wrong-kind path: BatteryLevel declared float.
	adapterBad, storeBad := newTestAdapter(t)
	storeBad.Set(testVehicleID, "BatteryLevel", "full", time.Now().UTC())
	if got, ok := adapterBad.SoC(testVehicleID); ok || got != 0 {
		t.Errorf("SoC wrong-kind = (%v, %v), want (0, false)", got, ok)
	}
}

func TestSignalAdapter_Position(t *testing.T) {
	adapter, store := newTestAdapter(t)

	if _, _, ok := adapter.Position(testVehicleID); ok {
		t.Fatal("Position missing should return ok=false")
	}

	now := time.Now().UTC()
	store.Set(testVehicleID, "LocationLatitude", 37.7749, now)
	if _, _, ok := adapter.Position(testVehicleID); ok {
		t.Fatal("Position with only lat should return ok=false")
	}

	store.Set(testVehicleID, "LocationLongitude", -122.4194, now)
	lat, lng, ok := adapter.Position(testVehicleID)
	if !ok || lat != 37.7749 || lng != -122.4194 {
		t.Errorf("Position = (%v, %v, %v), want (37.7749, -122.4194, true)", lat, lng, ok)
	}

	// wrong-kind path: store a string into LocationLatitude. The field
	// is unannotated in protomodel.SignalsByName (codec-flattened
	// child), so Store.GetFloat falls back to best-effort type
	// assertion which fails for string.
	adapterBad, storeBad := newTestAdapter(t)
	storeBad.Set(testVehicleID, "LocationLatitude", "north", now)
	storeBad.Set(testVehicleID, "LocationLongitude", -122.0, now)
	if _, _, ok := adapterBad.Position(testVehicleID); ok {
		t.Errorf("Position wrong-kind should return ok=false")
	}
}

func TestSignalAdapter_chargeStateName_StripsBothPrefixes(t *testing.T) {
	adapter, store := newTestAdapter(t)
	now := time.Now().UTC()

	// ChargeState enum -> "Charging"
	store.Set(testVehicleID, "ChargeState", ftproto.ChargingState_ChargeStateCharging, now)
	got, ok := adapter.chargeStateName(testVehicleID, "ChargeState")
	if !ok || got != "Charging" {
		t.Errorf("ChargeState chargeStateName = (%q, %v), want (\"Charging\", true)", got, ok)
	}

	// DetailedChargeState enum -> "Charging" (DetailedChargeState
	// prefix stripped first, then ChargeState would also trim if
	// remaining)
	store.Set(testVehicleID, "DetailedChargeState", ftproto.DetailedChargeStateValue_DetailedChargeStateCharging, now)
	got, ok = adapter.chargeStateName(testVehicleID, "DetailedChargeState")
	if !ok || got != "Charging" {
		t.Errorf("DetailedChargeState chargeStateName = (%q, %v), want (\"Charging\", true)", got, ok)
	}
}
