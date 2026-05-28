// Package weeklydigest serves GET /api/v1/vehicles/{vehicleID}/weekly-digest
// which returns aggregated stats (drives, distance, energy, cost,
// efficiency) for the current week compared to the previous week.
//
// The current week is anchored at Sunday 00:00 in the local timezone.
// Distances are emitted as km and energy as kWh on the wire (legacy
// frontend contract); the underlying drives table is Phase-42 SI canonical
// (distance_m + energy_used_wh) so the SELECT divides by 1000.
//
// Cost is a static $0.14/kWh multiplier — the per-vehicle electricity
// price configuration is intentionally NOT consulted here so the digest
// page can render on first paint without an extra settings round-trip.
//
// Layer: handler
package weeklydigest
