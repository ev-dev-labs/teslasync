// The single data port the AIYearReviewNarration shared surface binds to — the native analogue of the two data
// hooks the web component composes (web/src/components/ai/AIYearReviewNarration.tsx):
//   • the `withAiFeature('yir-narration', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/analytics/year-in-review/narrate', body: { vehicle_id, year } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// The year-in-review narrate request carries the vehicle AND the review year (the web InnerSection POSTs
// `{ vehicle_id, year }` where `year = new Date().getFullYear() - 1`), so [narrate] takes both — the year is a
// derived request input the view-model computes (see [defaultReviewYear]), not host state.
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores but no
// AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so the
// production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiYearReviewNarrationSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for
// the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiyearreviewnarration

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIYearReviewNarrationViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('yir-narration')`); [narrate] opens the cold narrate stream (web `useAiStream`). No HTTP touches
 * the view.
 */
interface AIYearReviewNarrationSource {
    /**
     * Stream whether the `yir-narration` AI feature is enabled (web `useAiEnabled`). When `false` the surface
     * collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh narrate stream for [vehicleId] over the review [year] — the native analogue of the web
     * `useAiStream` POST to `/ai/analytics/year-in-review/narrate` with `{ vehicle_id, year }`. The returned cold
     * [Flow] emits one [AiNarrationChunk] per parsed SSE frame and completes when the stream closes. A terminal
     * failure may be signalled either as a terminal [AiNarrationChunk.Failed] frame or by the flow throwing (the
     * view-model classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun narrate(
        vehicleId: Long,
        year: Int,
    ): Flow<AiNarrationChunk>
}

/**
 * Builds an [AIYearReviewNarrationSource] from the two flows a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, and [narrate] from the AI SSE client. This is the production seam — re-collecting
 * [narrate] performs a genuine new generation, which backs the surface's generate/retry affordance (the web
 * `stream.start()`). A test fake implements [AIYearReviewNarrationSource] directly instead.
 */
fun aiYearReviewNarrationSource(
    aiEnabled: () -> Flow<Boolean>,
    narrate: (vehicleId: Long, year: Int) -> Flow<AiNarrationChunk>,
): AIYearReviewNarrationSource =
    object : AIYearReviewNarrationSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun narrate(
            vehicleId: Long,
            year: Int,
        ): Flow<AiNarrationChunk> = narrate(vehicleId, year)
    }
