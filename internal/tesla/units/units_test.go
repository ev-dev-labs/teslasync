package units

import (
	"errors"
	"math"
	"testing"
)

// TestToSI covers the required conversion matrix:
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
		// Fixed-mile fields: Odometer, RatedRange, etc.
		// These fields are ALWAYS emitted in miles over the wire
		// regardless of SettingDistanceUnit; the active arg must be
		// ignored. Mirror the TpmsPressure fixed-bar coverage pattern:
		// every active value (mi, km, "") must produce the same SI
		// output. See conversions.go's fixedMileDistanceFields comment.
		{name: "Odometer/active=mi_treated_as_mi", field: "Odometer", raw: 27210.92, active: ActiveUnitMiles, want: 27210.92 * 1609.344, eps: epsLoose},
		{name: "Odometer/active=km_treated_as_mi", field: "Odometer", raw: 27210.92, active: ActiveUnitKilometers, want: 27210.92 * 1609.344, eps: epsLoose},
		{name: "Odometer/no_active_still_converts", field: "Odometer", raw: 27210.92, active: "", want: 27210.92 * 1609.344, eps: epsLoose},
		{name: "Odometer/wrong_unit_treated_as_mi", field: "Odometer", raw: 100, active: ActiveUnitPSI, want: 100 * 1609.344, eps: epsLoose},
		{name: "RatedRange/active=mi_treated_as_mi", field: "RatedRange", raw: 200, active: ActiveUnitMiles, want: 321868.8, eps: epsLoose},
		{name: "RatedRange/active=km_treated_as_mi", field: "RatedRange", raw: 200, active: ActiveUnitKilometers, want: 321868.8, eps: epsLoose},
		{name: "EstBatteryRange/active=mi_treated_as_mi", field: "EstBatteryRange", raw: 150, active: ActiveUnitMiles, want: 241401.6, eps: epsLoose},
		{name: "EstBatteryRange/active=km_treated_as_mi", field: "EstBatteryRange", raw: 150, active: ActiveUnitKilometers, want: 241401.6, eps: epsLoose},
		{name: "IdealBatteryRange/active=mi_treated_as_mi", field: "IdealBatteryRange", raw: 180, active: ActiveUnitMiles, want: 289681.92, eps: epsLoose},
		{name: "IdealBatteryRange/active=km_treated_as_mi", field: "IdealBatteryRange", raw: 180, active: ActiveUnitKilometers, want: 289681.92, eps: epsLoose},
		{name: "MilesToArrival/active=mi_treated_as_mi", field: "MilesToArrival", raw: 10, active: ActiveUnitMiles, want: 16093.44, eps: epsTight},
		{name: "MilesToArrival/active=km_treated_as_mi", field: "MilesToArrival", raw: 10, active: ActiveUnitKilometers, want: 16093.44, eps: epsTight},
		{name: "MilesSinceReset/active=mi_treated_as_mi", field: "MilesSinceReset", raw: 50, active: ActiveUnitMiles, want: 50 * 1609.344, eps: epsTight},
		{name: "MilesSinceReset/active=km_treated_as_mi", field: "MilesSinceReset", raw: 50, active: ActiveUnitKilometers, want: 50 * 1609.344, eps: epsTight},
		{name: "SelfDrivingMilesSinceReset/active=mi_treated_as_mi", field: "SelfDrivingMilesSinceReset", raw: 25, active: ActiveUnitMiles, want: 25 * 1609.344, eps: epsTight},
		{name: "SelfDrivingMilesSinceReset/active=km_treated_as_mi", field: "SelfDrivingMilesSinceReset", raw: 25, active: ActiveUnitKilometers, want: 25 * 1609.344, eps: epsTight},

		// Fixed charging kilo-units: Tesla emits energy in kWh and power in
		// kW regardless of vehicle unit preferences. They bypass unit
		// history and land in the canonical pipeline as Wh/W.
		{name: "ACChargingEnergyIn/kWh_to_Wh", field: "ACChargingEnergyIn", raw: 15.089164733886719, active: "", want: 15089.164733886719, eps: epsLoose},
		{name: "DCChargingEnergyIn/kWh_to_Wh", field: "DCChargingEnergyIn", raw: 42.5, active: ActiveUnitMiles, want: 42500, eps: epsTight},
		{name: "ACChargingPower/kW_to_W", field: "ACChargingPower", raw: 7.2, active: "", want: 7200, eps: epsTight},
		{name: "DCChargingPower/kW_to_W", field: "DCChargingPower", raw: 250, active: ActiveUnitPSI, want: 250000, eps: epsTight},

		// Temperature fields.
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

		// TpmsPressure* fields are always bar over the wire,
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

		// Speed fields.
		{name: "VehicleSpeed/mph_to_ms", field: "VehicleSpeed", raw: 60, active: ActiveUnitMiles, want: 60 * 0.44704, eps: epsLoose},
		{name: "VehicleSpeed/kmh_to_ms", field: "VehicleSpeed", raw: 100, active: ActiveUnitKilometers, want: 100 * (1000.0 / 3600.0), eps: epsLoose},
		{name: "CruiseSetSpeed/mph_to_ms", field: "CruiseSetSpeed", raw: 70, active: ActiveUnitMiles, want: 70 * 0.44704, eps: epsLoose},

		// Error paths.
		// The Odometer no_active / wrong_unit cases moved to the
		// fixed-mile success arm above. VehicleSpeed retains its
		// active-unit-required contract since speed follows the user
		// setting (see normalize_test.go TestPipelineHappyPath for
		// the empirical evidence — VehicleSpeed wire values change
		// numerically across a SettingDistanceUnit transition,
		// Odometer does not).
		{name: "PackVoltage/non_unit_bearing", field: "PackVoltage", raw: 400, active: ActiveUnitMiles, wantErrIs: ErrUnsupportedField},
		{name: "Unknown/unknown_field", field: "NotARealField", raw: 1, active: ActiveUnitMiles, wantErrIs: ErrUnsupportedField},
		{name: "VehicleSpeed/no_active", field: "VehicleSpeed", raw: 60, active: "", wantErrIs: ErrNoUnitContext},
		{name: "VehicleSpeed/wrong_unit", field: "VehicleSpeed", raw: 60, active: ActiveUnitPSI, wantErrIs: ErrUnsupportedUnit},
		{name: "Soc/no_charge_conversion", field: "Soc", raw: 80, active: ActiveUnitPercent, wantErrIs: ErrUnsupportedUnit},
		// InsideTemp is a UnitKindTemperature field that DOES follow
		// the user setting (SettingTemperatureUnit) and still
		// requires unit context; pin the contract.
		{name: "InsideTemp/no_active", field: "InsideTemp", raw: 70, active: "", wantErrIs: ErrNoUnitContext},
		{name: "InsideTemp/wrong_unit", field: "InsideTemp", raw: 70, active: ActiveUnitPSI, wantErrIs: ErrUnsupportedUnit},
		// CurrentLimitMph is UnitKindDistance but INTENTIONALLY
		// EXCLUDED from the fixed-mile override (semantics unclear,
		// not exercised by feature paths). It must still require
		// unit context so a future change to its classification is
		// loud rather than silent.
		{name: "CurrentLimitMph/no_active", field: "CurrentLimitMph", raw: 65, active: "", wantErrIs: ErrNoUnitContext},
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
// every ActiveUnit constant. The unit-history layer persists ActiveUnit
// as a TEXT column so any change to these strings
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

// TestRangeAddedMetersPerHour_R2_AuditPin pins the ChargeRateMilePerHour
// proto-field semantics so a future codec or metadata change cannot
// silently re-classify the field and corrupt charge-rate JSON output.
//
//	The ChargeRateMilePerHour proto field is metadata-typed
//	UnitKindDistance, NOT UnitKindSpeed. After ToSI(...) with a Miles
//	user setting, the value flowing into signal.Store and downstream
//	JSON is "meters of range added per hour" (raw mph * 1609.344), NOT
//	a true SI velocity in m/s.
//
// The downstream JSON field name `range_added_meters_per_hour` is therefore a
// misnomer: the value at runtime is m/h, not mph. Any JSON-boundary
// rename must stay coordinated with this conversion path.
//
// This test fails loudly if anyone retypes the field as
// UnitKindSpeed (which would require a /3600 division and a different
// JSON name) or removes the speed-override classification path —
// either change MUST be a coordinated codec-and-rename PR, never an
// invisible metadata flip.
func TestRangeAddedMetersPerHour_R2_AuditPin(t *testing.T) {
	t.Parallel()

	const field = "ChargeRateMilePerHour"

	// Pin: the field MUST remain UnitKindDistance. A future rename PR
	// that changes this MUST also rename the field at the JSON boundary
	// in lockstep.
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
