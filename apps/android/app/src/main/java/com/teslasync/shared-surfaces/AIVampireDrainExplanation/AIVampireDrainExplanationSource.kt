// The single data port the AIVampireDrainExplanation shared surface binds to — the native analogue of the two
// data hooks the web component composes (web/src/components/ai/AIVampireDrainExplanation.tsx):
//   • the `withAiFeature('vampire-drain-explanation', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/charging/vampire-drain/explain', body: { vehicle_id, lookback_days } })`, the
//     SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiVampireDrainExplanationSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivampiredrainexplanation

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIVampireDrainExplanationViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('vampire-drain-explanation')`); [explain] opens the cold explain stream (web `useAiStream`). No
 * HTTP touches the view.
 */
interface AIVampireDrainExplanationSource {
    /**
     * Stream whether the `vampire-drain-explanation` AI feature is enabled (web `useAiEnabled`). When `false`
     * the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh explain stream for [vehicleId] over the optional [lookbackDays] horizon — the native
     * analogue of the web `useAiStream` POST to `/ai/charging/vampire-drain/explain` with
     * `{ vehicle_id, lookback_days }`. A `null` [lookbackDays] omits the field so the backend applies its
     * default ([VAMPIRE_DRAIN_DEFAULT_LOOKBACK_DAYS]). The returned cold [Flow] emits one [AiNarrationChunk]
     * per parsed SSE frame and completes when the stream closes. A terminal failure may be signalled either as
     * a terminal [AiNarrationChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown
     * failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun explain(
        vehicleId: Long,
        lookbackDays: Int?,
    ): Flow<AiNarrationChunk>
}

/**
 * Builds an [AIVampireDrainExplanationSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [explain] from the AI SSE client. This is the production seam — re-
 * collecting [explain] performs a genuine new generation, which backs the surface's narrate/retry affordance
 * (the web `stream.start()`). A test fake implements [AIVampireDrainExplanationSource] directly instead.
 */
fun aiVampireDrainExplanationSource(
    aiEnabled: () -> Flow<Boolean>,
    explain: (vehicleId: Long, lookbackDays: Int?) -> Flow<AiNarrationChunk>,
): AIVampireDrainExplanationSource =
    object : AIVampireDrainExplanationSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun explain(
            vehicleId: Long,
            lookbackDays: Int?,
        ): Flow<AiNarrationChunk> = explain(vehicleId, lookbackDays)
    }
