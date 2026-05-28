package alert

import "testing"

// TestAlertRule_AppliesTo_AllVehicles pins sticky-all semantics: when
// AllVehicles=true, AppliesTo returns true for ANY vehicle ID — even
// IDs not present in the (irrelevant) VehicleIDs hint slice. This is
// the engine-side proof for Decision D7: vehicles inserted AFTER the
// rule was created inherit automatically because the engine never
// enumerates a known-vehicle list.
// Phase-49 / Slice 0005.
func TestAlertRule_AppliesTo_AllVehicles(t *testing.T) {
	r := &AlertRule{AllVehicles: true}
	for _, vid := range []int64{0, 1, 42, 1 << 31} {
		if !r.AppliesTo(vid) {
			t.Fatalf("AppliesTo(%d) = false; sticky-all rule must match every vehicle", vid)
		}
	}
}

// TestAlertRule_AppliesTo_StickyAll_FutureVehicle is the explicit D7
// proof: a rule with AllVehicles=true returns true for a vehicle ID
// (999) that wasn't in the VehicleIDs hint when the rule was loaded.
// By construction — AppliesTo short-circuits on AllVehicles before
// scanning VehicleIDs — vehicles inserted into the fleet AFTER rule
// creation match without any rule edit.
// Phase-49 / Slice 0005 / Decision D7 / Acceptance criterion 6.
func TestAlertRule_AppliesTo_StickyAll_FutureVehicle(t *testing.T) {
	r := &AlertRule{
		AllVehicles: true,
		VehicleIDs:  []int64{1, 2}, // pretend these are the only known vehicles at boot
	}
	if !r.AppliesTo(999) {
		t.Fatalf("AppliesTo(999) = false; sticky-all rule must match vehicles inserted after rule creation")
	}
}

// TestAlertRule_AppliesTo_SpecificVehicles pins the explicit-subset
// semantics: AllVehicles=false matches only vehicles in the hydrated
// VehicleIDs slice. Phase-49 / Slice 0005.
func TestAlertRule_AppliesTo_SpecificVehicles(t *testing.T) {
	r := &AlertRule{
		AllVehicles: false,
		VehicleIDs:  []int64{1, 5, 7},
	}
	for _, want := range []int64{1, 5, 7} {
		if !r.AppliesTo(want) {
			t.Fatalf("AppliesTo(%d) = false; explicit-subset rule must match every listed vehicle", want)
		}
	}
	for _, deny := range []int64{0, 2, 6, 999} {
		if r.AppliesTo(deny) {
			t.Fatalf("AppliesTo(%d) = true; explicit-subset rule must reject unlisted vehicles", deny)
		}
	}
}

// TestAlertRule_AppliesTo_EmptySubset_RejectsAll pins the malformed-data
// behaviour: a rule with AllVehicles=false AND empty VehicleIDs (which
// the validator should never let through, but defensive evaluation
// matters) targets nothing. Phase-49 / Slice 0005.
func TestAlertRule_AppliesTo_EmptySubset_RejectsAll(t *testing.T) {
	r := &AlertRule{AllVehicles: false}
	for _, vid := range []int64{0, 1, 42} {
		if r.AppliesTo(vid) {
			t.Fatalf("AppliesTo(%d) = true; rule with neither all_vehicles nor any subset must match nothing", vid)
		}
	}
}

// TestAlertRule_AppliesTo_NilReceiver pins the nil-safe contract
// engine callers rely on. Phase-49 / Slice 0005.
func TestAlertRule_AppliesTo_NilReceiver(t *testing.T) {
	var r *AlertRule
	if r.AppliesTo(1) {
		t.Fatal("AppliesTo on nil receiver must return false")
	}
}
