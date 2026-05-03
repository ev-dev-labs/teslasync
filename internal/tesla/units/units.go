package units

import (
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// ToSI converts raw to canonical SI for field, given the active unit
// that the vehicle was emitting at sample time. It is the one and only
// place in the codebase that performs this conversion; downstream
// callers (signal.Store writers, signal_log inserts, analytics) consume
// SI values exclusively.
//
// Canonical SI forms by UnitKind (and the speed-override list):
//
//	UnitKindDistance       -> meters
//	UnitKindTemperature    -> Celsius
//	UnitKindPressure       -> Pascals
//	{VehicleSpeed,CruiseSetSpeed} -> meters per second
//
// Errors:
//
//	ErrUnsupportedField   field is unknown to SignalsByName, or the
//	                      field is known but has UnitKindNone and is
//	                      not on the speed-override list.
//	ErrNoUnitContext      active is the empty string, meaning the
//	                      caller has no unit-history row for this
//	                      (vehicle, sample-time). The caller must drop
//	                      the sample rather than persist it under an
//	                      assumed unit.
//	ErrUnsupportedUnit    active is set but does not match a
//	                      conversion entry for the field's UnitKind
//	                      (e.g. an Odometer reading with active="psi"),
//	                      or for a speed field active is something
//	                      other than miles/km.
//
// The dispatcher checks the speed-override list BEFORE the
// UnitKindNone gate because VehicleSpeed and CruiseSetSpeed are
// classified UnitKindNone in the generated metadata (their SI form is
// m/s, which UnitKindDistance cannot represent without overloading).
// See conversions.go's speedFields comment for the longer-form note
// on why a UnitKindSpeed refactor is deferred.
func ToSI(field string, raw float64, active ActiveUnit) (float64, error) {
	meta, ok := protomodel.SignalsByName[field]
	if !ok {
		return 0, fmt.Errorf("%w: unknown field %q", ErrUnsupportedField, field)
	}

	if isSpeedField(field) {
		if active == "" {
			return 0, ErrNoUnitContext
		}
		fn, ok := speedConversions[active]
		if !ok {
			return 0, fmt.Errorf("%w: %s with %q", ErrUnsupportedUnit, field, active)
		}
		return fn(raw), nil
	}

	if meta.UnitKind == protomodel.UnitKindNone {
		return 0, fmt.Errorf("%w: %q", ErrUnsupportedField, field)
	}
	if active == "" {
		return 0, ErrNoUnitContext
	}
	table, ok := conversions[meta.UnitKind]
	if !ok {
		return 0, fmt.Errorf("%w: %s with %q (UnitKind %s)", ErrUnsupportedUnit, field, active, meta.UnitKind)
	}
	fn, ok := table[active]
	if !ok {
		return 0, fmt.Errorf("%w: %s with %q (UnitKind %s)", ErrUnsupportedUnit, field, active, meta.UnitKind)
	}
	return fn(raw), nil
}
