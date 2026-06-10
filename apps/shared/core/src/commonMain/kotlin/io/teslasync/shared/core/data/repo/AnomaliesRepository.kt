package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the signal-anomaly read-model — the cross-platform analogue of the web
 * `useAnomalies` hook domain (web/src/api/hooks/useAnomalies.ts). Every native Anomalies surface
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The domain is a single read — `useAnomalies.ts` contains exactly one `useQuery` and no
 * mutations — so [anomalies] streams a cache-then-network [Resource] (ADR-013): the cached value
 * first for an instant cold start, then the refreshed value. There is nothing to invalidate here.
 *
 * The payload (the `{anomalies, health_summary, signals_monitored, anomalies_last_7d,
 * anomalies_last_24h}` envelope, each anomaly carrying a raw signal `value`, `baseline`, and
 * `z_score`) is carried as raw [JsonElement] (the same verbatim-SI strategy as
 * [AnalyticsRepository]): the values are SI on the wire and stay SI through the cache; display
 * conversion is the render-boundary's job (S5), never this layer's. The web hook applies no
 * `select`/derivation, so neither does this port.
 *
 * The web hook gates the query with `enabled: vehicleId !== null`. That gate is a presentation
 * concern and lives in the S8 [AnomaliesStore]; this port takes a non-null [vehicleId] and is
 * only ever called once a vehicle is selected.
 */
public interface AnomaliesRepository {
    /**
     * `GET /analytics/anomalies?vehicle_id={vehicleId}&days={days}` — the rolling-window anomaly
     * report for one vehicle (web `useAnomalies`, default 7 days). Params are snake_case, matching
     * the web template literal exactly.
     */
    public fun anomalies(
        vehicleId: String,
        days: Int = 7,
    ): Flow<Resource<JsonElement>>
}
