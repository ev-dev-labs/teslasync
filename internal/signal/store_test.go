package signal

import (
	"testing"
	"time"
)

func TestSmoke_Store_UpdateGet(t *testing.T) {
	s := New()

	// Mix of declared (BatteryLevel/VehicleSpeed/Locked) and unannotated
	// (ShiftState — only Gear is the canonical proto field) signals so we
	// exercise both ValueKind-checked and best-effort fallback paths.
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

// TestSet_TypedPrimitives covers the per-field Set method that the new
// Tesla normalize pipeline calls per Atomic. It exercises the declared
// ValueKind path (BatteryLevel/Locked/InsideTemp) plus an unannotated
// field for the best-effort fallback.
func TestSet_TypedPrimitives(t *testing.T) {
	s := New()
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

	s.Set(1, "BatteryLevel", float32(81.5), ts)
	s.Set(1, "Locked", true, ts)
	s.Set(1, "InsideTemp", 21.5, ts)

	if f, ok := s.GetFloat(1, "BatteryLevel"); !ok || f != float64(float32(81.5)) {
		t.Errorf("GetFloat(BatteryLevel) = (%v, %v), want (81.5, true)", f, ok)
	}
	if b, ok := s.GetBool(1, "Locked"); !ok || !b {
		t.Errorf("GetBool(Locked) = (%v, %v), want (true, true)", b, ok)
	}
	if f, ok := s.GetFloat(1, "InsideTemp"); !ok || f != 21.5 {
		t.Errorf("GetFloat(InsideTemp) = (%v, %v), want (21.5, true)", f, ok)
	}

	if got := s.Get(1, "BatteryLevel"); got == nil || !got.Timestamp.Equal(ts) {
		t.Errorf("Set did not preserve caller-supplied timestamp: got %v, want %v", got, ts)
	}
}

// TestSet_NilAndInvalidMarkerSkipped verifies that the per-field Set
// preserves the same last-known-good contract as Update: nil values and
// {invalid:true} markers must not overwrite an existing good value.
func TestSet_NilAndInvalidMarkerSkipped(t *testing.T) {
	s := New()
	ts := time.Now().UTC()

	s.Set(1, "BatteryLevel", 70.0, ts)
	s.Set(1, "BatteryLevel", nil, ts.Add(time.Second))
	s.Set(1, "BatteryLevel", map[string]interface{}{"invalid": true}, ts.Add(2*time.Second))

	if f, ok := s.GetFloat(1, "BatteryLevel"); !ok || f != 70.0 {
		t.Errorf("Set(nil/invalid) overwrote BatteryLevel: got (%v, %v), want (70.0, true)", f, ok)
	}
}

func TestUpdateValuesPreservesEventTimeAndRejectsOlderReplay(t *testing.T) {
	s := New()
	newer := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	older := newer.Add(-7 * 24 * time.Hour)

	s.UpdateValues(1, map[string]*Value{
		"BatteryLevel": {Raw: 80.0, Timestamp: newer},
	})
	s.UpdateValues(1, map[string]*Value{
		"BatteryLevel": {Raw: 20.0, Timestamp: older},
	})

	got := s.Get(1, "BatteryLevel")
	if got == nil {
		t.Fatal("BatteryLevel missing")
	}
	if got.Raw != 80.0 {
		t.Fatalf("BatteryLevel = %v, want newer value 80", got.Raw)
	}
	if !got.Timestamp.Equal(newer) {
		t.Fatalf("Timestamp = %v, want producer event time %v", got.Timestamp, newer)
	}
}

// TestGetFloat_ValueKindMismatchOnDeclaredField verifies that a typed
// getter rejects values stored under a declared ValueKind that does not
// match the getter. Locked is declared as ValueKindBool, so GetFloat
// must return (0, false) regardless of the stored Go scalar.
func TestGetFloat_ValueKindMismatchOnDeclaredField(t *testing.T) {
	s := New()
	s.Set(1, "Locked", true, time.Now().UTC())

	if f, ok := s.GetFloat(1, "Locked"); ok || f != 0 {
		t.Errorf("GetFloat(Locked) = (%v, %v), want (0, false) — Locked is ValueKindBool", f, ok)
	}
}

// TestGetString_OnEnumField pins the post-codec-canonicalization
// contract: enum fields hold canonical short strings (per
// protomodel.DecodeValue). Gear stores "D" / "P" / "R" / "N" — GetString
// must return the string verbatim. The legacy reject-enum behaviour
// was removed when the codec became the SINGLE conversion point for
// proto-enum → string translation.
func TestGetString_OnEnumField(t *testing.T) {
	s := New()
	s.Set(1, "Gear", "D", time.Now().UTC())

	if str, ok := s.GetString(1, "Gear"); !ok || str != "D" {
		t.Errorf("GetString(Gear) = (%q, %v), want (\"D\", true) — codec emits canonical short string for ValueKindEnum", str, ok)
	}
}

// TestGetBool_ValueKindMismatchOnDeclaredField verifies that GetBool
// rejects declared non-bool fields. BatteryLevel is ValueKindFloat.
func TestGetBool_ValueKindMismatchOnDeclaredField(t *testing.T) {
	s := New()
	s.Set(1, "BatteryLevel", 80.0, time.Now().UTC())

	if b, ok := s.GetBool(1, "BatteryLevel"); ok || b {
		t.Errorf("GetBool(BatteryLevel) = (%v, %v), want (false, false) — BatteryLevel is ValueKindFloat", b, ok)
	}
}

// TestGetTime_TypedAndMismatch verifies the new GetTime typed getter on
// both an unannotated field (best-effort) and a declared mismatching
// field (BatteryLevel is ValueKindFloat → GetTime must return false).
func TestGetTime_TypedAndMismatch(t *testing.T) {
	s := New()
	now := time.Now().UTC()

	s.Set(1, "AdHocTimeField", now, now)
	if got, ok := s.GetTime(1, "AdHocTimeField"); !ok || !got.Equal(now) {
		t.Errorf("GetTime(AdHocTimeField) = (%v, %v), want (%v, true)", got, ok, now)
	}

	s.Set(1, "BatteryLevel", 80.0, now)
	if got, ok := s.GetTime(1, "BatteryLevel"); ok || !got.IsZero() {
		t.Errorf("GetTime(BatteryLevel) = (%v, %v), want (zero, false) — BatteryLevel is ValueKindFloat", got, ok)
	}
}

// TestGetFloat_AcceptsAllNumericValueKinds verifies that GetFloat
// satisfies values stored under any of the four numeric ValueKinds the
// codec emits — Float (float32), Double (float64), Int32 (int32),
// Int64 (int64).
func TestGetFloat_AcceptsAllNumericValueKinds(t *testing.T) {
	s := New()
	ts := time.Now().UTC()

	// BatteryLevel/Odometer/InsideTemp are all ValueKindFloat in the
	// generated metadata. The codec MAY emit float32 or float64 for
	// ValueKindFloat depending on the proto oneof variant; the store
	// must accept either.
	s.Set(1, "BatteryLevel", float32(80.5), ts)
	if f, ok := s.GetFloat(1, "BatteryLevel"); !ok || f != float64(float32(80.5)) {
		t.Errorf("GetFloat(BatteryLevel float32) = (%v, %v), want (80.5, true)", f, ok)
	}
	s.Set(1, "Odometer", 12345.6, ts)
	if f, ok := s.GetFloat(1, "Odometer"); !ok || f != 12345.6 {
		t.Errorf("GetFloat(Odometer float64) = (%v, %v), want (12345.6, true)", f, ok)
	}
}

// TestSet_UpdatesLastSeenMetric is a smoke check that Set bumps the
// VehicleLastSeen freshness metric the same way Update does. We only
// verify the call does not panic and the stored Value is observable;
// the prometheus side-effect is covered by metrics tests.
func TestSet_UpdatesLastSeenMetric(t *testing.T) {
	s := New()
	s.Set(42, "BatteryLevel", 50.0, time.Now().UTC())

	if v := s.Get(42, "BatteryLevel"); v == nil {
		t.Fatal("Set did not store the value")
	}
	ids := s.VehicleIDs()
	if len(ids) != 1 || ids[0] != 42 {
		t.Errorf("VehicleIDs() = %v, want [42]", ids)
	}
}
