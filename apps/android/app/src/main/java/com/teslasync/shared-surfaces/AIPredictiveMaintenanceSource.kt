// The single data port the AIPredictiveMaintenance shared surface binds to — the native analogue of the two
// data hooks the web component composes (web/src/components/ai/AIPredictiveMaintenance.tsx):
//   • the `withAiFeature('predictive-maintenance', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/maintenance/predict', body: { vehicle_id } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here the way other surfaces bind VehiclesStore: the shared
// core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the streaming atoms are the
// out-of-scope P3 component-library bundle), so the production adapter is wired by the host from the shared S8
// AI-mode gate and the SSE client via [aiPredictiveMaintenanceSource]. A test fake stands in for the whole
// domain. The body the web posts (`{ vehicle_id }`) is the host adapter's concern: it threads the in-scope
// [vehicleId] into the request payload, keeping the LLM scope un-widenable exactly as the web body does.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipredictivemaintenance

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIPredictiveMaintenanceViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('predictive-maintenance')`); [predict] opens the cold predict stream (web `useAiStream`). No
 * HTTP touches the view.
 */
interface AIPredictiveMaintenanceSource {
    /**
     * Stream whether the `predictive-maintenance` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh predict stream for [vehicleId] — the native analogue of the web `useAiStream` POST to
     * `/ai/maintenance/predict` with a `{ vehicle_id }` body. The returned cold [Flow] emits one
     * [AiStreamChunk] per parsed SSE frame and completes when the stream closes. A terminal failure may be
     * signalled either as a terminal [AiStreamChunk.Failed] frame or by the flow throwing (the view-model
     * classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun predict(vehicleId: Long): Flow<AiStreamChunk>
}

/**
 * Builds an [AIPredictiveMaintenanceSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [predict] from the AI SSE client. This is the production seam — re-
 * collecting [predict] performs a genuine new generation, which backs the surface's predict/retry affordance
 * (the web `stream.start()`). A test fake implements [AIPredictiveMaintenanceSource] directly instead.
 */
fun aiPredictiveMaintenanceSource(
    aiEnabled: () -> Flow<Boolean>,
    predict: (vehicleId: Long) -> Flow<AiStreamChunk>,
): AIPredictiveMaintenanceSource =
    object : AIPredictiveMaintenanceSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun predict(vehicleId: Long): Flow<AiStreamChunk> = predict(vehicleId)
    }
