package config

import (
	"bytes"
	"encoding/json"
	"sort"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// parsedSubscription is the minimal shape we need to assert about the
// rendered body. We intentionally do NOT model the entire Tesla schema
// here — the tests should fail when the field list is wrong, not when
// Tesla adds or removes an unrelated top-level key.
type parsedSubscription struct {
	VINs   []string `json:"vins"`
	Config struct {
		Hostname string `json:"hostname"`
		Port     int    `json:"port"`
		Fields   map[string]struct {
			IntervalSeconds int      `json:"interval_seconds"`
			MinimumDelta    *float64 `json:"minimum_delta,omitempty"`
			IncludeFields   []string `json:"include_fields,omitempty"`
		} `json:"fields"`
	} `json:"config"`
}

// TestConfigCoversAllFields enforces ADR-004 #4 + the codegen-coupled
// invariant that every actionable protomodel.Signals entry appears in
// the rendered subscription with a positive interval_seconds, and that
// every IsSettingUnit field is pinned at interval_seconds == 1.
//
// The test fails loudly with the missing field name (not a count) so
// when codegen adds a new Field that intervals.go forgot to cover, the
// failure message points directly at the one symbol that needs an
// entry rather than asking the developer to bisect a count delta.
func TestConfigCoversAllFields(t *testing.T) {
	t.Parallel()

	b := NewBuilder()
	raw, err := b.BuildSubscription()
	if err != nil {
		t.Fatalf("BuildSubscription: %v", err)
	}

	var sub parsedSubscription
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal subscription: %v\nbody=%s", err, raw)
	}

	if len(sub.Config.Fields) == 0 {
		t.Fatalf("subscription emitted zero fields; expected the full protomodel.Signals coverage minus metadata sentinels\nbody=%s", raw)
	}

	// Coverage: every non-metadata Field must appear with a positive
	// interval_seconds. Sort the missing list so the failure message
	// is deterministic across runs.
	var missing []string
	var nonPositive []string
	for i := range protomodel.Signals {
		s := &protomodel.Signals[i]
		if s.Category == "metadata" {
			continue
		}
		entry, ok := sub.Config.Fields[s.Field]
		if !ok {
			missing = append(missing, s.Field+" ("+s.Category+")")
			continue
		}
		if entry.IntervalSeconds <= 0 {
			nonPositive = append(nonPositive, s.Field)
		}
	}
	sort.Strings(missing)
	sort.Strings(nonPositive)
	for _, name := range missing {
		t.Errorf("subscription missing field %s; intervals.go forgot to cover it", name)
	}
	for _, name := range nonPositive {
		t.Errorf("subscription field %q has non-positive interval_seconds; intervals table emitted zero", name)
	}

	// ADR-004 #4: every IsSettingUnit field MUST be at interval_seconds == 1.
	// Iterate SignalsByName explicitly so this invariant is checked
	// independently of the categoryDefaults["setting_unit"] entry; if
	// someone ever flips that default to anything other than 1, this
	// test fails with the field name that broke the contract rather
	// than mysteriously corrupting unit-bearing data in production.
	settingUnitNames := make([]string, 0, 4)
	for name, sig := range protomodel.SignalsByName {
		if sig.IsSettingUnit {
			settingUnitNames = append(settingUnitNames, name)
		}
	}
	sort.Strings(settingUnitNames)
	if len(settingUnitNames) == 0 {
		t.Fatalf("protomodel.SignalsByName has zero IsSettingUnit entries; coverage test cannot enforce ADR-004 #4")
	}
	for _, name := range settingUnitNames {
		entry, ok := sub.Config.Fields[name]
		if !ok {
			t.Errorf("setting-unit field %q missing from subscription (ADR-004 #4)", name)
			continue
		}
		if entry.IntervalSeconds != 1 {
			t.Errorf("setting-unit field %q has interval_seconds=%d, want 1 (ADR-004 #4)", name, entry.IntervalSeconds)
		}
	}
}

// TestSubscriptionDeterministic asserts BuildSubscription produces
// byte-identical output across calls for the same inputs. Without
// this property the subscription JSON would churn its hash on every
// process restart, making "did the Tesla subscription actually
// change?" unanswerable from the audit log.
func TestSubscriptionDeterministic(t *testing.T) {
	t.Parallel()

	b := NewBuilder()
	first, err := b.BuildSubscription()
	if err != nil {
		t.Fatalf("first build: %v", err)
	}
	second, err := b.BuildSubscription()
	if err != nil {
		t.Fatalf("second build: %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatalf("BuildSubscription is not byte-stable across calls\nfirst=%s\nsecond=%s", first, second)
	}

	// Re-check determinism with a non-trivial VIN list and an
	// intentionally unsorted input to verify the internal sort path.
	vinsA := []string{"5YJ3E1EA0LF000002", "5YJ3E1EA0LF000001"}
	vinsB := []string{"5YJ3E1EA0LF000001", "5YJ3E1EA0LF000002"}
	bodyA, err := b.BuildFor(vinsA)
	if err != nil {
		t.Fatalf("BuildFor vinsA: %v", err)
	}
	bodyB, err := b.BuildFor(vinsB)
	if err != nil {
		t.Fatalf("BuildFor vinsB: %v", err)
	}
	if !bytes.Equal(bodyA, bodyB) {
		t.Fatalf("BuildFor is not order-independent on VIN list\nA=%s\nB=%s", bodyA, bodyB)
	}
}

// TestBuildForIncludesVINs sanity-checks that BuildFor actually emits
// the VIN list and the configured hostname/port; otherwise a future
// regression could silently strip them and Tesla would refuse the
// request with a generic 400 that's hard to root-cause.
func TestBuildForIncludesVINs(t *testing.T) {
	t.Parallel()

	b := &Builder{Hostname: "telemetry.example.com", Port: 8443}
	vins := []string{"VIN_BBB", "VIN_AAA"}
	raw, err := b.BuildFor(vins)
	if err != nil {
		t.Fatalf("BuildFor: %v", err)
	}
	var sub parsedSubscription
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal: %v\nbody=%s", err, raw)
	}
	if sub.Config.Hostname != "telemetry.example.com" {
		t.Errorf("hostname = %q, want telemetry.example.com", sub.Config.Hostname)
	}
	if sub.Config.Port != 8443 {
		t.Errorf("port = %d, want 8443", sub.Config.Port)
	}
	if len(sub.VINs) != 2 || sub.VINs[0] != "VIN_AAA" || sub.VINs[1] != "VIN_BBB" {
		t.Errorf("VINs = %v, want sorted [VIN_AAA VIN_BBB]", sub.VINs)
	}
}

// TestIntervalForKnownAndUnknownFields exercises both the per-field
// override path and the unknown-field guard so a future refactor that
// drops the SignalsByName lookup can't quietly start returning a
// default cadence for nonexistent fields.
func TestIntervalForKnownAndUnknownFields(t *testing.T) {
	t.Parallel()

	cases := []struct {
		field  string
		want   int
		wantOk bool
	}{
		// Per-field overrides.
		{"VehicleSpeed", 1, true},
		{"Gear", 1, true},
		{"BatteryLevel", 30, true},
		{"MilesSinceReset", 10, true},
		{"SelfDrivingMilesSinceReset", 1, true},
		// Setting unit fields use the setting_unit category default,
		// which the coverage test independently asserts is 1.
		{"SettingDistanceUnit", 1, true},
		{"SettingTemperatureUnit", 1, true},
		{"SettingTirePressureUnit", 1, true},
		{"SettingChargeUnit", 1, true},
		// Unknown field must return ok=false rather than a default.
		{"NotARealTeslaField", 0, false},
	}
	for _, tc := range cases {
		got, ok := IntervalFor(tc.field)
		if ok != tc.wantOk {
			t.Errorf("IntervalFor(%q) ok=%v, want %v", tc.field, ok, tc.wantOk)
			continue
		}
		if got != tc.want {
			t.Errorf("IntervalFor(%q) = %d, want %d", tc.field, got, tc.want)
		}
	}
}

func TestCounterPoliciesAreSynchronized(t *testing.T) {
	t.Parallel()

	raw, err := NewBuilder().BuildSubscription()
	if err != nil {
		t.Fatalf("BuildSubscription: %v", err)
	}
	var sub parsedSubscription
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	miles := sub.Config.Fields["MilesSinceReset"]
	if miles.MinimumDelta == nil || *miles.MinimumDelta != 0.01 {
		t.Errorf("MilesSinceReset minimum_delta = %v, want 0.01", miles.MinimumDelta)
	}
	if len(miles.IncludeFields) != 1 || miles.IncludeFields[0] != "SelfDrivingMilesSinceReset" {
		t.Errorf("MilesSinceReset include_fields = %v", miles.IncludeFields)
	}

	fsd := sub.Config.Fields["SelfDrivingMilesSinceReset"]
	if fsd.MinimumDelta == nil || *fsd.MinimumDelta != 1 {
		t.Errorf("SelfDrivingMilesSinceReset minimum_delta = %v, want 1", fsd.MinimumDelta)
	}
	if len(fsd.IncludeFields) != 1 || fsd.IncludeFields[0] != "MilesSinceReset" {
		t.Errorf("SelfDrivingMilesSinceReset include_fields = %v", fsd.IncludeFields)
	}
}
