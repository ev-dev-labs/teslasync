package normalize

import (
	"context"
	"fmt"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
)

// observeSettingUnit records a Setting*Unit atomic into
// vehicle_unit_history. It is the dispatcher's only writer for the
// four IsSettingUnit signals; per ADR-004 #8 those signals are NOT
// also routed to a hot table.
//
// The mapping table (proto enum -> unit_history.Kind, ActiveUnit) is
// derived from the four ftproto enum families (DistanceUnit,
// TemperatureUnit, PressureUnit, ChargeUnitPreference) declared in
// the vendored vehicle_data.proto. The codegen in
// internal/tesla/protomodel emits SignalMeta entries that mark
// these four Fields as IsSettingUnit=true; the SignalMeta carries
// the UnitKind so the dispatcher knows which Kind to record without
// an additional lookup table here.
//
// Errors:
//
//   - the atomic's Value is not the expected ftproto.<EnumType>
//     variant for its Field: returns a wrapped
//     units.ErrUnsupportedField. Caller surfaces this via
//     ValuesProcessed{outcome="error"}.
//
//   - the proto enum value is the *Unknown sentinel (e.g.
//     DistanceUnitUnknown): returns a wrapped units.ErrUnsupportedUnit.
//     Per ADR-004 we MUST NOT silently substitute mi/km/F/C/etc.;
//     the producer is explicitly telling us it does not know the
//     unit, and persisting an "unknown" row would corrupt every
//     subsequent At lookup.
//
//   - histRepo.Record returned an error: returns the wrapped error.
//     Caller logs + bumps outcome="error" and continues.
//
// On the happy path the row is inserted with source SourceTelemetry
// and effective_from = atomic.EmittedAt. The Repo's ON CONFLICT DO
// NOTHING contract makes the call idempotent: a replayed payload
// writes zero rows the second time and the cache invalidation still
// fires (the next read will repopulate from PG and observe the same
// state).
func (p *Pipeline) observeSettingUnit(ctx context.Context, atomic codec.Atomic, vehicleIntID int64) error {
	kind, value, err := settingUnitKindAndValue(atomic.Field, atomic.Value)
	if err != nil {
		return err
	}
	entry := unithistory.Entry{
		VehicleID:     vehicleIntID,
		Kind:          kind,
		Value:         value,
		EffectiveFrom: atomic.EmittedAt,
		Source:        unithistory.SourceTelemetry,
	}
	if err := p.histRepo.Record(ctx, entry); err != nil {
		return fmt.Errorf("normalize: observeSettingUnit(%s): %w", atomic.Field, err)
	}
	return nil
}

// settingUnitKindAndValue resolves a (Field, decoded enum value)
// pair to the (Kind, ActiveUnit) the unit-history table indexes
// against. The mapping is hand-rolled because the generator does
// not emit it directly — the four enum families are declared in
// the vendored proto, but the (Field -> Kind) and
// (enum-value -> ActiveUnit) projections are normalize-package
// concerns rather than protomodel concerns.
//
// The four cases mirror the prompt's mapping table verbatim:
//
//	SettingDistanceUnit     -> distance:    DistanceUnitMiles=mi,
//	                            DistanceUnitKilometers=km
//	SettingTemperatureUnit  -> temperature: TemperatureUnitFahrenheit=F,
//	                            TemperatureUnitCelsius=C
//	SettingTirePressureUnit -> pressure:    PressureUnitPsi=psi,
//	                            PressureUnitBar=bar
//	SettingChargeUnit       -> charge:      ChargeUnitDistance=charge_distance,
//	                            ChargeUnitPercent=charge_percent
func settingUnitKindAndValue(field string, value any) (unithistory.Kind, units.ActiveUnit, error) {
	switch field {
	case "SettingDistanceUnit":
		v, ok := value.(ftproto.DistanceUnit)
		if !ok {
			return "", "", fmt.Errorf("%w: SettingDistanceUnit value of type %T (want ftproto.DistanceUnit)", units.ErrUnsupportedField, value)
		}
		switch v {
		case ftproto.DistanceUnit_DistanceUnitMiles:
			return unithistory.KindDistance, units.ActiveUnitMiles, nil
		case ftproto.DistanceUnit_DistanceUnitKilometers:
			return unithistory.KindDistance, units.ActiveUnitKilometers, nil
		default:
			return "", "", fmt.Errorf("%w: SettingDistanceUnit=%s", units.ErrUnsupportedUnit, v)
		}
	case "SettingTemperatureUnit":
		v, ok := value.(ftproto.TemperatureUnit)
		if !ok {
			return "", "", fmt.Errorf("%w: SettingTemperatureUnit value of type %T (want ftproto.TemperatureUnit)", units.ErrUnsupportedField, value)
		}
		switch v {
		case ftproto.TemperatureUnit_TemperatureUnitFahrenheit:
			return unithistory.KindTemperature, units.ActiveUnitFahrenheit, nil
		case ftproto.TemperatureUnit_TemperatureUnitCelsius:
			return unithistory.KindTemperature, units.ActiveUnitCelsius, nil
		default:
			return "", "", fmt.Errorf("%w: SettingTemperatureUnit=%s", units.ErrUnsupportedUnit, v)
		}
	case "SettingTirePressureUnit":
		v, ok := value.(ftproto.PressureUnit)
		if !ok {
			return "", "", fmt.Errorf("%w: SettingTirePressureUnit value of type %T (want ftproto.PressureUnit)", units.ErrUnsupportedField, value)
		}
		switch v {
		case ftproto.PressureUnit_PressureUnitPsi:
			return unithistory.KindPressure, units.ActiveUnitPSI, nil
		case ftproto.PressureUnit_PressureUnitBar:
			return unithistory.KindPressure, units.ActiveUnitBar, nil
		default:
			return "", "", fmt.Errorf("%w: SettingTirePressureUnit=%s", units.ErrUnsupportedUnit, v)
		}
	case "SettingChargeUnit":
		v, ok := value.(ftproto.ChargeUnitPreference)
		if !ok {
			return "", "", fmt.Errorf("%w: SettingChargeUnit value of type %T (want ftproto.ChargeUnitPreference)", units.ErrUnsupportedField, value)
		}
		switch v {
		case ftproto.ChargeUnitPreference_ChargeUnitDistance:
			return unithistory.KindCharge, units.ActiveUnitDistance, nil
		case ftproto.ChargeUnitPreference_ChargeUnitPercent:
			return unithistory.KindCharge, units.ActiveUnitPercent, nil
		default:
			return "", "", fmt.Errorf("%w: SettingChargeUnit=%s", units.ErrUnsupportedUnit, v)
		}
	default:
		return "", "", fmt.Errorf("%w: %q is not a Setting*Unit field", units.ErrUnsupportedField, field)
	}
}
