/**
 * Aggregated dashboard metrics for the ForwardAuth-protected shared fleet.
 *
 * GET /api/v1/dashboard/stats emits snake_case JSON. This existing query-facing
 * interface uses the aliases added by the request client's camelCaseKeys().
 * Trips and charging use inclusive started_at bounds from one calendar month
 * before the server's sampled instant through that instant (Go AddDate, not a
 * fixed 30 days). Linked drives have no separate date filter.
 *
 * Units are **SI-canonical** (Phase-48): distance in metres, energy in
 * watt-hours — never miles or kWh. Convert to the user's preferred unit only at
 * the React render boundary via `useUnits()` / `useFormatting()`; never persist
 * or compare display units against these fields.
 */
export interface DashboardStats {
  /** Number of static fleet records, including archived vehicles. */
  totalVehicles: number;
  /** Distance of drives linked to selected trips, in **metres** (SI). */
  totalM: number;
  /** Energy of drives linked to selected trips, in **watt-hours** (SI). */
  totalEnergyWh: number;
  /** Count of charging sessions started in the window. */
  totalChargingSessions: number;
  /** Count of trips started in the window. */
  totalTrips: number;
  /**
   * Fleet energy efficiency over the window, in **watt-hours per metre**
   * (`totalEnergyWh / totalM`). Null when distance is zero: unknown, not zero.
   */
  avgEfficiency: number | null;
  /** Sum of per-session recorded cost in integer **cents**; no currency conversion. */
  totalCostCents: number;
}
