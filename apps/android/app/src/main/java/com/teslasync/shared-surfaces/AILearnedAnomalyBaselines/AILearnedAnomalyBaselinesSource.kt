// The single data port the AILearnedAnomalyBaselines shared surface binds to — the native analogue of the two
// data hooks the web component composes (web/src/components/ai/AILearnedAnomalyBaselines.tsx):
//   • the `withAiFeature('learned-per-vehicle-anomaly-baselines', …)` gate, which reads `useAiEnabled(feature)`,
//   • `useAiStream({ url: '/ai/ml/anomaly-baselines/train', body: { vehicle_id, days } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiLearnedAnomalyBaselinesSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailearnedanomalybaselines

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AILearnedAnomalyBaselinesViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('learned-per-vehicle-anomaly-baselines')`); [train] opens the cold train stream (web
 * `useAiStream`). No HTTP touches the view.
 */
interface AILearnedAnomalyBaselinesSource {
    /**
     * Stream whether the `learned-per-vehicle-anomaly-baselines` AI feature is enabled (web `useAiEnabled`).
     * When `false` the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh train stream for [vehicleId] over the [days] learning window — the native analogue of the
     * web `useAiStream` POST to `/ai/ml/anomaly-baselines/train` with `{ vehicle_id, days }`. Unlike the
     * sibling cost-forecast surface, [days] is always sent (the web hardcodes the 14-day window). The returned
     * cold [Flow] emits one [AiBaselineChunk] per parsed SSE frame and completes when the stream closes. A
     * terminal failure may be signalled either as a terminal [AiBaselineChunk.Failed] frame or by the flow
     * throwing (the view-model classifies a thrown failure into the same
     * [io.teslasync.android.data.ErrorKind]).
     */
    fun train(
        vehicleId: Long,
        days: Int,
    ): Flow<AiBaselineChunk>
}

/**
 * Builds an [AILearnedAnomalyBaselinesSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [train] from the AI SSE client. This is the production seam — re-
 * collecting [train] performs a genuine new training pass, which backs the surface's train/retry affordance
 * (the web `stream.start()`). A test fake implements [AILearnedAnomalyBaselinesSource] directly instead.
 */
fun aiLearnedAnomalyBaselinesSource(
    aiEnabled: () -> Flow<Boolean>,
    train: (vehicleId: Long, days: Int) -> Flow<AiBaselineChunk>,
): AILearnedAnomalyBaselinesSource =
    object : AILearnedAnomalyBaselinesSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun train(
            vehicleId: Long,
            days: Int,
        ): Flow<AiBaselineChunk> = train(vehicleId, days)
    }
