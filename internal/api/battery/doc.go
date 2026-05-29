// Package battery serves GET /api/v1/vehicles/{vehicleID}/battery,
// deriving battery health from forward-folded signal state and
// aggregate charging/session data.
//
// Wire-shape stability: the battery report preserves the pre-carve JSON
// envelope consumed by the SPA, including health_score, capacity_wh,
// degradation_pct, avg_cell_temp_c, and monthly_trend fields.
//
// Layer: handler
package battery
