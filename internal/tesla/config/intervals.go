// Package config builds the Tesla Fleet Telemetry subscription JSON body
// from protomodel.Signals. The body tells Tesla which Field values to
// stream over MQTT and at what cadence.
//
// This file owns the cadence policy: a small per-Category default table
// plus an explicit per-Field override map. The split keeps the policy
// auditable (one place to look up "why is field X subscribed at N
// seconds?") and the test surface trivially exhaustive (the coverage
// test enumerates protomodel.Signals reflectively, so any new Field that
// the codegen adds will fail loudly until intervals.go covers it).
//
// ADR-004 #4: the four Setting*Unit fields MUST always be at
// interval_seconds=1. Losing a single Setting*Unit transition corrupts
// every downstream unit-bearing measurement until the next sample, so
// they get their own pinned cadence rather than relying on the
// "setting_unit" category default and the test enforces the contract
// independently of the table.
package config

import (
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// categoryDefaults maps SignalMeta.Category to the default subscription
// cadence in seconds. Every Category emitted by the codegen MUST appear
// here; the IntervalFor lookup falls back to a conservative 60s rather
// than zero so a future Tesla schema bump can't silently turn a field
// off because the table forgot to mention its Category.
var categoryDefaults = map[string]int{
	// Setting*Unit transitions feed the unit-history layer; they MUST
	// be at 1s per ADR-004 #4. The category default matches the
	// per-field invariant so a new Setting*Unit Field added by Tesla
	// gets the right cadence without an override entry.
	"setting_unit": 1,

	// Hot live-state buckets: drive segmenter, live map dot, motor
	// telemetry. 5s is the slowest cadence at which we can still draw
	// a faithful trip line and detect short stops without aliasing.
	"driving":    5,
	"location":   5,
	"powertrain": 5,

	// Charging session bookkeeping: SoC, kW, current. 10s is fine for
	// session-level analytics; charge curves are smooth enough that
	// finer sampling adds noise without insight.
	"charging": 10,

	// Slowly-changing user-visible state. Climate setpoints, TPMS,
	// sentry/door state, odometer/range. 30s keeps the dashboard
	// responsive without flooding signal_log with no-op rows.
	"climate":         30,
	"safety_security": 30,
	"vehicle_state":   30,

	// Effectively-static or low-value-density signals. Media metadata,
	// vehicle config (model/version), user prefs. 60s is enough; these
	// almost never change between samples.
	"media":  60,
	"config": 60,
	"prefs":  60,

	// Sentinel buckets that BuildSubscription explicitly skips
	// (Unknown, Deprecated_*, Experimental_*). The default exists only
	// so a misclassification never resolves to zero, but no production
	// subscription should ever request a metadata-category Field.
	"metadata": 60,
}

// fieldOverrides maps SignalMeta.Field to a per-field cadence override.
// Each entry MUST cite why the category default is wrong for this Field;
// drive-by tweaks are not allowed because the override table is the
// single point of "why does my field stream at this rate?" debugging.
var fieldOverrides = map[string]int{
	// VehicleSpeed at the driving-category default of 5s loses sub-5s
	// braking and acceleration transitions that the live UI needle and
	// the drive segmenter both rely on for stop/start detection. 1s is
	// the rate Tesla's own UI samples at.
	"VehicleSpeed": 1,

	// Gear at 5s misses transient R->N->D shifts during parking
	// maneuvers; the drive FSM watches Gear edges to open and close
	// drive segments and a missed N transition breaks segmentation.
	"Gear": 1,

	// BatteryLevel is the user-facing SoC percent. The charging-category
	// default of 10s is wasteful: percent values change at most once a
	// minute under normal driving and once every ~30s under DC fast
	// charging. 30s halves signal_log row count for the most-written
	// charging field with no perceptible UI lag.
	"BatteryLevel": 30,

	// These two resettable counters are the only authoritative source for
	// supervised-driving distance. MilesSinceReset is the synchronization
	// clock: at Tesla's 10-second minimum cadence and smallest supported
	// delta, its include_fields payload carries the current FSD counter often
	// enough to bound per-drive attribution instead of waiting for the FSD
	// counter's own one-mile trigger.
	"MilesSinceReset":            10,
	"SelfDrivingMilesSinceReset": 1,
}

// minimumDeltaOverrides records Tesla-enforced or analytically significant
// minimum deltas in each field's fixed wire unit. The FSD field cannot be
// configured below one mile. MilesSinceReset uses Tesla's smallest supported
// delta so its paired include_fields sample provides useful drive boundaries.
var minimumDeltaOverrides = map[string]float64{
	"MilesSinceReset":            0.01,
	"SelfDrivingMilesSinceReset": 1,
}

// includeFieldOverrides keeps the resettable distance counters synchronized
// on Fleet Telemetry clients that support include_fields. Tesla permits these
// two fields to include each other, but does not permit unrelated fields to
// include either counter.
var includeFieldOverrides = map[string][]string{
	"MilesSinceReset":            {"SelfDrivingMilesSinceReset"},
	"SelfDrivingMilesSinceReset": {"MilesSinceReset"},
}

// FieldPolicy is the complete per-field Fleet Telemetry subscription policy.
// Distances remain in Tesla's fixed wire unit here; normalization to SI occurs
// only after telemetry is received.
type FieldPolicy struct {
	IntervalSeconds int
	MinimumDelta    *float64
	IncludeFields   []string
}

// PolicyFor returns a defensive copy of the complete policy for field.
func PolicyFor(field string) (FieldPolicy, bool) {
	interval, ok := IntervalFor(field)
	if !ok {
		return FieldPolicy{}, false
	}
	policy := FieldPolicy{IntervalSeconds: interval}
	if delta, exists := minimumDeltaOverrides[field]; exists {
		value := delta
		policy.MinimumDelta = &value
	}
	if included := includeFieldOverrides[field]; len(included) > 0 {
		policy.IncludeFields = append([]string(nil), included...)
	}
	return policy, true
}

// IntervalFor returns the subscription interval (seconds) for the
// named protomodel Field. The bool result is false when the Field name
// is not in protomodel.SignalsByName, which lets callers distinguish
// "unknown field" from "subscribed at zero seconds" (the latter is
// never legal — a zero would tell Tesla to send the field as fast as
// possible, which is not what the cadence policy expresses).
func IntervalFor(field string) (int, bool) {
	s, ok := protomodel.SignalsByName[field]
	if !ok {
		return 0, false
	}
	if iv, ok := fieldOverrides[field]; ok {
		return iv, true
	}
	if iv, ok := categoryDefaults[s.Category]; ok {
		return iv, true
	}
	// Defensive fallback: codegen emitted a Category we have no policy
	// for. Return a conservative 60s rather than zero so the field is
	// still subscribed and the operator has a chance to notice the
	// drift via signal_log activity instead of via a silent gap.
	return 60, true
}
