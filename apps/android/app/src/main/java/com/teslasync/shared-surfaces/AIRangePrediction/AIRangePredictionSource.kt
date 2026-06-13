// The single data port the AIRangePrediction shared surface binds to — the native analogue of the two data
// hooks the web component composes (web/src/components/ai/AIRangePrediction.tsx):
//   • the `withAiFeature('range-prediction-model', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/ml/range/train', body: { vehicle_id, days } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiRangePredictionSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.airangeprediction

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIRangePredictionViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('range-prediction-model')`); [train] opens the cold train stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AIRangePredictionSource {
    /**
     * Stream whether the `range-prediction-model` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh train stream for [vehicleId] over the [days] learning window — the native analogue of the
     * web `useAiStream` POST to `/ai/ml/range/train` with `{ vehicle_id, days }`. The web pins `days: 14`; the
     * view-model resolves the window via [normalizeDays] (default [RANGE_MODEL_TRAINING_DAYS], clamped to
     * [RANGE_MODEL_MAX_DAYS]) and always passes a positive value, so this port never receives an absent window.
     * The returned cold [Flow] emits one [RangeModelChunk] per parsed SSE frame and completes when the stream
     * closes. A terminal failure may be signalled either as a terminal [RangeModelChunk.Failed] frame or by the
     * flow throwing (the view-model classifies a thrown failure into the same
     * [io.teslasync.android.data.ErrorKind]).
     */
    fun train(
        vehicleId: Long,
        days: Int,
    ): Flow<RangeModelChunk>
}

/**
 * Builds an [AIRangePredictionSource] from the two flows a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, and [train] from the AI SSE client. This is the production seam — re-collecting
 * [train] performs a genuine new training run, which backs the surface's train/retry affordance (the web
 * `stream.start()`). A test fake implements [AIRangePredictionSource] directly instead.
 */
fun aiRangePredictionSource(
    aiEnabled: () -> Flow<Boolean>,
    train: (vehicleId: Long, days: Int) -> Flow<RangeModelChunk>,
): AIRangePredictionSource =
    object : AIRangePredictionSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun train(
            vehicleId: Long,
            days: Int,
        ): Flow<RangeModelChunk> = train(vehicleId, days)
    }
