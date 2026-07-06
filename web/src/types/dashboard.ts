/**
 * Aggregated rolling 30-day dashboard metrics for the signed-in user's fleet.
 *
 * Wire contract — mirrors the Go DTO `DashboardStatsResponse`
 * (`internal/handler/dto/dashboard.go`) returned from
 * `GET /api/v1/dashboard/stats` and surfaced by the `useDashboardStats` query
 * hook. The backend already emits camelCase JSON tags, so `camelCaseKeys()` is a
 * no-op for this payload and the field names below are the raw wire keys.
 *
 * Units are **SI-canonical** (Phase-48): distance in metres, energy in
 * watt-hours — never miles or kWh. Convert to the user's preferred unit only at
 * the React render boundary via `useUnits()` / `useFormatting()`; never persist
 * or compare display units against these fields.
 */
export interface DashboardStats {
  /** Number of vehicles owned by the user. */
  totalVehicles: number;
  /** Total distance driven in the window, in **metres** (SI). */
  totalM: number;
  /** Total energy consumed in the window, in **watt-hours** (SI). */
  totalEnergyWh: number;
  /** Count of charging sessions started in the window. */
  totalChargingSessions: number;
  /** Count of trips taken in the window. */
  totalTrips: number;
  /**
   * Fleet energy efficiency over the window, in **watt-hours per metre**
   * (`totalEnergyWh / totalM`). `0` when no distance was driven — the backend
   * guards the divide-by-zero so this is never `NaN`.
   */
  avgEfficiency: number;
  /** Total charging cost in the window, in integer **cents** of the account currency. */
  totalCostCents: number;
}
