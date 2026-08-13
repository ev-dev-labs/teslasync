package normalize

import (
	"context"
	"errors"
	"fmt"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// ErrNoUnitContext is the normalize-package sentinel returned by
// toSI when the Repo.At lookup yields unithistory.ErrNotFound. It
// is the LOUD form of "we have no unit history for this
// (vehicle, EmittedAt)" — the caller drops the atomic and bumps
// UnitContextMissing rather than guessing a default unit, because
// guessing "km" would silently corrupt a US car the moment we
// assumed it.
//
// We define a normalize-local sentinel (rather than re-exporting
// units.ErrNoUnitContext) so callers can distinguish the no-history
// case (a data-quality problem the bootstrap layer is responsible
// for resolving) from the units.ErrNoUnitContext case (a programmer
// bug — a caller invoking units.ToSI with active="").
var ErrNoUnitContext = errors.New("normalize: no unit history for vehicle/kind at emitted_at")

// outcome label constants for the values_processed metric. The set
// is closed and matches ADR-004 #8's contract; adding a new outcome
// requires updating the dashboards built against that contract.
const (
	outcomeOK             = "ok"
	outcomeDroppedNoUnit  = "dropped_no_unit"
	outcomeDroppedInvalid = "dropped_invalid"
	outcomeDroppedNoRoute = "dropped_no_route"
	outcomeError          = "error"
)

// Metrics bundles the two CounterVecs the Pipeline emits. The struct
// shape is part of the package's public surface so a future caller
// (out-of-process renderer, alternate registry) can substitute its
// own backend without rewriting Pipeline. Production wiring uses
// defaultMetrics, which is registered against
// prometheus.DefaultRegisterer at package init via promauto.
//
// The label sets are LOCKED by ADR-004 #8:
//
//	ValuesProcessed:    field, outcome  (outcome ∈ {ok,
//	                    dropped_no_unit, dropped_invalid,
//	                    dropped_no_route, error})
//	UnitContextMissing: field
//
// Cardinality is bounded: `field` is the closed set of
// protomodel.Signals.Field strings (~250 entries) and `outcome` is
// the 5-element set above, so the total label-pair count is at most
// ~1250 per Prometheus instance.
type Metrics struct {
	// ValuesProcessed counts every atomic the dispatch loop touches,
	// labelled by the canonical Field name and the per-atomic
	// outcome bucket. Setting*Unit atomics increment outcomeOK on
	// successful Record; the value-bearing dispatch path increments
	// the appropriate bucket on success or the corresponding drop
	// reason on failure.
	ValuesProcessed *prometheus.CounterVec

	// UnitContextMissing counts the subset of dropped_no_unit
	// outcomes by Field. It is a separate metric (rather than a
	// label-derived view of ValuesProcessed) so the alert rule —
	// "any vehicle has been emitting unit-bearing values for >5min
	// without a unit-history row" — can be expressed as a simple
	// rate() on a single series rather than a filter expression.
	UnitContextMissing *prometheus.CounterVec
}

// defaultMetrics is the package-level singleton used by New. It is
// initialised via promauto so registration happens exactly once at
// import time against prometheus.DefaultRegisterer; double-Register
// panics are impossible because there is no other call site.
//
// The fully-qualified Prometheus names are
// tesla_normalize_values_processed_total and
// tesla_normalize_unit_context_missing_total. The grep-friendly
// substring `tesla_normalize_` is used by dashboards and alerts.
var defaultMetrics = &Metrics{
	ValuesProcessed: promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "tesla",
		Subsystem: "normalize",
		Name:      "values_processed_total",
		Help: "Atomic values traversed by normalize.Pipeline.processOne, " +
			"labelled by canonical proto field name and per-atomic outcome " +
			"bucket {ok, dropped_no_unit, dropped_invalid, dropped_no_route, error}. " +
			"Public metric: tesla_normalize_values_processed_total.",
	}, []string{"field", "outcome"}),
	UnitContextMissing: promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "tesla",
		Subsystem: "normalize",
		Name:      "unit_context_missing_total",
		Help: "Atomic values dropped because vehicle_unit_history had no row " +
			"for the field's UnitKind at the atomic's EmittedAt. A non-zero " +
			"rate indicates the bootstrap layer (or live SettingUnit emission) " +
			"has not yet seeded unit context for the vehicle. Public metric: " +
			"tesla_normalize_unit_context_missing_total.",
	}, []string{"field"}),
}

// toSI converts a unit-bearing atomic to canonical SI given the active unit
// at the atomic's EmittedAt. Fixed-wire charging fields bypass unit history
// and convert kWh/kW to Wh/W directly. For atomics whose Field is dimensionless
// (UnitKindNone and not on an override list) or whose Field is UnitKindCharge
// (SoC scalars are always %), the function returns the atomic unchanged.
//
// Errors:
//
//   - ErrNoUnitContext  the Repo had no unit-history row for the
//     vehicle/kind at the atomic's EmittedAt. The caller drops the
//     atomic and bumps UnitContextMissing + ValuesProcessed{outcome=
//     "dropped_no_unit"}.
//
//   - units.ErrUnsupportedField / units.ErrUnsupportedUnit  the
//     active unit returned by the Repo does not match a conversion
//     entry. This is a deployment drift between the proto, the
//     unit-history layer, and the units conversion table; the
//     caller drops the atomic and bumps ValuesProcessed{outcome=
//     "dropped_invalid"}.
//
//   - any other error  unrecoverable infrastructure failure
//     (Repo.At returned a wrapped pgx error). The caller drops +
//     bumps outcome="error" and continues with the next atomic.
//
// On the happy path the returned codec.Atomic has the same Field /
// EmittedAt / VehicleID as the input and Value replaced with the
// SI scalar (float64).
func (p *Pipeline) toSI(ctx context.Context, atomic codec.Atomic, vehicleIntID int64) (codec.Atomic, error) {
	meta := protomodel.SignalsByName[atomic.Field]

	// Pass-through cases: dimensionless field with no speed-override
	// (e.g. Gear, BatteryHeaterOn), and the UnitKindCharge family
	// (Soc, BatteryLevel) whose values are always %.
	if !needsConversion(atomic.Field, meta) {
		return atomic, nil
	}

	// Fixed-wire-unit fields bypass unit history entirely. Distance/range
	// fields are always miles; charging energy/power fields are always
	// kWh/kW. Neither family may be dropped because a vehicle has no
	// unit_history row.
	if units.IsFixedMileDistanceField(atomic.Field) ||
		units.IsFixedKiloToBaseField(atomic.Field) {
		raw, ok := coerceFloat(atomic.Value)
		if !ok {
			return codec.Atomic{}, fmt.Errorf("%w: %s value of type %T not coercible to float64", units.ErrUnsupportedField, atomic.Field, atomic.Value)
		}
		siValue, err := units.ToSI(atomic.Field, raw, "")
		if err != nil {
			return codec.Atomic{}, fmt.Errorf("normalize: units.ToSI(%s, %v, fixed-wire): %w", atomic.Field, raw, err)
		}
		atomic.Value = siValue
		return atomic, nil
	}

	kind, ok := kindFromMeta(atomic.Field, meta)
	if !ok {
		// Defensive: needsConversion returned true so kindFromMeta
		// MUST have a Kind for this Field. Reaching here is a
		// generator-drift bug.
		return codec.Atomic{}, fmt.Errorf("normalize: no unit_history.Kind for field %q (UnitKind=%s)", atomic.Field, unitKindString(meta))
	}

	active, err := p.histRepo.At(ctx, vehicleIntID, kind, atomic.EmittedAt)
	if errors.Is(err, unithistory.ErrNotFound) {
		p.metrics.UnitContextMissing.WithLabelValues(atomic.Field).Inc()
		return codec.Atomic{}, ErrNoUnitContext
	}
	if err != nil {
		return codec.Atomic{}, fmt.Errorf("normalize: histRepo.At(%d, %s, %s): %w", vehicleIntID, kind, atomic.EmittedAt.Format("2006-01-02T15:04:05Z07:00"), err)
	}

	raw, ok := coerceFloat(atomic.Value)
	if !ok {
		// A unit-bearing field whose Value is not a numeric scalar
		// is a producer/codec contract violation. Tagged
		// outcome="dropped_invalid" via units.ErrUnsupportedField so
		// the closed outcome set holds without inventing a new bucket.
		return codec.Atomic{}, fmt.Errorf("%w: %s value of type %T not coercible to float64", units.ErrUnsupportedField, atomic.Field, atomic.Value)
	}

	siValue, err := units.ToSI(atomic.Field, raw, active)
	if err != nil {
		return codec.Atomic{}, fmt.Errorf("normalize: units.ToSI(%s, %v, %s): %w", atomic.Field, raw, active, err)
	}

	atomic.Value = siValue
	return atomic, nil
}

// needsConversion reports whether toSI should perform a conversion for the
// field. The cases that DO need conversion:
//
//   - UnitKindDistance / UnitKindTemperature / UnitKindPressure: the
//     value is in the wire-format unit and must be converted to SI
//     (meters / Celsius / Pascals).
//
//   - the speed-override list (VehicleSpeed, CruiseSetSpeed): the
//     SignalMeta UnitKind is None (because their canonical SI form
//     is m/s, which UnitKindDistance cannot express without
//     overloading), but units.ToSI handles them via an internal
//     speed-conversions table given the active distance unit.
//
//   - fixed kWh/kW charging fields: UnitKindNone metadata, but Tesla's
//     documented wire unit must be scaled to Wh/W without unit history.
//
// UnitKindCharge is intentionally a pass-through: SoC scalars are
// always emitted in % and units.ToSI returns ErrUnsupportedUnit for
// them. The SettingChargeUnit signal is recorded for UI display
// preference only.
func needsConversion(field string, meta *protomodel.SignalMeta) bool {
	if isSpeedField(field) || units.IsFixedKiloToBaseField(field) {
		return true
	}
	if meta == nil {
		return false
	}
	switch meta.UnitKind {
	case protomodel.UnitKindDistance, protomodel.UnitKindTemperature, protomodel.UnitKindPressure:
		return true
	default:
		return false
	}
}

// kindFromMeta maps a (Field, SignalMeta) to the unithistory.Kind
// that the unit-history layer indexes against. The speed-override
// list short-circuits to KindDistance because the speed fields'
// active unit comes from SettingDistanceUnit even though their
// SignalMeta.UnitKind is None. For UnitKindCharge the function
// returns KindCharge for completeness (callers may use it to
// observe SettingChargeUnit history) even though needsConversion
// returns false for charge fields.
//
// Returns (kind, false) when the field has no mapping — either
// SignalMeta is nil or its UnitKind is None and the field is not
// on the speed-override list.
func kindFromMeta(field string, meta *protomodel.SignalMeta) (unithistory.Kind, bool) {
	if isSpeedField(field) {
		return unithistory.KindDistance, true
	}
	if meta == nil {
		return "", false
	}
	switch meta.UnitKind {
	case protomodel.UnitKindDistance:
		return unithistory.KindDistance, true
	case protomodel.UnitKindTemperature:
		return unithistory.KindTemperature, true
	case protomodel.UnitKindPressure:
		return unithistory.KindPressure, true
	case protomodel.UnitKindCharge:
		return unithistory.KindCharge, true
	}
	return "", false
}

// speedFields mirrors units.speedFields (which is package-private to
// the units package). The list is short and stable; if a third
// speed field is added the two lists get bumped together. Keeping a
// local copy avoids a cyclic exposure of an internal symbol from
// units just to satisfy normalize, and the package doc comment in
// units/conversions.go names the fields explicitly so the bump is
// hard to miss in code review.
var speedFields = map[string]bool{
	"VehicleSpeed":   true,
	"CruiseSetSpeed": true,
}

// isSpeedField reports whether the field is on the speed-override
// list. Exposed as a separate helper so call sites read top-to-
// bottom without an inline map literal.
func isSpeedField(field string) bool {
	return speedFields[field]
}

// coerceFloat widens the protomodel.DecodeValue numeric variants
// (int32 / int64 / float32 / float64) to a float64 for units.ToSI.
// Returns (0, false) for any non-numeric type so the caller can
// classify the drop as outcome="dropped_invalid" rather than
// silently substituting NaN.
func coerceFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int64:
		return float64(x), true
	case int32:
		return float64(x), true
	case int:
		return float64(x), true
	default:
		return 0, false
	}
}

// unitKindString renders meta's UnitKind for diagnostic logging.
// Defensive against a nil meta so the format-string call site
// doesn't need a separate guard.
func unitKindString(meta *protomodel.SignalMeta) string {
	if meta == nil {
		return "<nil-meta>"
	}
	return meta.UnitKind.String()
}
