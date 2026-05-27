// Package worker — unit-drift validator.
//
// Decision 9 (phase-42 ADR-004) mandates dynamic per-vehicle wire units
// with a fail-closed "drop value if no unit context" policy. The catch:
// if Tesla's docs are wrong AND we set interval_seconds=1 on Setting*Unit
// AND those settings still don't stream as expected, the pipeline could
// silently store nothing while believing itself healthy.
//
// UnitDriftValidator is the independent cross-check that catches that
// failure mode. It NEVER mutates stored data — corruption forensics, not
// corruption silent-fix. It compares VehicleSpeed (canonical SI m/s) to
// implied-speed-from-Location-deltas (great-circle distance over time),
// applies the same comparison to Odometer increments and Inside/OutsideTemp
// range sanity, and emits two Prometheus signals:
//
//   - tesla_unit_drift_suspected_total{vehicle_id, kind}
//   - tesla_unit_history_canary_total{vehicle_id, reason}  (companion warn)
//
// Plus a structured zerolog WARN with full context per finding so an
// operator paged on the metric can triage without database access.
//
// Source of truth for SI units: ADR-004 #9 + internal/tesla/units.
// Storage layout: migrations/000186_signal_log.up.sql columns:
// (vehicle_id, ts, field, value_kind, str_value, bool_value, int_value,
// float_value, time_value).
package worker

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// unitDriftTracerName scopes spans for the periodic unit-drift validator.
const unitDriftTracerName = "internal/worker/unit_drift"

func unitDriftTracer() oteltrace.Tracer { return otel.Tracer(unitDriftTracerName) }

// vehicleRepoAdapter wraps *database.VehicleRepo so its GetAll method
// (which returns []*models.Vehicle) satisfies vehicleLister (which
// returns []int64). The validator never needs the rest of the
// Vehicle struct — just the ID — so flattening here keeps the
// interface minimal and the test seam tight.
type vehicleRepoAdapter struct {
	repo interface {
		GetAll(ctx context.Context) ([]*models.Vehicle, error)
	}
}

func (a *vehicleRepoAdapter) GetAll(ctx context.Context) ([]int64, error) {
	rows, err := a.repo.GetAll(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]int64, 0, len(rows))
	for _, v := range rows {
		if v != nil {
			out = append(out, v.ID)
		}
	}
	return out, nil
}

// driftKind labels for tesla_unit_drift_suspected_total. Closed set —
// keep this slice in sync with the alert-thresholds runbook.
const (
	driftKindSpeed    = "speed"     // VehicleSpeed vs. implied from Location deltas
	driftKindOdometer = "odometer"  // Odometer trip increment vs. integrated speed
	driftKindTempHigh = "temp_high" // InsideTemp / OutsideTemp out of plausible °C range
)

// canaryReason labels for tesla_unit_history_canary_total. Same closed-set
// convention as driftKind. "no_history_7d" surfaces the pipeline's own
// blind spot (Tesla isn't streaming Setting*Unit).
const (
	canaryNoHistory7d = "no_history_7d"
)

// driftSuspectedTotal counts validator findings — one increment per
// (vehicle_id, drift_kind) per validator pass that exceeds the
// drift-ratio threshold. Cardinality is bounded by fleet size × 3 kinds.
//
// Public metric name: tesla_unit_drift_suspected_total.
//
// Per the ADR-004 #9 alert threshold "rate > 0/h for 24h → PAGE", any
// non-zero increment means silent unit corruption is suspected and the
// fleet-telemetry-resubscribe runbook fires.
var driftSuspectedTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "unit_drift",
	Name:      "suspected_total",
	Help: "Findings from the nightly unit-drift validator that suggest " +
		"silent unit corruption. Closed kind set: speed (VehicleSpeed " +
		"vs Location-implied), odometer (trip delta vs integrated " +
		"speed), temp_high (Inside/OutsideTemp out of plausible °C " +
		"range). Public name: tesla_unit_drift_suspected_total.",
}, []string{"vehicle_id", "kind"})

// canaryTotal counts the warn-tier canary "no Setting*Unit history rows
// for vehicle X in the past 7 days". When this fires the validator's
// drift checks become unreliable for that vehicle (no unit context to
// compare against), and the next deploy's resubscribe MUST cover it.
//
// Public metric name: tesla_unit_history_canary_total.
var canaryTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "unit_history",
	Name:      "canary_total",
	Help: "Findings from the unit-drift validator's vehicle_unit_history " +
		"sanity check. Closed reason set: no_history_7d (no row in " +
		"vehicle_unit_history within the past 7 days; Setting*Unit not " +
		"streaming, run cmd/resubscribe). Public name: " +
		"tesla_unit_history_canary_total.",
}, []string{"vehicle_id", "reason"})

// Default thresholds. Tuned conservative — the validator is a forensic
// cross-check, not a hot-loop hair-trigger. False positives create
// page-fatigue; false negatives create silent corruption — bias toward
// false negatives (require a clear ratio mismatch).
const (
	// driftSpeedRatioMin / Max define the acceptable VehicleSpeed-to-
	// implied-speed ratio. ±15% covers GPS noise and minor signal lag.
	driftSpeedRatioMin = 0.85
	driftSpeedRatioMax = 1.15

	// driftSpeedMinSamples is the minimum sample count required before
	// the speed check runs — fewer samples = unreliable rolling average.
	driftSpeedMinSamples = 10

	// driftSpeedMinMS / driftSpeedMinDistanceM are noise floors. Below
	// these the GPS quantization error dominates the implied-speed
	// calculation and the ratio is meaningless.
	driftSpeedMinMS        = 2.0  // 2 m/s ≈ 4.5 mph (walking pace)
	driftSpeedMinDistanceM = 50.0 // 50 m moved across the comparison window

	// tempPlausibleCelsiusMin/Max gate the temperature sanity check.
	// Tesla cabins/exteriors stay within these bounds in any
	// realistic climate; values outside indicate F-stored-as-C
	// (5°C → would read as ~41°F → 41 stored as °C reads back as 105.8°F).
	tempPlausibleCelsiusMin = -50.0
	tempPlausibleCelsiusMax = 80.0

	// canaryNoHistoryWindow is the maximum age of the most-recent
	// vehicle_unit_history row before the canary fires. 7 days matches
	// the runbook threshold and the chunk_time_interval of signal_log.
	canaryNoHistoryWindow = 7 * 24 * time.Hour

	// defaultLookback is how far back into signal_log a single Run pass
	// reads for drift comparisons. 1 hour matches the prompt spec.
	defaultLookback = time.Hour

	// defaultCronInterval is the nightly cadence the long-running
	// Start() loop wakes on. Configurable via Options.
	defaultCronInterval = 24 * time.Hour
)

// vehicleLister is the subset of database.VehicleRepo the validator
// needs. Carved as an interface so unit tests can inject without a
// real DB.
type vehicleLister interface {
	GetAll(ctx context.Context) ([]int64, error)
}

// signalReader is the subset of signal_log access the validator needs.
// Read-only — there is NO method on this interface that mutates.
// Tests inject in-memory slices; production wraps a *pgxpool.Pool.
type signalReader interface {
	// FloatSeries returns rows from signal_log filtered to a single
	// (vehicle_id, field) over a [from, to) time window, ordered by ts
	// ascending. Returns ([]TimedFloat, nil) on success. The caller is
	// responsible for handling len(out) == 0 (no samples in window).
	FloatSeries(ctx context.Context, vehicleID int64, field string, from, to time.Time) ([]TimedFloat, error)

	// LatestUnitHistoryAge returns the age of the most-recent
	// vehicle_unit_history row for the given vehicle. Returns
	// (0, ErrNoHistory) when the vehicle has no rows at all.
	LatestUnitHistoryAge(ctx context.Context, vehicleID int64, now time.Time) (time.Duration, error)
}

// ErrNoHistory signals that a vehicle has zero rows in
// vehicle_unit_history. Surfaced separately so the canary can fire on
// the actually-empty case (and not silently treat "no rows" as fresh).
var ErrNoHistory = errors.New("no vehicle_unit_history rows for vehicle")

// TimedFloat is one (ts, float_value) sample from signal_log. The
// validator does not need the other typed columns — every drift check
// operates on canonical SI floats.
type TimedFloat struct {
	Ts    time.Time
	Value float64
}

// Options tune Run / Start behavior. Zero-valued fields fall back to
// defaults so callers can pass &Options{} without surprising overrides.
type Options struct {
	Lookback     time.Duration // window into signal_log; 0 = defaultLookback (1h)
	CronInterval time.Duration // Start() cadence; 0 = defaultCronInterval (24h)
	DryRun       bool          // log findings but do not increment Prometheus counters
	OnlyVehicle  int64         // 0 = all vehicles; non-zero limits to one vehicle (CLI triage)
}

// UnitDriftValidator is the worker. Stateless beyond its dependencies —
// safe for concurrent Run() invocations from independent callers
// (though typical usage is one Start() loop per process).
type UnitDriftValidator struct {
	vehicles vehicleLister
	signals  signalReader

	// metricsMu protects the dry-run no-emit invariant: when DryRun is
	// true the validator must skip every counter Add. Guarded by this
	// mutex so a misconfigured Options.DryRun cannot race with an
	// in-flight Run.
	metricsMu sync.RWMutex
	dryRun    bool
}

// NewUnitDriftValidator constructs a validator wired to the production
// VehicleRepo and a SignalLogReader over the given pool. Tests bypass
// this constructor and inject the interfaces directly via
// NewUnitDriftValidatorWithDeps.
func NewUnitDriftValidator(db *database.DB, vehicleRepo *database.VehicleRepo) *UnitDriftValidator {
	return &UnitDriftValidator{
		vehicles: &vehicleRepoAdapter{repo: vehicleRepo},
		signals:  &pgxSignalReader{pool: db.Pool},
	}
}

// NewUnitDriftValidatorWithDeps is the testable constructor. Tests
// pass mock implementations of vehicleLister and signalReader.
func NewUnitDriftValidatorWithDeps(vehicles vehicleLister, signals signalReader) *UnitDriftValidator {
	return &UnitDriftValidator{vehicles: vehicles, signals: signals}
}

// Start runs the validator in a long-running cron loop. Blocks until
// ctx is cancelled. Designed for resilience.SafeGoLoop wiring.
//
// First pass executes immediately (so an operator restart doesn't have
// to wait for the next cron tick to verify health). Subsequent passes
// run every Options.CronInterval.
func (v *UnitDriftValidator) Start(ctx context.Context, opts Options) {
	cron := opts.CronInterval
	if cron <= 0 {
		cron = defaultCronInterval
	}
	v.applyDryRun(opts.DryRun)

	log.Info().
		Dur("cron_interval", cron).
		Bool("dry_run", opts.DryRun).
		Msg("unit-drift validator started")

	// Immediate first pass.
	if err := v.Run(ctx, opts); err != nil && !errors.Is(err, context.Canceled) {
		log.Warn().Err(err).Msg("unit-drift validator first pass failed")
	}

	ticker := time.NewTicker(cron)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("unit-drift validator stopping")
			return
		case <-ticker.C:
			if err := v.Run(ctx, opts); err != nil && !errors.Is(err, context.Canceled) {
				log.Warn().Err(err).Msg("unit-drift validator periodic pass failed")
			}
		}
	}
}

// Run executes a single validator pass. Returns nil even when drift is
// found — drift is a logged/counted finding, not an error from the
// caller's perspective. Returns a non-nil error only for genuine
// pipeline failures (DB query failed, context cancelled, etc.).
//
// Safe to call concurrently with Start (counters are atomic).
func (v *UnitDriftValidator) Run(ctx context.Context, opts Options) error {
	ctx, span := unitDriftTracer().Start(ctx, "unit_drift.validate_tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(
			attribute.Bool("unit_drift.dry_run", opts.DryRun),
			attribute.Int64("unit_drift.only_vehicle", opts.OnlyVehicle),
		),
	)
	defer span.End()

	v.applyDryRun(opts.DryRun)

	lookback := opts.Lookback
	if lookback <= 0 {
		lookback = defaultLookback
	}
	now := time.Now().UTC()
	from := now.Add(-lookback)

	vehicles, err := v.listVehicles(ctx, opts.OnlyVehicle)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "list vehicles failed")
		return fmt.Errorf("list vehicles: %w", err)
	}
	span.SetAttributes(attribute.Int("unit_drift.vehicle_count", len(vehicles)))

	for _, vid := range vehicles {
		if ctx.Err() != nil {
			span.RecordError(ctx.Err())
			span.SetStatus(codes.Error, "context cancelled")
			return ctx.Err()
		}
		v.checkVehicle(ctx, vid, from, now)
	}
	return nil
}

// listVehicles resolves OnlyVehicle filtering. Bypasses the repo when
// OnlyVehicle != 0 to avoid pulling the entire fleet just to discard
// all but one row.
func (v *UnitDriftValidator) listVehicles(ctx context.Context, only int64) ([]int64, error) {
	if only != 0 {
		return []int64{only}, nil
	}
	return v.vehicles.GetAll(ctx)
}

// checkVehicle runs every drift check for one vehicle. Each check
// shares the same SQL window so a slow pass doesn't drift between
// checks (e.g., one check at T+0 and the next at T+30s).
//
// Returns no error — every check logs its own outcome. The function
// exists as a compile-time grouping so adding a new check is a single
// edit (append a new line; don't have to thread it through Run).
func (v *UnitDriftValidator) checkVehicle(ctx context.Context, vehicleID int64, from, to time.Time) {
	v.checkSpeed(ctx, vehicleID, from, to)
	v.checkOdometer(ctx, vehicleID, from, to)
	v.checkTemperature(ctx, vehicleID, from, to)
	v.checkUnitHistoryCanary(ctx, vehicleID, to)
}

// checkSpeed compares VehicleSpeed (canonical SI m/s) to the speed
// implied by consecutive Location samples (great-circle distance over
// time delta). Drift indicates one of:
//   - VehicleSpeed stored as mph but un-tagged (DistanceUnit=Miles
//     pre-deploy with Setting*Unit not streaming).
//   - Location latitude/longitude in a non-WGS84 frame (extremely
//     unlikely; included for completeness).
//
// The check is intentionally conservative: requires ≥ driftSpeedMinSamples
// paired observations, both speed and implied-speed above the
// driftSpeedMinMS/distance noise floors, and a rolling-window mean
// ratio outside [driftSpeedRatioMin, driftSpeedRatioMax] to fire.
func (v *UnitDriftValidator) checkSpeed(ctx context.Context, vehicleID int64, from, to time.Time) {
	speeds, err := v.signals.FloatSeries(ctx, vehicleID, "VehicleSpeed", from, to)
	if err != nil {
		log.Warn().Int64("vehicle_id", vehicleID).Err(err).Msg("unit-drift: VehicleSpeed query failed")
		return
	}
	lats, err := v.signals.FloatSeries(ctx, vehicleID, "LocationLatitude", from, to)
	if err != nil {
		log.Warn().Int64("vehicle_id", vehicleID).Err(err).Msg("unit-drift: LocationLatitude query failed")
		return
	}
	lngs, err := v.signals.FloatSeries(ctx, vehicleID, "LocationLongitude", from, to)
	if err != nil {
		log.Warn().Int64("vehicle_id", vehicleID).Err(err).Msg("unit-drift: LocationLongitude query failed")
		return
	}

	pairs := pairLocations(lats, lngs)
	if len(pairs) < 2 || len(speeds) < driftSpeedMinSamples {
		return
	}

	ratios := computeSpeedRatios(speeds, pairs)
	if len(ratios) < driftSpeedMinSamples {
		return
	}
	mean := meanFloat(ratios)
	if mean >= driftSpeedRatioMin && mean <= driftSpeedRatioMax {
		return
	}

	log.Warn().
		Int64("vehicle_id", vehicleID).
		Float64("ratio_mean", mean).
		Int("samples", len(ratios)).
		Time("window_from", from).
		Time("window_to", to).
		Str("kind", driftKindSpeed).
		Msg("unit-drift suspected: VehicleSpeed vs Location-implied")
	v.incrementDrift(vehicleID, driftKindSpeed)
}

// checkOdometer compares the Odometer trip-mode increment over the
// window to the integrated speed (Σ vᵢ Δtᵢ). Both should be in meters;
// a ratio outside [0.85, 1.15] suggests the odometer was stored in
// miles while VehicleSpeed was in m/s (the most likely failure mode
// for a unit-context drop on Odometer specifically).
func (v *UnitDriftValidator) checkOdometer(ctx context.Context, vehicleID int64, from, to time.Time) {
	odo, err := v.signals.FloatSeries(ctx, vehicleID, "Odometer", from, to)
	if err != nil {
		log.Warn().Int64("vehicle_id", vehicleID).Err(err).Msg("unit-drift: Odometer query failed")
		return
	}
	speeds, err := v.signals.FloatSeries(ctx, vehicleID, "VehicleSpeed", from, to)
	if err != nil {
		// Already logged in checkSpeed — return silently to avoid
		// log spam.
		return
	}
	if len(odo) < 2 || len(speeds) < driftSpeedMinSamples {
		return
	}

	delta := odo[len(odo)-1].Value - odo[0].Value
	if delta < driftSpeedMinDistanceM {
		// Vehicle barely moved; ratio is dominated by quantization noise.
		return
	}
	integrated := integrateSpeed(speeds)
	if integrated < driftSpeedMinDistanceM {
		return
	}
	ratio := delta / integrated
	if ratio >= driftSpeedRatioMin && ratio <= driftSpeedRatioMax {
		return
	}

	log.Warn().
		Int64("vehicle_id", vehicleID).
		Float64("ratio", ratio).
		Float64("odometer_delta_m", delta).
		Float64("integrated_speed_m", integrated).
		Time("window_from", from).
		Time("window_to", to).
		Str("kind", driftKindOdometer).
		Msg("unit-drift suspected: Odometer vs integrated VehicleSpeed")
	v.incrementDrift(vehicleID, driftKindOdometer)
}

// checkTemperature ensures Inside/OutsideTemp samples stay within a
// plausible Celsius range. A sustained value outside [-50°C, +80°C]
// (e.g., 100+ from 100°F stored as 100°C) is the canonical
// fingerprint of a F→C unit-context drop.
func (v *UnitDriftValidator) checkTemperature(ctx context.Context, vehicleID int64, from, to time.Time) {
	for _, field := range []string{"InsideTemp", "OutsideTemp"} {
		series, err := v.signals.FloatSeries(ctx, vehicleID, field, from, to)
		if err != nil {
			log.Warn().Int64("vehicle_id", vehicleID).Str("field", field).Err(err).
				Msg("unit-drift: temperature query failed")
			continue
		}
		if len(series) == 0 {
			continue
		}
		var implausible int
		for _, s := range series {
			if s.Value < tempPlausibleCelsiusMin || s.Value > tempPlausibleCelsiusMax {
				implausible++
			}
		}
		// Require ≥ 50% of samples to be implausible before firing —
		// a single transient spike is sensor noise, not unit drift.
		if implausible*2 < len(series) {
			continue
		}
		log.Warn().
			Int64("vehicle_id", vehicleID).
			Str("field", field).
			Int("implausible_samples", implausible).
			Int("total_samples", len(series)).
			Time("window_from", from).
			Time("window_to", to).
			Str("kind", driftKindTempHigh).
			Msg("unit-drift suspected: temperature out of plausible Celsius range")
		v.incrementDrift(vehicleID, driftKindTempHigh)
	}
}

// checkUnitHistoryCanary fires the warn-tier canary when a vehicle has
// had no Setting*Unit telemetry in the past 7 days. Without those
// streams the validator's drift checks become unreliable for that
// vehicle, AND the next deploy's resubscribe MUST cover it before
// the fail-closed-drop policy starts dropping unit-bearing values.
func (v *UnitDriftValidator) checkUnitHistoryCanary(ctx context.Context, vehicleID int64, now time.Time) {
	age, err := v.signals.LatestUnitHistoryAge(ctx, vehicleID, now)
	switch {
	case errors.Is(err, ErrNoHistory):
		log.Warn().
			Int64("vehicle_id", vehicleID).
			Str("reason", canaryNoHistory7d).
			Msg("unit-drift canary: vehicle has zero vehicle_unit_history rows; resubscribe required")
		v.incrementCanary(vehicleID, canaryNoHistory7d)
	case err != nil:
		log.Warn().Int64("vehicle_id", vehicleID).Err(err).Msg("unit-drift: vehicle_unit_history query failed")
	case age > canaryNoHistoryWindow:
		log.Warn().
			Int64("vehicle_id", vehicleID).
			Dur("age", age).
			Str("reason", canaryNoHistory7d).
			Msg("unit-drift canary: vehicle_unit_history older than 7 days; Setting*Unit not streaming")
		v.incrementCanary(vehicleID, canaryNoHistory7d)
	}
}

// incrementDrift bumps the suspected counter unless dry-run is in
// effect. Dry-run findings are still logged (the caller's job) but
// must not push to Prometheus — operators use --dry-run for forensics
// without affecting the on-call alerting state.
func (v *UnitDriftValidator) incrementDrift(vehicleID int64, kind string) {
	v.metricsMu.RLock()
	dry := v.dryRun
	v.metricsMu.RUnlock()
	if dry {
		return
	}
	driftSuspectedTotal.WithLabelValues(fmt.Sprintf("%d", vehicleID), kind).Inc()
}

// incrementCanary mirrors incrementDrift for the canary metric. Same
// dry-run gate.
func (v *UnitDriftValidator) incrementCanary(vehicleID int64, reason string) {
	v.metricsMu.RLock()
	dry := v.dryRun
	v.metricsMu.RUnlock()
	if dry {
		return
	}
	canaryTotal.WithLabelValues(fmt.Sprintf("%d", vehicleID), reason).Inc()
}

func (v *UnitDriftValidator) applyDryRun(dry bool) {
	v.metricsMu.Lock()
	v.dryRun = dry
	v.metricsMu.Unlock()
}

// pairLocations zips a Latitude series and a Longitude series by
// timestamp. signal_log writes Latitude and Longitude as two atomics
// from the same Location compound, so they share the exact ts to the
// nanosecond — but defensive timestamp-matching covers the rare case
// of one being dropped en route.
func pairLocations(lats, lngs []TimedFloat) []TimedLocation {
	tsToLng := make(map[time.Time]float64, len(lngs))
	for _, l := range lngs {
		tsToLng[l.Ts] = l.Value
	}
	out := make([]TimedLocation, 0, len(lats))
	for _, lat := range lats {
		if lng, ok := tsToLng[lat.Ts]; ok {
			out = append(out, TimedLocation{Ts: lat.Ts, Lat: lat.Value, Lng: lng})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Ts.Before(out[j].Ts) })
	return out
}

// TimedLocation is a (ts, lat, lng) sample reconstructed from the
// LocationLatitude + LocationLongitude atomics.
type TimedLocation struct {
	Ts  time.Time
	Lat float64
	Lng float64
}

// computeSpeedRatios walks the location track + speed track and
// produces per-segment ratios of (recorded VehicleSpeed near segment
// midpoint) / (great-circle distance / dt). Skips segments below the
// noise floor.
func computeSpeedRatios(speeds []TimedFloat, locs []TimedLocation) []float64 {
	out := make([]float64, 0, len(locs))
	for i := 1; i < len(locs); i++ {
		prev, curr := locs[i-1], locs[i]
		dt := curr.Ts.Sub(prev.Ts).Seconds()
		if dt <= 0 {
			continue
		}
		dist := haversineMeters(prev.Lat, prev.Lng, curr.Lat, curr.Lng)
		if dist < driftSpeedMinDistanceM {
			continue
		}
		impliedMS := dist / dt
		if impliedMS < driftSpeedMinMS {
			continue
		}
		recorded := nearestSpeed(speeds, curr.Ts)
		if recorded < driftSpeedMinMS {
			continue
		}
		out = append(out, recorded/impliedMS)
	}
	return out
}

// nearestSpeed returns the VehicleSpeed sample with timestamp closest
// to the target. Linear scan; series is small (≤3600 samples in a 1h
// window at 1Hz) and called once per location-pair.
func nearestSpeed(speeds []TimedFloat, target time.Time) float64 {
	if len(speeds) == 0 {
		return 0
	}
	bestIdx := 0
	bestDelta := absDur(speeds[0].Ts.Sub(target))
	for i := 1; i < len(speeds); i++ {
		d := absDur(speeds[i].Ts.Sub(target))
		if d < bestDelta {
			bestDelta, bestIdx = d, i
		}
	}
	return speeds[bestIdx].Value
}

// integrateSpeed approximates ∫ v dt over the speed series with a
// trapezoidal rule. Used by checkOdometer; samples are typically 1Hz
// so the trapezoid error is negligible vs. the ±15% drift threshold.
func integrateSpeed(speeds []TimedFloat) float64 {
	if len(speeds) < 2 {
		return 0
	}
	var sum float64
	for i := 1; i < len(speeds); i++ {
		dt := speeds[i].Ts.Sub(speeds[i-1].Ts).Seconds()
		if dt <= 0 || dt > 3600 {
			// Drop pathological gaps; the integration is meaningless
			// across a multi-hour silence.
			continue
		}
		avg := (speeds[i].Value + speeds[i-1].Value) / 2
		sum += avg * dt
	}
	return sum
}

// haversineMeters returns great-circle distance between two
// (lat, lng) points in meters. WGS84 mean Earth radius (6,371 km)
// is accurate to ±0.5% for any pair of points on Earth.
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusM = 6371000.0
	dLat := degToRad(lat2 - lat1)
	dLng := degToRad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(degToRad(lat1))*math.Cos(degToRad(lat2))*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusM * c
}

func degToRad(d float64) float64 { return d * math.Pi / 180 }

func meanFloat(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum float64
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

func absDur(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// pgxSignalReader is the production signalReader implementation.
// Read-only by construction — every method below issues SELECT only.
type pgxSignalReader struct {
	pool *pgxpool.Pool
}

// FloatSeries reads (ts, float_value) from signal_log. Bound by the
// composite PK (vehicle_id, ts, field) and a time predicate so the
// query is a constant-cost index range scan regardless of fleet size.
//
// SELECT-only; this method does not contain any UPDATE / INSERT /
// DELETE statements (covenant: the validator must NEVER mutate).
func (r *pgxSignalReader) FloatSeries(ctx context.Context, vehicleID int64, field string, from, to time.Time) ([]TimedFloat, error) {
	const q = `SELECT ts, float_value
		FROM signal_log
		WHERE vehicle_id = $1
		  AND field = $2
		  AND ts >= $3
		  AND ts <  $4
		  AND float_value IS NOT NULL
		ORDER BY ts ASC`
	rows, err := r.pool.Query(ctx, q, vehicleID, field, from, to)
	if err != nil {
		return nil, fmt.Errorf("query signal_log float series for %s: %w", field, err)
	}
	defer rows.Close()
	out := make([]TimedFloat, 0, 64)
	for rows.Next() {
		var t TimedFloat
		if err := rows.Scan(&t.Ts, &t.Value); err != nil {
			return nil, fmt.Errorf("scan signal_log row: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// LatestUnitHistoryAge returns the age of the most-recent
// vehicle_unit_history row across ALL unit_kinds for the vehicle.
// Returns ErrNoHistory when zero rows exist.
//
// SELECT-only.
func (r *pgxSignalReader) LatestUnitHistoryAge(ctx context.Context, vehicleID int64, now time.Time) (time.Duration, error) {
	const q = `SELECT MAX(effective_from)
		FROM vehicle_unit_history
		WHERE vehicle_id = $1`
	var maxTs *time.Time
	if err := r.pool.QueryRow(ctx, q, vehicleID).Scan(&maxTs); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNoHistory
		}
		return 0, fmt.Errorf("query vehicle_unit_history latest: %w", err)
	}
	if maxTs == nil {
		return 0, ErrNoHistory
	}
	return now.Sub(*maxTs), nil
}
