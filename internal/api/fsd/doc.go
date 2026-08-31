// Package fsd serves the FSD Insights analytics endpoint
// (GET /api/v1/analytics/fsd).
//
// # Scope and honesty contract
//
// The only telemetry this package consumes is the pair of resettable
// cumulative distance counters Tesla Fleet Telemetry emits:
//
//	SelfDrivingMilesSinceReset — supervised self-driving distance counter
//	MilesSinceReset            — total observed-driving distance counter
//
// Both are normalized to canonical SI meters by internal/tesla/units before
// internal/tesla/router lands them in signal_log (ADR-004). Despite the proto
// name, nothing in this package reads or emits miles.
//
// What these counters CANNOT support, and what this package therefore never
// claims:
//
//   - interventions or disengagements (never transmitted),
//   - safety performance or autonomy quality (no outcome signal exists),
//   - exact FSD-active route segments (the counters are user-resettable trip
//     meters, not engagement-state events).
//
// They do support reset-safe period totals and interval-based per-drive
// attribution when counter observations are synchronized. Drive results carry
// explicit high, estimated, ambiguous, or unknown confidence, and route
// evidence is always labelled approximate. Per-drive metrics include only
// completed drives fully contained in the requested half-open window; boundary
// drives are excluded rather than mixing partial-period evidence with full-trip
// distance or energy.
//
// # Read semantics
//
// signal_log is primarily a sparse change feed (ADR-002). The Fleet Telemetry
// subscription additionally requests the paired counter through
// include_fields, so new driving observations can carry an unchanged FSD value
// and establish synchronized boundaries. Historical rows may remain sparse.
// This package reads ordered events plus boundary anchors and derives
// reset-safe deltas itself.
//
// # Absence is not zero
//
// The single most dangerous failure mode for this endpoint is reporting 0 m of
// supervised self-driving for a vehicle that simply never emitted the counter.
// Every FSD distance in the response is therefore NULLABLE, and null means
// exactly one thing: "not measured".
//
// A supervised self-driving distance is measured only when
// SelfDrivingMilesSinceReset emitted at least one valid observation INSIDE the
// requested window — a pre-window baseline alone is not enough, because it
// proves the counter existed once, not that it reported during the selected
// period — AND a delta could be derived from it (baseline + one observation,
// or two observations).
//
// Per day, the value is measured only when a trusted
// SelfDrivingMilesSinceReset observation can be differenced against an
// uninterrupted trusted anchor. An invalid or untrusted row breaks that chain.
// This makes a synchronized unchanged value a genuine zero without turning a
// driving-only emission from older subscriptions into zero. A day with no
// derivable FSD counter observation is null.
//
// Quality.FSDReportedInPeriod, Quality.FSDDistanceDerivable and
// Quality.FSDMeasuredDays make that distinction explicit for consumers that
// would rather branch on a flag than on a null.
//
// Layer: handler
package fsd
