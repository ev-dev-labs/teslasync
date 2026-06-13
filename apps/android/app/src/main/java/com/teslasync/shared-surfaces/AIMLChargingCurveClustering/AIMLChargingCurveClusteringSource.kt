// The single data port the AIMLChargingCurveClustering shared surface binds to — the native analogue of the
// two data hooks the web component composes (web/src/components/ai/AIMLChargingCurveClustering.tsx):
//   • the `withAiFeature('ml-charging-curve-clustering', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/ml/charging-curves/cluster', body: { vehicle_id, lookback_days } })`, the SSE
//     consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake
// in tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary,
// ADR-002).
//
// There is deliberately no concrete store binding here the way other surfaces bind VehiclesStore /
// AnomaliesStore: the shared core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the
// streaming atoms are the out-of-scope P3 component-library bundle), so the production adapter is wired by
// the host from the shared S8 AI-mode gate and the SSE client via [aiMlChargingCurveClusteringSource]. A
// test fake stands in for the whole domain.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located factory alongside
// the namesake interface; `InvalidPackageDeclaration` because the mandated surface directory
// (com/teslasync/shared-surfaces/AIMLChargingCurveClustering) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimlchargingcurveclustering

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIMLChargingCurveClusteringViewModel] binds to so it depends on an abstraction (real adapter
 * ↔ test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('ml-charging-curve-clustering')`); [cluster] opens the cold train stream (web `useAiStream`).
 * No HTTP touches the view.
 */
interface AIMLChargingCurveClusteringSource {
    /**
     * Stream whether the `ml-charging-curve-clustering` AI feature is enabled (web `useAiEnabled`). When
     * `false` the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh train stream for [vehicleId] over the last [lookbackDays] days — the native analogue of
     * the web `useAiStream` POST to `/ai/ml/charging-curves/cluster` with body
     * `{ vehicle_id: <vehicleId>, lookback_days: <lookbackDays> }`. The returned cold [Flow] emits one
     * [AiStreamChunk] per parsed SSE frame and completes when the stream closes. A terminal failure may be
     * signalled either as a terminal [AiStreamChunk.Failed] frame or by the flow throwing (the view-model
     * classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun cluster(
        vehicleId: Long,
        lookbackDays: Int,
    ): Flow<AiStreamChunk>
}

/**
 * Builds an [AIMLChargingCurveClusteringSource] from the two flows a host wires to the shared layer:
 * [aiEnabled] from the shared S8 AI-mode gate, and [cluster] from the AI SSE client. This is the production
 * seam — re-collecting [cluster] performs a genuine new generation, which backs the surface's train/retry
 * affordance (the web `stream.start()`). A test fake implements [AIMLChargingCurveClusteringSource] directly
 * instead.
 */
fun aiMlChargingCurveClusteringSource(
    aiEnabled: () -> Flow<Boolean>,
    cluster: (vehicleId: Long, lookbackDays: Int) -> Flow<AiStreamChunk>,
): AIMLChargingCurveClusteringSource =
    object : AIMLChargingCurveClusteringSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun cluster(
            vehicleId: Long,
            lookbackDays: Int,
        ): Flow<AiStreamChunk> = cluster(vehicleId, lookbackDays)
    }
