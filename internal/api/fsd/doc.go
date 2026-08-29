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
//   - exact per-drive attribution (the counters are user-resettable trip
//     meters, not per-drive odometers).
//
// What they DO support is the descriptive question "how much supervised
// self-driving distance accumulated on each local calendar day, and what
// share of observed driving distance was that?" — which is exactly the
// contract implemented here.
//
// # Read semantics
//
// signal_log is a sparse change feed (ADR-002): a row exists only where a
// value CHANGED. This package therefore performs a CHANGE-FEED read (raw
// ordered events plus one pre-window baseline per counter) and derives
// reset-safe deltas itself. It deliberately does NOT use signal.StateReader,
// whose forward-fold semantics answer "value at time T" rather than "how much
// did the counter advance inside this window".
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
// Per day, the value is measured only from the first derivable delta onward
// and only on days at least one relevant distance counter reported. That
// second condition is what makes a genuine zero expressible: Tesla transmits a
// field only when it CHANGES, so the driving counter moving while
// SelfDrivingMilesSinceReset does not is a measured zero. A day with no
// relevant counter observation is null.
//
// Quality.FSDReportedInPeriod, Quality.FSDDistanceDerivable and
// Quality.FSDMeasuredDays make that distinction explicit for consumers that
// would rather branch on a flag than on a null.
//
// Layer: handler
package fsd
