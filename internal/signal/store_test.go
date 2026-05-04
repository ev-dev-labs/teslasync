package signal

import (
	"testing"
	"time"
)

func TestSmoke_Store_UpdateGet(t *testing.T) {
	s := New()

	signals := map[string]interface{}{
		"BatteryLevel": 72.5,
		"VehicleSpeed": 65,
		"ShiftState":   "D",
		"Locked":       true,
	}
	s.Update(1, signals)

	// Verify Get returns each signal
	if v := s.Get(1, "BatteryLevel"); v == nil || v.Raw != 72.5 {
		t.Errorf("Get(1, BatteryLevel) = %v, want 72.5", v)
	}
	if v := s.Get(1, "ShiftState"); v == nil || v.Raw != "D" {
		t.Errorf("Get(1, ShiftState) = %v, want D", v)
	}

	// Typed accessors
	if f, ok := s.GetFloat(1, "BatteryLevel"); !ok || f != 72.5 {
		t.Errorf("GetFloat(1, BatteryLevel) = (%v, %v), want (72.5, true)", f, ok)
	}
	if str, ok := s.GetString(1, "ShiftState"); !ok || str != "D" {
		t.Errorf("GetString(1, ShiftState) = (%v, %v), want (D, true)", str, ok)
	}
	if b, ok := s.GetBool(1, "Locked"); !ok || !b {
		t.Errorf("GetBool(1, Locked) = (%v, %v), want (true, true)", b, ok)
	}
}

func TestSmoke_Store_NilIgnored(t *testing.T) {
	s := New()
	s.Update(1, map[string]interface{}{"BatteryLevel": 80.0})
	s.Update(1, map[string]interface{}{"BatteryLevel": nil})

	// nil must not overwrite existing value
	if v := s.Get(1, "BatteryLevel"); v == nil || v.Raw != 80.0 {
		t.Errorf("nil overwrote existing value: got %v, want 80.0", v)
	}
}

func TestSmoke_Store_InvalidMarkerSkipped(t *testing.T) {
	s := New()
	s.Update(1, map[string]interface{}{
		"Speed": map[string]interface{}{"invalid": true},
		"SOC":   55.0,
	})

	if v := s.Get(1, "Speed"); v != nil {
		t.Errorf("invalid marker was stored: got %v, want nil", v)
	}
	if v := s.Get(1, "SOC"); v == nil || v.Raw != 55.0 {
		t.Errorf("valid signal missing: got %v, want 55.0", v)
	}
}

func TestSmoke_Store_GetAll_Snapshot(t *testing.T) {
	s := New()
	s.Update(1, map[string]interface{}{"A": 1, "B": 2})

	all := s.GetAll(1)
	if len(all) != 2 {
		t.Fatalf("GetAll returned %d signals, want 2", len(all))
	}

	// Mutating returned map must not affect store
	delete(all, "A")
	if v := s.Get(1, "A"); v == nil {
		t.Error("deleting from GetAll snapshot affected the store")
	}
}

func TestSmoke_Store_UnknownVehicle(t *testing.T) {
	s := New()

	if v := s.Get(999, "anything"); v != nil {
		t.Errorf("Get on unknown vehicle returned %v, want nil", v)
	}
	if all := s.GetAll(999); all != nil {
		t.Errorf("GetAll on unknown vehicle returned %v, want nil", all)
	}
	if f, ok := s.GetFloat(999, "x"); ok || f != 0 {
		t.Errorf("GetFloat on unknown vehicle = (%v, %v), want (0, false)", f, ok)
	}
}


func TestLastSeenAt_EmptyVehicle(t *testing.T) {
s := New()
if got := s.LastSeenAt(999); !got.IsZero() {
t.Fatalf("LastSeenAt(unknown) = %v, want zero", got)
}
}

func TestLastSeenAt_ReturnsNewest(t *testing.T) {
s := New()
s.Update(1, map[string]interface{}{"A": 1.0})
first := s.Get(1, "A").Timestamp

// Sleep enough for distinct timestamps; the store stamps each Update
// with a fresh time.Now().UTC() so two Updates in sequence diverge.
time.Sleep(2 * time.Millisecond)

s.Update(1, map[string]interface{}{"B": 2.0})
second := s.Get(1, "B").Timestamp

if !second.After(first) {
t.Fatalf("test setup invalid: second %v not after first %v", second, first)
}

got := s.LastSeenAt(1)
if !got.Equal(second) {
t.Fatalf("LastSeenAt() = %v, want newest %v (first=%v)", got, second, first)
}
}
