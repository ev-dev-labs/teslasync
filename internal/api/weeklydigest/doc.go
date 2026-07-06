// Package weeklydigest serves GET /api/v1/vehicles/{vehicleID}/weekly-digest
// which returns aggregated stats (drives, distance, energy, cost,
// efficiency) for the current week compared to the previous week.
//
// The current week is anchored at Sunday 00:00 in the local timezone.
// Distances are emitted as km and energy as kWh on the wire (legacy
// frontend contract); the underlying drives table stores canonical SI
// columns (distance_m + energy_used_wh), so the aggregate SELECT returns
// SI sums (metres / watt-hours) and the handler converts to km / kWh at
// the response boundary.
//
// Cost is a static $0.14/kWh multiplier — the per-vehicle electricity
// price configuration is intentionally NOT consulted here so the digest
// page can render on first paint without an extra settings round-trip.
//
// The drive-aggregate read is reached through weeklyRepository (see
// repo.go) so the handler can be exercised without a live database, and
// the week-boundary clock is injectable so the Sunday-anchored window is
// deterministic under test.
//
// Layer: handler
package weeklydigest
