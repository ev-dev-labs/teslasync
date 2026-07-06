package signaltest

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestNewFakeLiveStateReader_EmptyAndUsable(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	if f == nil {
		t.Fatal("NewFakeLiveStateReader returned nil")
	}

	// An empty fake returns a non-nil, empty state for any unknown vehicle.
	state, err := f.LiveState(context.Background(), 42)
	if err != nil {
		t.Fatalf("LiveState on empty fake: unexpected error %v", err)
	}
	if state == nil {
		t.Fatal("LiveState returned nil map; contract requires non-nil")
	}
	if len(state) != 0 {
		t.Fatalf("LiveState on empty fake: want 0 entries, got %d", len(state))
	}

	// An unknown signal resolves to (nil, nil).
	v, err := f.LiveSignal(context.Background(), 42, "VehicleSpeed")
	if err != nil {
		t.Fatalf("LiveSignal on empty fake: unexpected error %v", err)
	}
	if v != nil {
		t.Fatalf("LiveSignal on empty fake: want nil, got %#v", v)
	}
}

func TestFakeLiveStateReader_ConformsToInterface(t *testing.T) {
	t.Parallel()
	// Exercised at compile time by the var _ declaration in the impl file,
	// re-asserted here so the intent is visible in the test suite.
	var _ signal.LiveStateReader = NewFakeLiveStateReader()
}

func TestFakeLiveStateReader_SetAndLiveSignal(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		vehicleID int64
		signal    string
		value     signal.SignalValue
		lookup    string
		want      signal.SignalValue
	}{
		{"numeric value", 1, "VehicleSpeed", 65.0, "VehicleSpeed", 65.0},
		{"string value", 1, "Gear", "D", "Gear", "D"},
		{"bool value", 1, "Locked", true, "Locked", true},
		{"zero numeric value is retained", 1, "Soc", 0.0, "Soc", 0.0},
		{"false bool value is retained", 1, "Charging", false, "Charging", false},
		{"empty string value is retained", 1, "Note", "", "Note", ""},
		{"structured value", 7, "BrickVoltages", []any{3.9, 3.8}, "BrickVoltages", []any{3.9, 3.8}},
		{"miss returns nil", 1, "VehicleSpeed", 65.0, "Odometer", nil},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := NewFakeLiveStateReader()
			f.Set(tc.vehicleID, tc.signal, tc.value)

			got, err := f.LiveSignal(context.Background(), tc.vehicleID, tc.lookup)
			if err != nil {
				t.Fatalf("LiveSignal: unexpected error %v", err)
			}
			if !equalSignalValue(got, tc.want) {
				t.Fatalf("LiveSignal(%q) = %#v, want %#v", tc.lookup, got, tc.want)
			}
		})
	}
}

func TestFakeLiveStateReader_SetNilDeletes(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	f.Set(1, "VehicleSpeed", 65.0)
	f.Set(1, "Gear", "D")

	// Deleting one key leaves the other intact.
	f.Set(1, "VehicleSpeed", nil)

	if v, _ := f.LiveSignal(context.Background(), 1, "VehicleSpeed"); v != nil {
		t.Fatalf("after Set(nil), LiveSignal(VehicleSpeed) = %#v, want nil", v)
	}
	if v, _ := f.LiveSignal(context.Background(), 1, "Gear"); v != "D" {
		t.Fatalf("LiveSignal(Gear) = %#v, want \"D\"", v)
	}

	// Deleting a key on a never-seen vehicle is a no-op, not a panic, and
	// leaves the vehicle with an empty state.
	f.Set(999, "Ghost", nil)
	state, err := f.LiveState(context.Background(), 999)
	if err != nil {
		t.Fatalf("LiveState(999): unexpected error %v", err)
	}
	if len(state) != 0 {
		t.Fatalf("LiveState(999) = %#v, want empty", state)
	}
}

func TestFakeLiveStateReader_SetMany(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	f.Set(1, "Existing", "keep")
	f.Set(1, "ToDelete", "gone")

	f.SetMany(1, map[string]signal.SignalValue{
		"VehicleSpeed": 30.0,
		"Gear":         "R",
		"ToDelete":     nil, // nil deletes
	})

	state, err := f.LiveState(context.Background(), 1)
	if err != nil {
		t.Fatalf("LiveState: unexpected error %v", err)
	}
	want := map[string]signal.SignalValue{
		"Existing":     "keep",
		"VehicleSpeed": 30.0,
		"Gear":         "R",
	}
	if len(state) != len(want) {
		t.Fatalf("LiveState size = %d, want %d (%#v)", len(state), len(want), state)
	}
	for k, wv := range want {
		if !equalSignalValue(state[k], wv) {
			t.Fatalf("LiveState[%q] = %#v, want %#v", k, state[k], wv)
		}
	}
	if _, ok := state["ToDelete"]; ok {
		t.Fatal("ToDelete should have been removed by nil in SetMany")
	}
}

func TestFakeLiveStateReader_SetManyOnNewVehicle(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	f.SetMany(5, map[string]signal.SignalValue{"A": 1.0, "B": 2.0})

	state, _ := f.LiveState(context.Background(), 5)
	if len(state) != 2 {
		t.Fatalf("LiveState(5) size = %d, want 2", len(state))
	}
}

func TestFakeLiveStateReader_LiveStateIsolatesVehicles(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	f.Set(1, "Speed", 10.0)
	f.Set(2, "Speed", 20.0)

	s1, _ := f.LiveState(context.Background(), 1)
	s2, _ := f.LiveState(context.Background(), 2)
	if !equalSignalValue(s1["Speed"], 10.0) {
		t.Fatalf("vehicle 1 Speed = %#v, want 10", s1["Speed"])
	}
	if !equalSignalValue(s2["Speed"], 20.0) {
		t.Fatalf("vehicle 2 Speed = %#v, want 20", s2["Speed"])
	}
}

func TestFakeLiveStateReader_LiveStateReturnsCallerOwnedCopy(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	f.Set(1, "Speed", 10.0)

	state, _ := f.LiveState(context.Background(), 1)
	// Mutating the returned map must not corrupt the fake's storage.
	state["Speed"] = 999.0
	state["Injected"] = "x"
	delete(state, "Speed")

	fresh, _ := f.LiveState(context.Background(), 1)
	if !equalSignalValue(fresh["Speed"], 10.0) {
		t.Fatalf("fake storage was mutated via returned map: Speed = %#v", fresh["Speed"])
	}
	if _, ok := fresh["Injected"]; ok {
		t.Fatal("fake storage was mutated: unexpected Injected key")
	}
}

func TestFakeLiveStateReader_ErrorInjection(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("redis transport down")
	f := NewFakeLiveStateReader()
	f.Set(1, "Speed", 10.0) // data present, but error must still win
	f.SetError(sentinel)

	if _, err := f.LiveState(context.Background(), 1); !errors.Is(err, sentinel) {
		t.Fatalf("LiveState error = %v, want %v", err, sentinel)
	}
	if _, err := f.LiveSignal(context.Background(), 1, "Speed"); !errors.Is(err, sentinel) {
		t.Fatalf("LiveSignal error = %v, want %v", err, sentinel)
	}

	// LiveState must return a nil map alongside the error.
	state, _ := f.LiveState(context.Background(), 1)
	if state != nil {
		t.Fatalf("LiveState on error = %#v, want nil map", state)
	}
}

func TestFakeLiveStateReader_Reset(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	f.Set(1, "Speed", 10.0)
	f.SetError(errors.New("boom"))

	f.Reset()

	// Error cleared.
	state, err := f.LiveState(context.Background(), 1)
	if err != nil {
		t.Fatalf("after Reset, LiveState error = %v, want nil", err)
	}
	// State cleared.
	if len(state) != 0 {
		t.Fatalf("after Reset, LiveState = %#v, want empty", state)
	}
}

func TestFakeLiveStateReader_SetErrorNilClears(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	f.SetError(errors.New("boom"))
	f.SetError(nil)

	if _, err := f.LiveState(context.Background(), 1); err != nil {
		t.Fatalf("after SetError(nil), LiveState error = %v, want nil", err)
	}
}

func TestFakeLiveStateReader_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	f := NewFakeLiveStateReader()
	const workers = 16
	const iterations = 200

	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func(id int) {
			defer wg.Done()
			vehicleID := int64(id%4 + 1)
			for i := 0; i < iterations; i++ {
				f.Set(vehicleID, "Speed", float64(i))
				f.SetMany(vehicleID, map[string]signal.SignalValue{"Gear": "D"})
				_, _ = f.LiveState(context.Background(), vehicleID)
				_, _ = f.LiveSignal(context.Background(), vehicleID, "Speed")
			}
		}(w)
	}
	wg.Wait()

	// After all writers finish, each vehicle has both keys.
	for vehicleID := int64(1); vehicleID <= 4; vehicleID++ {
		state, err := f.LiveState(context.Background(), vehicleID)
		if err != nil {
			t.Fatalf("LiveState(%d): %v", vehicleID, err)
		}
		if _, ok := state["Gear"]; !ok {
			t.Fatalf("vehicle %d missing Gear after concurrent writes", vehicleID)
		}
	}
}
