// Package bootstrap seeds vehicle_unit_history for vehicles that have
// never connected to Fleet Telemetry by calling Tesla's REST
// /api/1/vehicles/{id}/vehicle_data endpoint at process startup (or on
// first connect) and writing one Entry per unit kind from the response's
// gui_settings block.
//
// Why this is needed (ADR-004 #4 + Decision 9e): the normalize pipeline
// drops any unit-bearing telemetry sample whose (vehicle, sample-time)
// has no row in vehicle_unit_history — guessing a default unit ("assume
// km") would silently corrupt a US car's data the moment we picked
// wrong. Live Fleet Telemetry seeds unit_history naturally as
// Setting{Distance,Temperature,TirePressure,Charge}Unit signals stream
// in, but a vehicle that has just been added to the cohort emits no
// Setting*Unit signal until the user toggles a preference. Without this
// belt-and-suspenders REST seed, that vehicle's first hour (or week)
// of telemetry would be silently dropped.
//
// The package owns ONLY the orchestration: retry policy, the
// gui_settings string-to-(Kind, ActiveUnit) mapping table, idempotent
// writes to unithistory.Repo, and the Prometheus
// tesla_bootstrap_skipped_total metric that surfaces "unprotected
// vehicle" alerts to operators. The actual REST call is hidden behind
// the VehicleDataClient interface so this package never imports
// net/http or hard-codes Tesla's URL path — the production wiring (a
// future prompt) implements the adapter that wraps internal/tesla.Client.
//
// File split:
//
//	types.go       VehicleDataClient interface, GuiSettings DTO,
//	               error sentinels, mapping table, prometheus metric.
//	bootstrap.go   Bootstrapper struct, Seed orchestrator, retry loop.
//	bootstrap_test.go  Fake client + fake repo, table tests for every
//	                   supported gui_settings value variant, retry
//	                   exhaustion, auth fast-fail, idempotent double
//	                   seed, context-cancel mid-backoff.
package bootstrap

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// VehicleDataClient is the narrow surface Bootstrapper needs from
// internal/tesla.Client. It is an interface so the test suite can
// substitute a recording fake without spinning up an HTTP server, and
// so the production wiring (a separate prompt — phase-42-0060+) can
// adapt internal/tesla.Client without re-touching this package.
//
// The interface is intentionally NOT *tesla.Client even though the
// prompt's struct sketch named that type literally: the existing
// VehicleDataResponse in internal/tesla/types.go does not include a
// gui_settings field, so a direct call to client.GetVehicleData
// silently throws away the data this package needs. The adapter that
// satisfies VehicleDataClient is responsible for decoding gui_settings
// out of the raw REST response — most likely by adding a GuiSettings
// field to VehicleDataResponse in a future migration that this prompt
// is not allowed to touch (allowed-files allowlist is bootstrap-only).
//
// Error contract — implementations MUST return ONE of:
//
//	nil               on success
//	ErrTransient      on 408/429/503/5xx (Bootstrapper retries)
//	ErrUnauthorized   on 401/403 (Bootstrapper returns immediately)
//	ErrBadGuiSettings on 200 with an unrecognised unit string
//	any other error   on terminal non-retryable failures
//
// Adapters SHOULD use errors.Join or fmt.Errorf("...: %w", ErrTransient)
// to wrap the underlying status/cause for diagnostics; Bootstrapper
// uses errors.Is to classify.
type VehicleDataClient interface {
	FetchGuiSettings(ctx context.Context, vehicleID int64) (GuiSettings, error)
}

// GuiSettings is the subset of /api/1/vehicles/{id}/vehicle_data's
// gui_settings block that Bootstrapper consumes. The four unit-string
// fields are the raw REST values verbatim (the mapping to typed
// (unithistory.Kind, units.ActiveUnit) lives in this package, not in
// the adapter, so all schema-drift detection is centralised here).
//
// Now is the response timestamp Tesla supplied for the snapshot
// instant — gui_settings reflect the user's preferences AT THAT
// MOMENT. If the adapter cannot extract it, a zero time.Time is
// acceptable: Bootstrapper falls back to time.Now() captured at the
// moment of the successful REST call.
type GuiSettings struct {
	DistanceUnits     string
	TemperatureUnits  string
	TirePressureUnits string
	ChargeRateUnits   string
	Now               time.Time
}

// ErrTransient is the sentinel adapters wrap when the underlying REST
// call returned a retryable status (408/429/503/5xx). Bootstrapper
// classifies via errors.Is and applies the backoff schedule.
var ErrTransient = errors.New("bootstrap: transient REST failure")

// ErrUnauthorized is the sentinel adapters wrap when the underlying
// REST call returned 401/403 (token issue). Bootstrapper returns it
// immediately without retry so the caller can re-auth.
var ErrUnauthorized = errors.New("bootstrap: unauthorized — caller should re-auth")

// ErrBadGuiSettings is returned when the REST call succeeded but a
// gui_settings unit string was unrecognised (schema drift on the Tesla
// side, or a brand new unit value we have not seen before). Returned
// by both the mapping table (resolveUnit) and Bootstrapper.Seed.
// Operators see this as a failed Seed call rather than a silently
// dropped row, which is the desired blast-radius: a single vehicle's
// bootstrap fails noisily, no bad rows get committed.
var ErrBadGuiSettings = errors.New("bootstrap: unrecognised gui_settings unit value")

// defaultBackoffs is the sleep-between-attempts schedule. Length+1 ==
// max attempts. The prompt phrases this as "max 3 attempts: 1s, 5s,
// 30s" — the two backoff slots consume 1s and 5s; 30s is consumed
// by defaultPerAttemptTimeout below as the per-call hard cap. All
// three numeric values are honoured.
var defaultBackoffs = []time.Duration{
	1 * time.Second,
	5 * time.Second,
}

// defaultPerAttemptTimeout is the context.WithTimeout deadline applied
// to each individual REST attempt. Bounds the worst-case Seed cost so
// a single hung connection cannot stall startup indefinitely.
const defaultPerAttemptTimeout = 30 * time.Second

// effectiveFromBuffer is subtracted from the snapshot timestamp to
// produce the effective_from we Record. The prompt phrases this as
// "the response's now() minus a small buffer" — 1s is small enough
// that a normal ingest cadence still treats this row as active for
// any subsequent telemetry, yet large enough that millisecond-level
// clock skew between the API server and the database does not flip
// the inequality in unit_history.At's "effective_from <= t" filter.
const effectiveFromBuffer = 1 * time.Second

// bootstrapSkippedTotal counts Seed calls that exhausted their retry
// budget and returned nil (per the prompt: "ONLY THEN return nil so a
// startup race doesn't block the server"). Operators alert on this
// metric because the affected vehicle is now UNPROTECTED — its first
// telemetry samples will hit ErrNoUnitContext in units.ToSI and be
// dropped (Decision 9e in ADR-004). The runbook (Prompt 0090) covers
// alert thresholds.
//
// Fully qualified Prometheus name: tesla_bootstrap_skipped_total
//
// Cardinality note: vehicle_id is an unbounded label across a fleet,
// which is normally a Prometheus anti-pattern. The prompt requires it
// because per-vehicle remediation is the operator's response to a
// non-zero rate — a count without the vehicle_id label would be
// useless. For typical self-hosted installs (1–100 vehicles) the
// cardinality is trivial.
var bootstrapSkippedTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "bootstrap",
	Name:      "skipped_total",
	Help: "Bootstrap Seed calls that exhausted retries and returned nil. " +
		"Affected vehicles will drop telemetry until live Setting*Unit " +
		"signals seed unit_history. Public metric name: " +
		"tesla_bootstrap_skipped_total. Reasons: vehicle_asleep, " +
		"rate_limited, transient, unknown.",
}, []string{"vehicle_id", "reason"})

// resolveUnit maps one gui_settings string to its (Kind, ActiveUnit)
// tuple. Trim + ToLower normalises whitespace and case (Tesla has
// historically returned "F" vs "f" inconsistently across firmware
// revisions). Returns ErrBadGuiSettings on any unrecognised value —
// silently defaulting to one variant would corrupt the wrong cohort
// of vehicles, so we fail loudly and let the operator triage.
func resolveUnit(kind unithistory.Kind, raw string) (units.ActiveUnit, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch kind {
	case unithistory.KindDistance:
		switch v {
		case "mi/hr", "mi", "miles", "mph":
			return units.ActiveUnitMiles, nil
		case "km/hr", "km", "kilometers", "kph", "kmh":
			return units.ActiveUnitKilometers, nil
		}
	case unithistory.KindTemperature:
		switch v {
		case "f", "fahrenheit":
			return units.ActiveUnitFahrenheit, nil
		case "c", "celsius":
			return units.ActiveUnitCelsius, nil
		}
	case unithistory.KindPressure:
		switch v {
		case "psi":
			return units.ActiveUnitPSI, nil
		case "bar":
			return units.ActiveUnitBar, nil
		}
	case unithistory.KindCharge:
		switch v {
		// Tesla emits gui_charge_rate_units as a distance-style unit
		// (mi/hr or km/hr) when the user prefers range display, and
		// "%" when the user prefers percent. Both distance variants
		// resolve to ActiveUnitDistance because the unit_history row
		// records the user's CHOICE (range-vs-percent), not the
		// distance unit (which is already covered by KindDistance).
		case "mi/hr", "km/hr", "mi", "km", "miles", "kilometers", "distance":
			return units.ActiveUnitDistance, nil
		case "%", "percent", "percentage":
			return units.ActiveUnitPercent, nil
		}
	}
	return "", ErrBadGuiSettings
}

// classifyReason converts a Seed-loop terminal error into the metric
// "reason" label. The label values are the documented reason set in
// bootstrapSkippedTotal's Help string; adding a new reason requires
// updating that Help string AND any operator alerting rules.
func classifyReason(err error) string {
	switch {
	case errors.Is(err, ErrTransient):
		return "transient"
	case err != nil && strings.Contains(err.Error(), "asleep"):
		return "vehicle_asleep"
	case err != nil && strings.Contains(err.Error(), "rate"):
		return "rate_limited"
	default:
		return "unknown"
	}
}
