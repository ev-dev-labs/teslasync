// Package units is the one place in the Tesla telemetry pipeline where
// raw producer values get converted to canonical SI. Per ADR-004 #4
// "every unit-bearing field is converted to canonical SI at one place,"
// and ToSI in this package IS that one place.
//
// ToSI is a 3-arg pure function:
//
//	ToSI(field string, raw float64, active ActiveUnit) (float64, error)
//
// The third argument is non-negotiable. A 2-arg form (field, raw) would
// imply a hardcoded wire-unit assumption (e.g. "always assume km for
// distance"), which is wrong: Tesla emits distances in either mi or km
// depending on the per-vehicle SettingDistanceUnit at sample time, and
// that preference can transition mid-day. The unit-history layer
// (prompt 0022) materialises the active unit per (vehicle, sample-time);
// the normalize pipeline (prompt 0028) joins it onto every Atomic and
// calls ToSI. The package itself owns no I/O and no state.
package units

import "errors"

// ActiveUnit is the wire-format unit the producer was emitting at the
// instant a sample was generated, as inferred from the corresponding
// Setting{Distance,Temperature,TirePressure,Charge}Unit signal in the
// vehicle's unit history. The string form is the value persisted by
// the unit-history layer so ActiveUnit round-trips through the database
// without a mapping table.
type ActiveUnit string

const (
	// ActiveUnitMiles is SettingDistanceUnit=Mi: distances are in miles
	// and linear speeds are in miles per hour.
	ActiveUnitMiles ActiveUnit = "mi"
	// ActiveUnitKilometers is SettingDistanceUnit=Km: distances are in
	// kilometres and linear speeds are in kilometres per hour.
	ActiveUnitKilometers ActiveUnit = "km"
	// ActiveUnitFahrenheit is SettingTemperatureUnit=F.
	ActiveUnitFahrenheit ActiveUnit = "F"
	// ActiveUnitCelsius is SettingTemperatureUnit=C — already SI for
	// temperature, so the conversion is the identity.
	ActiveUnitCelsius ActiveUnit = "C"
	// ActiveUnitPSI is SettingTirePressureUnit=Psi.
	ActiveUnitPSI ActiveUnit = "psi"
	// ActiveUnitBar is SettingTirePressureUnit=Bar.
	ActiveUnitBar ActiveUnit = "bar"
	// ActiveUnitDistance is SettingChargeUnit=ChargeUnitDistance:
	// informational only — it tells the UI to prefer range over
	// percentage when rendering charge state. The SoC scalar itself
	// is always in %; ToSI does not convert it.
	ActiveUnitDistance ActiveUnit = "charge_distance"
	// ActiveUnitPercent is SettingChargeUnit=ChargeUnitPercent:
	// informational only — see ActiveUnitDistance.
	ActiveUnitPercent ActiveUnit = "charge_percent"
)

// ErrNoUnitContext is returned by ToSI when active is the empty string.
// The normalize pipeline returns this for Atomics whose (vehicle,
// sample-time) join against unit_history yielded no row — typically
// because the vehicle joined the cohort mid-day and we have not yet
// observed a Setting*Unit emission for it. ToSI does not silently
// default to one of the unit choices because "default to km" would
// silently corrupt a US car. The caller drops the sample and bumps a
// counter so an alert can fire if the rate stays non-zero.
var ErrNoUnitContext = errors.New("units: no active unit available for vehicle")

// ErrUnsupportedField is returned by ToSI when the field is either
// unknown to protomodel.SignalsByName or is known but has UnitKindNone
// (and is not on the speed-override list). The prompt phrases this as
// "field not unit-bearing"; both arms map to the same sentinel because
// a caller invoking ToSI on a non-unit-bearing field is, in either
// case, a programmer bug rather than a runtime data-quality problem.
var ErrUnsupportedField = errors.New("units: field not unit-bearing")

// ErrUnsupportedUnit is returned by ToSI when the active unit is
// incompatible with the field's UnitKind, e.g. attempting to convert
// an Odometer reading (UnitKindDistance) with active="psi". Both the
// regular conversion path and the speed-override path return this
// sentinel on a table miss.
var ErrUnsupportedUnit = errors.New("units: active unit incompatible with field's UnitKind")
