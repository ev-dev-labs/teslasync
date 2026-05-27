package normalize

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// settingUnitTracerName is the OpenTelemetry tracer name for spans
// emitted by observeSettingUnit. The Phase-10 trace-coverage audit
// greps for this constant.
const settingUnitTracerName = "normalize"

// observeSettingUnit records a Setting*Unit atomic into
// vehicle_unit_history. It is the dispatcher's only writer for the
// four IsSettingUnit signals; per ADR-004 #8 those signals are NOT
// also routed to a hot table.
//
// Per the codec canonical-string contract (see protomodel.DecodeValue),
// proto enum variants reach this observer as canonical short strings
// ("Miles" / "Kilometers" / "Fahrenheit" / "Celsius" / "Psi" / "Bar" /
// "Distance" / "Percent"); the observer is the SINGLE downstream
// site that maps those strings to (Kind, ActiveUnit) tuples for the
// hot persistence path. It MUST NOT type-assert against ftproto.*
// enum values — adding such an assertion duplicates the conversion
// contract and is a code-review block.
//
// Errors:
//
//   - the atomic's Value is not a string (a producer bug — the codec
//     guarantees string for ValueKindEnum): returns a wrapped
//     units.ErrUnsupportedField. Caller surfaces this via
//     ValuesProcessed{outcome="error"}.
//
//   - the canonical string is the *Unknown sentinel (e.g. "Unknown"
//     for DistanceUnit): returns a wrapped units.ErrUnsupportedUnit.
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
func (p *Pipeline) observeSettingUnit(ctx context.Context, atomic codec.Atomic, vehicleIntID int64) (err error) {
	ctx, span := otel.Tracer(settingUnitTracerName).Start(
		ctx,
		"normalize.observe_setting_unit",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(
			attribute.String("field", atomic.Field),
			attribute.Int64("vehicle_id", vehicleIntID),
		),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "observe_setting_unit")
		}
		span.End()
	}()

	kind, value, err := settingUnitKindAndValue(atomic.Field, atomic.Value)
	if err != nil {
		return err
	}
	span.SetAttributes(
		attribute.String("unit_kind", string(kind)),
		attribute.String("unit", string(value)),
	)
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

// settingUnitKindAndValue resolves a (Field, codec-canonicalized
// short string) pair to the (Kind, ActiveUnit) the unit-history table
// indexes against.
//
// The four cases mirror the protomodel.DecodeValue prefix-stripping
// output (see longestCommonPrefix in cmd/protogen-tesla/emit.go):
//
//	Field                    Codec output ("Miles"/"Bar"/etc.)
//	-----------------------  ----------------------------------
//	SettingDistanceUnit      "Miles" | "Kilometers" | "Unknown"
//	SettingTemperatureUnit   "Fahrenheit" | "Celsius" | "Unknown"
//	SettingTirePressureUnit  "Psi" | "Bar" | "Unknown"
//	SettingChargeUnit        "Distance" | "Percent" | "Unknown"
//
// Any other string (including "Unknown") yields ErrUnsupportedUnit.
// Anything that's not a string at all yields ErrUnsupportedField (a
// producer-side contract violation).
func settingUnitKindAndValue(field string, value any) (unithistory.Kind, units.ActiveUnit, error) {
	str, ok := value.(string)
	if !ok {
		return "", "", fmt.Errorf("%w: %s value of type %T (want string from codec)", units.ErrUnsupportedField, field, value)
	}
	switch field {
	case "SettingDistanceUnit":
		switch str {
		case "Miles":
			return unithistory.KindDistance, units.ActiveUnitMiles, nil
		case "Kilometers":
			return unithistory.KindDistance, units.ActiveUnitKilometers, nil
		default:
			return "", "", fmt.Errorf("%w: SettingDistanceUnit=%s", units.ErrUnsupportedUnit, str)
		}
	case "SettingTemperatureUnit":
		switch str {
		case "Fahrenheit":
			return unithistory.KindTemperature, units.ActiveUnitFahrenheit, nil
		case "Celsius":
			return unithistory.KindTemperature, units.ActiveUnitCelsius, nil
		default:
			return "", "", fmt.Errorf("%w: SettingTemperatureUnit=%s", units.ErrUnsupportedUnit, str)
		}
	case "SettingTirePressureUnit":
		switch str {
		case "Psi":
			return unithistory.KindPressure, units.ActiveUnitPSI, nil
		case "Bar":
			return unithistory.KindPressure, units.ActiveUnitBar, nil
		default:
			return "", "", fmt.Errorf("%w: SettingTirePressureUnit=%s", units.ErrUnsupportedUnit, str)
		}
	case "SettingChargeUnit":
		switch str {
		case "Distance":
			return unithistory.KindCharge, units.ActiveUnitDistance, nil
		case "Percent":
			return unithistory.KindCharge, units.ActiveUnitPercent, nil
		default:
			return "", "", fmt.Errorf("%w: SettingChargeUnit=%s", units.ErrUnsupportedUnit, str)
		}
	default:
		return "", "", fmt.Errorf("%w: %q is not a Setting*Unit field", units.ErrUnsupportedField, field)
	}
}
