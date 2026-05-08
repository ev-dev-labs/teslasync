package units

import (
	"errors"
	"math"
	"testing"
)

// TestToSI is the table-driven coverage for ToSI. Per the prompt's
// minimum table requirements:
//
//	5 distance fields x {miles, km}
//	5 temperature fields x {F, C}
//	4 pressure fields x {psi, bar}
//	VehicleSpeed x {miles, km}
//	1 unit-bearing field x active="" -> ErrNoUnitContext
//	1 non-unit-bearing field         -> ErrUnsupportedField
//	1 mismatched unit                -> ErrUnsupportedUnit
//
// The table also exercises the speed-override path's empty-active and
// mismatched-unit branches, the unknown-field arm, and the
// UnitKindCharge no-conversion behaviour, all of which fall out of the
// design naturally and are cheap to assert.
func TestToSI(t *testing.T) {
	t.Parallel()

	const (
		// epsTight is for conversions whose constants are exact rationals
		// (km<->m, bar<->Pa, identity C->C, °F=32 -> 0°C, °F=-40 -> -40°C).
		epsTight = 1e-9
		// epsLoose is for conversions whose constants carry only six
		// significant figures (psi -> Pa via 6894.757) or whose result
		// is a rational with a long decimal expansion (e.g. (212-32)*5/9
		// = 100 in exact arithmetic but the 5.0/9.0 division introduces
		// a small rounding term in float64).
		epsLoose = 1e-6
	)

	cases := []struct {
		name      string
		field     string
		raw       float64
		active    ActiveUnit
		want      float64
		eps       float64
		wantErrIs error
	}{
		// --- DISTANCE: 5 fields x {miles, km} = 10 rows ---
		{name: "Odometer/miles", field: "Odometer", raw: 1, active: ActiveUnitMiles, want: 1609.344, eps: epsTight},
		{name: "Odometer/km", field: "Odometer", raw: 1, active: ActiveUnitKilometers, want: 1000, eps: epsTight},
		{name: "RatedRange/miles", field: "RatedRange", raw: 200, active: ActiveUnitMiles, want: 321868.8, eps: epsLoose},
		{name: "RatedRange/km", field: "RatedRange", raw: 300, active: ActiveUnitKilometers, want: 300000, eps: epsTight},
		{name: "EstBatteryRange/miles", field: "EstBatteryRange", raw: 150, active: ActiveUnitMiles, want: 241401.6, eps: epsLoose},
		{name: "EstBatteryRange/km", field: "EstBatteryRange", raw: 240, active: ActiveUnitKilometers, want: 240000, eps: epsTight},
		{name: "IdealBatteryRange/miles", field: "IdealBatteryRange", raw: 180, active: ActiveUnitMiles, want: 289681.92, eps: epsLoose},
		{name: "IdealBatteryRange/km", field: "IdealBatteryRange", raw: 290, active: ActiveUnitKilometers, want: 290000, eps: epsTight},
		{name: "MilesToArrival/miles", field: "MilesToArrival", raw: 10, active: ActiveUnitMiles, want: 16093.44, eps: epsTight},
		{name: "MilesToArrival/km", field: "MilesToArrival", raw: 15, active: ActiveUnitKilometers, want: 15000, eps: epsTight},

		// --- TEMPERATURE: 5 fields x {F, C} = 10 rows ---
		{name: "DiHeatsinkTR/F", field: "DiHeatsinkTR", raw: 32, active: ActiveUnitFahrenheit, want: 0, eps: epsTight},
		{name: "DiHeatsinkTR/C", field: "DiHeatsinkTR", raw: 25, active: ActiveUnitCelsius, want: 25, eps: epsTight},
		{name: "DiStatorTempR/F", field: "DiStatorTempR", raw: 212, active: ActiveUnitFahrenheit, want: 100, eps: epsLoose},
		{name: "DiStatorTempR/C", field: "DiStatorTempR", raw: -40, active: ActiveUnitCelsius, want: -40, eps: epsTight},
		{name: "ModuleTempMax/F", field: "ModuleTempMax", raw: 68, active: ActiveUnitFahrenheit, want: 20, eps: epsLoose},
		{name: "ModuleTempMax/C", field: "ModuleTempMax", raw: 37, active: ActiveUnitCelsius, want: 37, eps: epsTight},
		{name: "InsideTemp/F", field: "InsideTemp", raw: 72, active: ActiveUnitFahrenheit, want: 22.222222222222, eps: epsLoose},
		{name: "InsideTemp/C", field: "InsideTemp", raw: 21, active: ActiveUnitCelsius, want: 21, eps: epsTight},
		{name: "OutsideTemp/F", field: "OutsideTemp", raw: -40, active: ActiveUnitFahrenheit, want: -40, eps: epsTight},
		{name: "OutsideTemp/C", field: "OutsideTemp", raw: 0, active: ActiveUnitCelsius, want: 0, eps: epsTight},

		// --- PRESSURE (TpmsPressure*): always bar over the wire,
		// regardless of SettingTirePressureUnit (the user setting only
		// controls the in-car display unit, not the wire format). The
		// active arg is therefore ignored for these fields — both the
		// "psi" user setting and the "bar" user setting must produce the
		// same Pa output for the same raw value. See conversions.go's
		// fixedBarPressureFields comment.
		{name: "TpmsPressureFl/active=psi_treated_as_bar", field: "TpmsPressureFl", raw: 2.2, active: ActiveUnitPSI, want: 220000, eps: epsTight},
		{name: "TpmsPressureFl/active=bar", field: "TpmsPressureFl", raw: 2.2, active: ActiveUnitBar, want: 220000, eps: epsTight},
		{name: "TpmsPressureFr/active=psi_treated_as_bar", field: "TpmsPressureFr", raw: 2.3, active: ActiveUnitPSI, want: 230000, eps: epsTight},
		{name: "TpmsPressureFr/active=bar", field: "TpmsPressureFr", raw: 2.3, active: ActiveUnitBar, want: 230000, eps: epsTight},
		{name: "TpmsPressureRl/active=psi_treated_as_bar", field: "TpmsPressureRl", raw: 2.0, active: ActiveUnitPSI, want: 200000, eps: epsTight},
		{name: "TpmsPressureRl/active=bar", field: "TpmsPressureRl", raw: 2.0, active: ActiveUnitBar, want: 200000, eps: epsTight},
		{name: "TpmsPressureRr/active=psi_treated_as_bar", field: "TpmsPressureRr", raw: 2.1, active: ActiveUnitPSI, want: 210000, eps: epsTight},
		{name: "TpmsPressureRr/active=bar", field: "TpmsPressureRr", raw: 2.1, active: ActiveUnitBar, want: 210000, eps: epsTight},
		// Empty active is also fine for fixed-bar fields — they do not
		// depend on unit-history context.
		{name: "TpmsPressureFl/no_active_still_converts", field: "TpmsPressureFl", raw: 3.15, active: "", want: 315000, eps: epsTight},

		// --- SPEED: VehicleSpeed x {mi, km} (prompt minimum) + CruiseSetSpeed for breadth ---
		{name: "VehicleSpeed/mph_to_ms", field: "VehicleSpeed", raw: 60, active: ActiveUnitMiles, want: 60 * 0.44704, eps: epsLoose},
		{name: "VehicleSpeed/kmh_to_ms", field: "VehicleSpeed", raw: 100, active: ActiveUnitKilometers, want: 100 * (1000.0 / 3600.0), eps: epsLoose},
		{name: "CruiseSetSpeed/mph_to_ms", field: "CruiseSetSpeed", raw: 70, active: ActiveUnitMiles, want: 70 * 0.44704, eps: epsLoose},

		// --- ERROR PATHS ---
		{name: "Odometer/no_active", field: "Odometer", raw: 100, active: "", wantErrIs: ErrNoUnitContext},
		{name: "PackVoltage/non_unit_bearing", field: "PackVoltage", raw: 400, active: ActiveUnitMiles, wantErrIs: ErrUnsupportedField},
		{name: "Odometer/wrong_unit", field: "Odometer", raw: 100, active: ActiveUnitPSI, wantErrIs: ErrUnsupportedUnit},
		{name: "Unknown/unknown_field", field: "NotARealField", raw: 1, active: ActiveUnitMiles, wantErrIs: ErrUnsupportedField},
		{name: "VehicleSpeed/no_active", field: "VehicleSpeed", raw: 60, active: "", wantErrIs: ErrNoUnitContext},
		{name: "VehicleSpeed/wrong_unit", field: "VehicleSpeed", raw: 60, active: ActiveUnitPSI, wantErrIs: ErrUnsupportedUnit},
		{name: "Soc/no_charge_conversion", field: "Soc", raw: 80, active: ActiveUnitPercent, wantErrIs: ErrUnsupportedUnit},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := ToSI(tc.field, tc.raw, tc.active)
			if tc.wantErrIs != nil {
				if err == nil {
					t.Fatalf("ToSI(%q, %v, %q) = (%v, nil); want error wrapping %v", tc.field, tc.raw, tc.active, got, tc.wantErrIs)
				}
				if !errors.Is(err, tc.wantErrIs) {
					t.Fatalf("ToSI(%q, %v, %q) error = %v; want wrapping %v", tc.field, tc.raw, tc.active, err, tc.wantErrIs)
				}
				return
			}
			if err != nil {
				t.Fatalf("ToSI(%q, %v, %q) unexpected error: %v", tc.field, tc.raw, tc.active, err)
			}
			if math.Abs(got-tc.want) > tc.eps {
				t.Fatalf("ToSI(%q, %v, %q) = %v; want %v (+/- %v)", tc.field, tc.raw, tc.active, got, tc.want, tc.eps)
			}
		})
	}
}

// TestToSI_PurityNoMutation verifies that repeated calls with the same
// arguments return the same result and that ToSI does not retain or
// mutate the conversion tables. This is a smoke test for the pure-
// function contract; the gate's race-detector run is the primary
// concurrency assertion.
func TestToSI_PurityNoMutation(t *testing.T) {
	t.Parallel()
	for i := 0; i < 1000; i++ {
		got, err := ToSI("Odometer", 1, ActiveUnitMiles)
		if err != nil {
			t.Fatalf("iteration %d: unexpected error: %v", i, err)
		}
		if math.Abs(got-1609.344) > 1e-9 {
			t.Fatalf("iteration %d: ToSI(Odometer, 1, mi) = %v; want 1609.344", i, got)
		}
	}
}

// TestActiveUnit_StringValuesStable pins the wire-format string of
// every ActiveUnit constant. The unit-history layer (prompt 0022)
// persists ActiveUnit as a TEXT column so any change to these strings
// would silently invalidate historical rows.
func TestActiveUnit_StringValuesStable(t *testing.T) {
	t.Parallel()
	cases := []struct {
		got  ActiveUnit
		want string
	}{
		{ActiveUnitMiles, "mi"},
		{ActiveUnitKilometers, "km"},
		{ActiveUnitFahrenheit, "F"},
		{ActiveUnitCelsius, "C"},
		{ActiveUnitPSI, "psi"},
		{ActiveUnitBar, "bar"},
		{ActiveUnitDistance, "charge_distance"},
		{ActiveUnitPercent, "charge_percent"},
	}
	for _, tc := range cases {
		if string(tc.got) != tc.want {
			t.Errorf("ActiveUnit %q drift: got %q, want %q", tc.want, string(tc.got), tc.want)
		}
	}
}

// TestChargeRateMilePerHour_R2_AuditPin pins the Phase-48 R2 risk-register
// finding so a future codec / metadata change cannot silently re-classify
// the field and corrupt charge-rate JSON output.
//
// R2 finding (.github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md):
//
//	The ChargeRateMilePerHour proto field is metadata-typed
//	UnitKindDistance, NOT UnitKindSpeed. After ToSI(...) with a Miles
//	user setting, the value flowing into signal.Store and downstream
//	JSON is "meters of range added per hour" (raw mph * 1609.344), NOT
//	a true SI velocity in m/s.
//
// The downstream JSON field name `charge_rate_mph` is therefore a
// misnomer — the value at runtime is m/h, not mph. Slice 2 of the SI
// canonical mega-PR renames the JSON field to a name that reflects the
// real semantics (e.g. `range_added_meters_per_hour`) and is documented
// in the Slice 2 plan.
//
// This test fails loudly if anyone retypes the field as
// UnitKindSpeed (which would require a /3600 division and a different
// JSON name) or removes the speed-override classification path —
// either change MUST be a coordinated codec-and-rename PR, never an
// invisible metadata flip.
func TestChargeRateMilePerHour_R2_AuditPin(t *testing.T) {
	t.Parallel()

	const field = "ChargeRateMilePerHour"

	// Pin: the field MUST be UnitKindDistance per the methodology's
	// R2 finding. A future rename PR that changes this MUST also
	// rename the field at the JSON boundary in lockstep.
	{
		out, err := ToSI(field, 28.5, ActiveUnitMiles)
		if err != nil {
			t.Fatalf("ToSI(%s, 28.5, miles) returned err: %v", field, err)
		}
		// 28.5 mi * 1609.344 m/mi = 45866.304 m (per HOUR, despite the m units)
		want := 28.5 * 1609.344
		if math.Abs(out-want) > 1e-6 {
			t.Errorf("ToSI(%s, 28.5, miles) = %v, want %v (UnitKindDistance with miles user)", field, out, want)
		}
	}

	// Pin: NOT speed-override classified. If a future PR moves the
	// field to the speedFields list, the conversion factor changes
	// from *1609.344 to *0.44704 (a 3600× difference) and silently
	// corrupts every previously-stored charge-rate value. This test
	// is the canary.
	if isSpeedField(field) {
		t.Errorf("R2 invariant broken: %s is now classified as a speed field. "+
			"This changes the ToSI conversion factor by 3600× and requires a "+
			"coordinated DB / JSON rename. See Phase-48 methodology R2.", field)
	}
}
