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
