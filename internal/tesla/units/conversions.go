package units

import "github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"

// conversions maps a (UnitKind, ActiveUnit) pair to the closure that
// converts the raw producer value to canonical SI.
//
// SI canonical forms by UnitKind:
//
//	UnitKindDistance     -> meters
//	UnitKindTemperature  -> Celsius
//	UnitKindPressure     -> Pascals
//	UnitKindCharge       -> (no conversion; SoC scalar is always %)
//
// The math constants are exact where possible:
//
//	1 mile  = 1609.344 m   (international mile, NIST)
//	1 km    = 1000     m
//	°F -> °C = (°F - 32) * 5/9
//	1 psi   = 6894.757 Pa  (NIST SP 811)
//	1 bar   = 100000   Pa  (definition)
//
// UnitKindCharge has no entry. SoC values are always emitted in % and
// the SettingChargeUnit pair (charge_distance vs charge_percent) is
// informational for the UI rather than a unit conversion. Attempting
// to convert a UnitKindCharge field through ToSI therefore returns
// ErrUnsupportedUnit, which is the correct behaviour: a caller invoking
// ToSI on Soc has a logic bug.
var conversions = map[protomodel.UnitKind]map[ActiveUnit]func(float64) float64{
	protomodel.UnitKindDistance: {
		ActiveUnitMiles:      func(mi float64) float64 { return mi * 1609.344 },
		ActiveUnitKilometers: func(km float64) float64 { return km * 1000.0 },
	},
	protomodel.UnitKindTemperature: {
		ActiveUnitFahrenheit: func(f float64) float64 { return (f - 32.0) * 5.0 / 9.0 },
		ActiveUnitCelsius:    func(c float64) float64 { return c },
	},
	protomodel.UnitKindPressure: {
		ActiveUnitPSI: func(psi float64) float64 { return psi * 6894.757 },
		ActiveUnitBar: func(b float64) float64 { return b * 100000.0 },
	},
}

// speedConversions covers linear-velocity fields that follow
// SettingDistanceUnit but whose canonical SI form is metres per second
// (NOT metres). The conversions are derived from the distance table
// divided by 3600 seconds per hour:
//
//	mph  -> m/s   raw * 0.44704                 (= 1609.344 / 3600)
//	km/h -> m/s   raw * (1000.0 / 3600.0)
//
// The literal 1000.0/3600.0 is left as a runtime division so the
// arithmetic identity with the distance table is visible at the call
// site; the Go compiler folds this to a constant at build time.
var speedConversions = map[ActiveUnit]func(float64) float64{
	ActiveUnitMiles:      func(mph float64) float64 { return mph * 0.44704 },
	ActiveUnitKilometers: func(kmh float64) float64 { return kmh * (1000.0 / 3600.0) },
}

// speedFields lists the linear-velocity proto fields that follow
// SettingDistanceUnit but are intentionally classified UnitKindNone in
// SignalMeta because their canonical SI form is m/s rather than meters.
//
// Membership is intentionally narrow:
//
//   - VehicleSpeed   the vehicle's road speed.
//   - CruiseSetSpeed the cruise-control set point.
//
// The DiAxleSpeed{R,F,REL,RER} fields are explicitly NOT included —
// they carry rotational axle speed (RPM), which does not convert
// linearly with SettingDistanceUnit. HvacFanSpeed is similarly
// excluded; it is a fan-level scalar.
//
// A more principled fix would be to introduce a UnitKindSpeed in
// protomodel/types.go, but that requires changes to the codegen, the
// reflective coverage test's deny-list, and the unit-history layer in
// lockstep. The speed-override list is the forward-compatible
// workaround until that refactor is scheduled.
var speedFields = map[string]bool{
	"VehicleSpeed":   true,
	"CruiseSetSpeed": true,
}

// isSpeedField reports whether the given field name is on the
// speed-override list. Exposed as a separate helper so the dispatcher
// in units.go reads top-to-bottom without an inline map literal.
func isSpeedField(field string) bool {
	return speedFields[field]
}

// fixedBarPressureFields lists TpmsPressure proto fields whose raw
// value is ALWAYS reported in bar by Tesla Fleet Telemetry, regardless
// of the user's SettingTirePressureUnit (which only controls how the
// in-car UI renders the value, not the wire format). Without this
// override, ToSI would multiply a 3.15 bar reading by 6894.757 when
// SettingTirePressureUnit=Psi, producing a 21,718 Pa value that is
// 6.9× the true pressure (~315,000 Pa).
//
// Source: https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data
// (TpmsPressureFl/Fr/Rl/Rr unit: bar). The semi-truck variants
// SemitruckTpmsPressureRe* are omitted here because TeslaSync does not
// currently target semi-truck telemetry; if support is added they
// follow the same fixed-bar contract.
var fixedBarPressureFields = map[string]bool{
	"TpmsPressureFl": true,
	"TpmsPressureFr": true,
	"TpmsPressureRl": true,
	"TpmsPressureRr": true,
}

// isFixedBarPressureField reports whether the given field name is a
// TpmsPressure field whose wire-format unit is fixed at bar.
func isFixedBarPressureField(field string) bool {
	return fixedBarPressureFields[field]
}

// fixedMileDistanceFields lists Tesla Fleet Telemetry distance fields
// whose raw value is ALWAYS reported in miles regardless of the user's
// SettingDistanceUnit (which only controls how the in-car UI renders
// the value, not the wire format). Without this override, ToSI would
// multiply a 27,210 mi odometer reading by 1000 when
// SettingDistanceUnit=Kilometers, storing 27,210,000 m instead of the
// correct 43,790,000 m — a 1.609× error that corrupts cumulative
// drive-distance math (drives spanning a mid-drive unit transition
// produce nonsense distances such as 10,334 mi for a 10 mi trip).
//
// Source: empirical Fleet Telemetry capture 2026-05-24 across a
// user-initiated mi → km → mi transition (vehicle_id=1). The raw
// numeric Odometer wire value stayed continuous across the unit
// change (27,210.92 mi → 27,211.26 → ... → 27,254.78 → 27,254.36 mi)
// only under the always-miles interpretation; the km interpretation
// would require the vehicle's lifetime mileage to drop by 16,000 mi
// in under a minute, which is physically impossible. Same pattern was
// confirmed for RatedRange (153.66 → 153.58 numeric continuity across
// the same transition).
//
// MilesSinceReset / SelfDrivingMilesSinceReset are included because
// their proto field names explicitly encode the wire unit (Tesla's
// convention for fields whose wire value is fixed in miles, distinct
// from settings-following fields like VehicleSpeed).
//
// MilesToArrival is included for the same reason: the name encodes
// the wire unit and the field carries a remaining-distance scalar
// whose semantics are identical to Odometer.
//
// CurrentLimitMph is INTENTIONALLY EXCLUDED: although its name encodes
// mph, it carries a speed-limit value whose downstream semantics are
// unclear and it is not exercised by current TeslaSync feature paths.
// Add it here only with empirical evidence its wire value is always
// miles AND a downstream consumer that depends on the conversion.
//
// ChargeRateMilePerHour is INTENTIONALLY EXCLUDED: it is pinned by
// TestRangeAddedMetersPerHour_R2_AuditPin as UnitKindDistance with a
// deliberate misnomer in its proto identifier. The wire payload is
// meters of range added per hour, not mph. Changing its conversion path
// requires a coordinated codec and JSON rename and is out of scope for
// the always-miles override.
var fixedMileDistanceFields = map[string]bool{
	"Odometer":                   true,
	"RatedRange":                 true,
	"EstBatteryRange":            true,
	"IdealBatteryRange":          true,
	"MilesToArrival":             true,
	"MilesSinceReset":            true,
	"SelfDrivingMilesSinceReset": true,
}

// IsFixedMileDistanceField reports whether the given field name is a
// Tesla distance/range field whose wire-format unit is fixed at miles
// regardless of SettingDistanceUnit. Exported so the normalize
// pipeline can bypass the per-vehicle unit-history lookup for these
// fields — they need no unit context and MUST NOT be dropped on
// histRepo.ErrNotFound.
func IsFixedMileDistanceField(field string) bool {
	return fixedMileDistanceFields[field]
}

// fixedKiloToBaseFields lists Tesla charging fields whose wire values use
// kilo-units independent of every Setting*Unit preference. The canonical
// pipeline stores energy in Wh and power in W, so each value must be scaled
// by 1000 before it reaches signal.Store, signal_log, or charging_telemetry.
//
// Source: Tesla Fleet Telemetry "Available Data" documents
// AC/DCChargingEnergyIn in kWh and AC/DCChargingPower in kW:
// https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data
var fixedKiloToBaseFields = map[string]bool{
	"ACChargingEnergyIn": true,
	"DCChargingEnergyIn": true,
	"ACChargingPower":    true,
	"DCChargingPower":    true,
}

// IsFixedKiloToBaseField reports whether a Tesla field has a fixed kWh/kW
// wire unit that must be converted to Wh/W without consulting unit history.
func IsFixedKiloToBaseField(field string) bool {
	return fixedKiloToBaseFields[field]
}
