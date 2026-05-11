// Package unithistory persists per-vehicle, point-in-time wire-format
// unit history for the Tesla telemetry pipeline (ADR-004 #4).
//
// Tesla Fleet Telemetry emits Setting{Distance,Temperature,TirePressure,
// Charge}Unit signals each time a vehicle's user toggles a preference.
// The values that follow (Odometer, BatteryRange, OutsideTemp, Tpms*,
// VehicleSpeed, ...) are emitted in the wire-format unit that was active
// at sample time. Downstream consumers — the units.ToSI converter, the
// normalize pipeline (prompt 0028), analytics, and replay — therefore
// need to know which unit was active for a given (vehicle, sample-time).
// That mapping lives in the vehicle_unit_history table; this package is
// the only writer and the only reader.
//
// The package is split across three files:
//
//	types.go   constants, Entry, sentinel error, prometheus metrics
//	repo.go    Repo interface + pgRepo (pgxpool-backed) implementation
//	cache.go   Cache type wrapping a Redis client + in-process sync.Map
//
// Repo.Record is the only insert path: it INSERTs (idempotent on
// (vehicle_id, unit_kind, effective_from, unit_value, source)) and then
// invalidates the cache for the affected key. Repo.At resolves the
// active unit at any timestamp by selecting the row with the largest
// effective_from <= t (with the BIGSERIAL id as a deterministic
// tiebreaker for collisions at the same instant). Repo.Latest is a
// convenience for callers that need "what is active right now."
//
// The package never reads or writes user display preferences — those
// live in the user-settings tables and are a completely different
// concern. Confusing the two would corrupt a vehicle's unit history
// every time a user changed their UI preference, so the SQL comment on
// the table makes this contract explicit.
package unithistory

import (
	"errors"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// Kind enumerates the four wire-format unit families Tesla Fleet
// Telemetry exposes via Setting*Unit signals. The string form is the
// value persisted in vehicle_unit_history.unit_kind so Kind round-trips
// through the database without a mapping table; the migration's CHECK
// constraint mirrors this set exactly.
type Kind string

const (
	// KindDistance is the unit family for Odometer, Rated/Est/Ideal
	// BatteryRange, MilesToArrival and similar linear-distance fields.
	// Setting values: ActiveUnitMiles, ActiveUnitKilometers.
	KindDistance Kind = "distance"
	// KindTemperature is the unit family for InsideTemp, OutsideTemp,
	// DiHeatsink/DiStator/Module temperature fields. Setting values:
	// ActiveUnitFahrenheit, ActiveUnitCelsius.
	KindTemperature Kind = "temperature"
	// KindPressure is the unit family for TpmsPressure{Fl,Fr,Rl,Rr}.
	// Setting values: ActiveUnitPSI, ActiveUnitBar.
	KindPressure Kind = "pressure"
	// KindCharge is the unit family for the SoC display preference
	// (range-vs-percent). Setting values: ActiveUnitDistance,
	// ActiveUnitPercent. The SoC scalar itself is always emitted in %
	// and is not converted by units.ToSI; KindCharge is recorded so
	// the UI can pick the user-preferred display form.
	KindCharge Kind = "charge"
)

// allKinds is the closed set of valid Kind values, exposed for the
// migration-CHECK-mirror invariant test.
var allKinds = []Kind{KindDistance, KindTemperature, KindPressure, KindCharge}

// AllKinds returns a copy of the closed Kind set. Used by callers that
// need to iterate over every unit family (e.g. the bootstrap layer).
func AllKinds() []Kind {
	out := make([]Kind, len(allKinds))
	copy(out, allKinds)
	return out
}

// Source records why a row was written. The migration's CHECK constraint
// mirrors this set; adding a new source requires a new migration.
type Source string

const (
	// SourceTelemetry is the normal path: a Setting*Unit signal arrived
	// over MQTT and the codec emitted an Atomic that the normalize
	// pipeline routed here.
	SourceTelemetry Source = "telemetry"
	// SourceRESTBootstrap is the cold-start path: at process boot, the
	// REST bootstrap (prompt 0023) calls Tesla's /vehicle_data endpoint
	// for every known vehicle to seed unit_history before live
	// telemetry begins. The effective_from is time.Now() at boot since
	// REST has no per-sample timestamp.
	SourceRESTBootstrap Source = "rest_bootstrap"
	// SourceManual is for operator-injected rows (e.g. backfill scripts
	// resolving a known vehicle's pre-Phase-42 history). Should be rare
	// in production.
	SourceManual Source = "manual"
)

// allSources is the closed set of valid Source values, exposed for the
// migration-CHECK-mirror invariant test.
var allSources = []Source{SourceTelemetry, SourceRESTBootstrap, SourceManual}

// AllSources returns a copy of the closed Source set.
func AllSources() []Source {
	out := make([]Source, len(allSources))
	copy(out, allSources)
	return out
}

// Entry is one row of vehicle_unit_history. The id column on the
// underlying table is a BIGSERIAL tiebreaker that callers do not need
// to set — pgRepo.Record fills it via DEFAULT and the read path uses
// it via ORDER BY id DESC to pick a deterministic winner among rows
// inserted at the same effective_from instant. Callers that read an
// Entry back via Latest will not see the id either; the package keeps
// the column an internal implementation detail.
type Entry struct {
	VehicleID     int64
	Kind          Kind
	Value         units.ActiveUnit
	EffectiveFrom time.Time
	Source        Source
}

// ErrNotFound is returned by Repo.At and Repo.Latest when the
// vehicle/kind combination has no rows in vehicle_unit_history (or, for
// At, no rows with effective_from <= t). The normalize pipeline
// translates this into a "drop sample + bump counter" decision rather
// than guessing a default unit, because guessing would silently corrupt
// a US car's data the moment we assumed km.
var ErrNotFound = errors.New("unit_history: no entry for vehicle/kind at time")

// invalidateFailuresTotal counts Redis DEL failures during cache
// invalidation. Per the cross-pod cache-invalidation contract, a Redis
// DEL failure during Repo.Record is logged and counted but does NOT
// roll back the PostgreSQL insert — the eventual-consistency window of
// 60s (the Redis EX TTL) is acceptable and a hard failure here would
// block ingest. A non-zero rate of "redis_del" failures indicates Redis
// is unreachable for some pods and other pods will read stale units for
// up to 60s after a Setting*Unit change.
//
// The fully-qualified Prometheus name is
// tesla_unit_history_invalidate_failures_total — the gate's grep for
// that exact substring pins it so a typo cannot silently rename the
// metric without breaking the prompt's verification.
var invalidateFailuresTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "unit_history",
	Name:      "invalidate_failures_total",
	Help: "Cache-invalidation failures during Repo.Record. " +
		"Reason 'redis_del' = Redis unreachable; pods read stale unit for up to TTL (60s). " +
		"Public metric name: tesla_unit_history_invalidate_failures_total.",
}, []string{"reason"})
