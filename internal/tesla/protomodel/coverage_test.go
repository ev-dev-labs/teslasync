package protomodel

import (
	"sort"
	"testing"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"
)

// validCategories is the closed set of routing buckets defined by ADR-004.
// routing.yaml MUST resolve every Category to a writer; an unrouted
// Category is a deployment error. The list here is the authoritative
// whitelist; any new bucket added by the classifier in cmd/protogen-tesla
// has to be added here in the same change.
var validCategories = map[string]struct{}{
	"charging":        {},
	"driving":         {},
	"climate":         {},
	"location":        {},
	"powertrain":      {},
	"vehicle_state":   {},
	"safety_security": {},
	"media":           {},
	"config":          {},
	"prefs":           {},
	"setting_unit":    {},
	"metadata":        {},
}

// nonMeasurementCategories is the closed set of routing buckets that MUST
// NOT host signals carrying a physical UnitKind. Unit-bearing fields cannot
// live in metadata/config/prefs categories; this deny-list surfaces a
// misclassified measurement (for example, a temperature reading in
// "metadata") with a precise per-field error message.
//
// Setting-unit signals (IsSettingUnit=true) declare a unit dimension via
// UnitKind without themselves being measurements; their Category is
// enforced by TestCoverage_SettingUnitInvariants and they are exempted
// from this check.
var nonMeasurementCategories = map[string]struct{}{
	"metadata": {},
	"config":   {},
	"prefs":    {},
}

// settingUnitFieldNames is the closed set of the four canonical Setting*Unit
// signals named by ADR-004. The unit-history layer subscribes to these
// specifically and uses them to retroactively tag every other signal of the
// matching UnitKind with the unit that was in effect at write time. Any
// other field flagged IsSettingUnit=true would silently break that
// subscription, so the test enumerates the canonical names explicitly.
var settingUnitFieldNames = map[string]struct{}{
	"SettingDistanceUnit":     {},
	"SettingTemperatureUnit":  {},
	"SettingTirePressureUnit": {},
	"SettingChargeUnit":       {},
}

// TestCoverage_EveryProtoFieldHasSignalMeta reflectively enumerates every
// Field enum value declared by the vendored Tesla vehicle_data.proto via
// the auto-generated ftproto.Field_name map and asserts:
//
//  1. SignalsByEnum has an entry for that enum number.
//  2. The entry's Field name matches the proto's symbolic name exactly.
//  3. The entry's Category is one of the closed routing buckets.
//
// The reflective enumeration is the whole point: the previous coverage
// implementation iterated SignalRegistry, so a brand-new Field that the
// vendored proto introduced but that nobody added to the registry passed
// silently. Iterating ftproto.Field_name guarantees the test fails the
// first time `go generate ./internal/tesla/protomodel/...` is missed
// after a vendored-proto bump.
//
// Field_Unknown=0 is the proto3 default sentinel and is intentionally
// skipped. SignalsByEnum still carries an entry for it (Category="metadata")
// so consumers that key by enum number get a non-nil result, but the
// assertion only ranges over real fields.
func TestCoverage_EveryProtoFieldHasSignalMeta(t *testing.T) {
	if len(ftproto.Field_name) == 0 {
		t.Fatalf("ftproto.Field_name is empty; vendored proto bindings are missing")
	}

	// Iterate in numeric order so failure messages are stable across runs
	// (Go map iteration order is randomised).
	nums := make([]int32, 0, len(ftproto.Field_name))
	for num := range ftproto.Field_name {
		nums = append(nums, num)
	}
	sort.Slice(nums, func(i, j int) bool { return nums[i] < nums[j] })

	allowedCats := sortedKeys(validCategories)

	for _, num := range nums {
		name := ftproto.Field_name[num]
		if num == int32(ftproto.Field_Unknown) {
			continue
		}
		meta, ok := SignalsByEnum[num]
		if !ok {
			t.Errorf("proto Field %q (enum=%d) has no SignalMeta entry in SignalsByEnum (run `go generate ./internal/tesla/protomodel/...`)", name, num)
			continue
		}
		if meta.Field != name {
			t.Errorf("SignalsByEnum[%d].Field=%q does not match ftproto.Field_name[%d]=%q (generator drift)", num, meta.Field, num, name)
		}
		if _, ok := validCategories[meta.Category]; !ok {
			t.Errorf("Field %q (enum=%d): Category=%q is not a valid routing bucket; allowed=%v", name, num, meta.Category, allowedCats)
		}
	}
}

// TestCoverage_SettingUnitInvariants asserts the four Setting*Unit signals
// agree on three things at once: IsSettingUnit=true, Category="setting_unit",
// and Field name in the closed canonical set. A field whose IsSettingUnit
// is true but whose name is not one of the four canonical Setting*Unit
// signals will silently break the unit-history layer's subscription, so
// the test surfaces it with a per-field error message.
//
// The check runs in both directions:
//   - Forward: every IsSettingUnit=true entry in Signals MUST be one of
//     the four canonical names AND have Category="setting_unit".
//   - Reverse: every canonical Setting*Unit name MUST exist in Signals
//     with IsSettingUnit=true. A drift here means the generator renamed
//     or forgot to flag one of the four pivotal preference signals.
func TestCoverage_SettingUnitInvariants(t *testing.T) {
	canonical := sortedKeys(settingUnitFieldNames)

	for i := range Signals {
		s := &Signals[i]
		if !s.IsSettingUnit {
			continue
		}
		if _, ok := settingUnitFieldNames[s.Field]; !ok {
			t.Errorf("Field %q (enum=%d): IsSettingUnit=true but Field is not one of the canonical Setting*Unit names %v", s.Field, s.ProtoEnumNum, canonical)
		}
		if s.Category != "setting_unit" {
			t.Errorf("Field %q (enum=%d): IsSettingUnit=true but Category=%q (want %q)", s.Field, s.ProtoEnumNum, s.Category, "setting_unit")
		}
	}

	// Iterate the canonical names in sorted order so failure output is
	// deterministic.
	for _, name := range canonical {
		s, ok := SignalsByName[name]
		if !ok {
			t.Errorf("canonical setting-unit Field %q is missing from SignalsByName (generator regression)", name)
			continue
		}
		if !s.IsSettingUnit {
			t.Errorf("Field %q (enum=%d): expected IsSettingUnit=true for canonical setting-unit signal, got false", s.Field, s.ProtoEnumNum)
		}
	}
}

// TestCoverage_UnitBearingFieldsAreMeasurements asserts that any signal
// carrying a physical UnitKind (Distance, Temperature, Pressure, Charge)
// is NOT classified into one of the non-measurement routing buckets
// (metadata, config, prefs). Setting-unit signals, which declare a unit
// dimension instead of measuring in it, are exempt — their Category is
// validated by TestCoverage_SettingUnitInvariants.
//
// This catches a class of routing mistakes where a unit-bearing signal
// (e.g. a temperature reading) gets misclassified into a non-measurement
// bucket and then gets silently dropped by the unit-history /
// unit-conversion layer, which only iterates measurement-bucket fields.
func TestCoverage_UnitBearingFieldsAreMeasurements(t *testing.T) {
	denied := sortedKeys(nonMeasurementCategories)

	for i := range Signals {
		s := &Signals[i]
		if s.UnitKind == UnitKindNone {
			continue
		}
		if s.IsSettingUnit {
			continue
		}
		if _, bad := nonMeasurementCategories[s.Category]; bad {
			t.Errorf("Field %q (enum=%d): UnitKind=%s but Category=%q is a non-measurement bucket; unit-bearing fields cannot be in %v", s.Field, s.ProtoEnumNum, s.UnitKind, s.Category, denied)
		}
	}
}

// sortedKeys returns the keys of the given set in lexical order so error
// messages and "allowed=…" hints are stable across test runs.
func sortedKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
