package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The fleet-overview summary returned by `GET /api/v1/dashboard/stats` — the cross-platform port
 * of the web `DashboardStats` interface (web/src/types/dashboard.ts), consumed by the web
 * `useDashboardStats` hook (web/src/api/hooks/useDashboard.ts).
 *
 * The wire keys are camelCase verbatim (the Go `dto.DashboardStatsResponse` declares camelCase
 * `json` tags — unusual for this backend, but carried exactly so the contract round-trips), so
 * each field pins its server name with [SerialName] rather than relying on a snake_case default.
 *
 * Values are SI on the wire and stay SI through the cache: [totalM] is whole/fractional **meters**
 * and [totalEnergyWh] is **watt-hours** — never miles or kWh. [totalCostCents] is integer **cents**
 * and [avgEfficiency] is the backend's already-derived ratio. Any locale/imperial rendering is a
 * display-layer concern (S5), never done here. Every field defaults so a payload that omits one
 * (or a future-added key) still decodes to a safe zero rather than failing the whole read.
 *
 * @property totalVehicles number of enrolled vehicles in the fleet.
 * @property totalM lifetime distance driven across the fleet, in meters.
 * @property totalEnergyWh lifetime energy consumed across the fleet, in watt-hours.
 * @property totalChargingSessions lifetime count of charging sessions.
 * @property totalTrips lifetime count of trips/drives.
 * @property avgEfficiency the backend's derived average efficiency ratio (already computed).
 * @property totalCostCents lifetime charging cost, in integer cents.
 */
@Serializable
public data class DashboardStats(
    @SerialName("totalVehicles") public val totalVehicles: Int = 0,
    @SerialName("totalM") public val totalM: Double = 0.0,
    @SerialName("totalEnergyWh") public val totalEnergyWh: Double = 0.0,
    @SerialName("totalChargingSessions") public val totalChargingSessions: Int = 0,
    @SerialName("totalTrips") public val totalTrips: Int = 0,
    @SerialName("avgEfficiency") public val avgEfficiency: Double = 0.0,
    @SerialName("totalCostCents") public val totalCostCents: Int = 0,
)

/**
 * The S7 data port for the dashboard summary — the cross-platform analogue of the web
 * `useDashboard` hook domain (web/src/api/hooks/useDashboard.ts). Every native Dashboard surface
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The domain is a single read — `useDashboard.ts` contains exactly one `useQuery`
 * (`useDashboardStats`) and no mutations — so [stats] streams a cache-then-network [Resource]
 * (ADR-013): the cached value first for an instant cold start, then the refreshed value. The web
 * hook applies no `select`/derivation, so neither does this port. There is nothing to invalidate.
 *
 * The payload ([DashboardStats]) is SI on the wire (meters, watt-hours, integer cents) and stays
 * SI through the cache; display conversion is the render boundary's job (S5), never this layer's.
 */
public interface DashboardRepository {
    /**
     * `GET /dashboard/stats` — the fleet-overview summary. The resilient client adds the `/api/v1`
     * prefix exactly once, matching the web `request('/dashboard/stats')` call verbatim. There are
     * no query params (the web hook passes only `{ signal }`).
     */
    public fun stats(): Flow<Resource<DashboardStats>>
}
