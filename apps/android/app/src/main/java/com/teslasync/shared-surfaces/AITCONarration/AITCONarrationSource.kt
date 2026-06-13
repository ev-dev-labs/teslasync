// The single data port the AITCONarration shared surface binds to — the native analogue of the two data hooks
// the web component composes (web/src/components/ai/AITCONarration.tsx):
//   • the `withAiFeature('tco-narration', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/analytics/tco/narrate', body: { vehicle_id } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// Unlike the sibling cost-forecast narrator the TCO narrate request carries only the vehicle (the web InnerSection
// POSTs `{ vehicle_id }` with no `months`), so [narrate] takes only the vehicle id.
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores but no
// AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so the
// production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiTcoNarrationSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for
// the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aitconarration

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AITCONarrationViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('tco-narration')`); [narrate] opens the cold narrate stream (web `useAiStream`). No HTTP touches
 * the view.
 */
interface AITCONarrationSource {
    /**
     * Stream whether the `tco-narration` AI feature is enabled (web `useAiEnabled`). When `false` the surface
     * collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh narrate stream for [vehicleId] — the native analogue of the web `useAiStream` POST to
     * `/ai/analytics/tco/narrate` with `{ vehicle_id }`. The returned cold [Flow] emits one [AiNarrationChunk] per
     * parsed SSE frame and completes when the stream closes. A terminal failure may be signalled either as a
     * terminal [AiNarrationChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown failure
     * into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun narrate(vehicleId: Long): Flow<AiNarrationChunk>
}

/**
 * Builds an [AITCONarrationSource] from the two flows a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, and [narrate] from the AI SSE client. This is the production seam — re-collecting
 * [narrate] performs a genuine new generation, which backs the surface's explain/retry affordance (the web
 * `stream.start()`). A test fake implements [AITCONarrationSource] directly instead.
 */
fun aiTcoNarrationSource(
    aiEnabled: () -> Flow<Boolean>,
    narrate: (vehicleId: Long) -> Flow<AiNarrationChunk>,
): AITCONarrationSource =
    object : AITCONarrationSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun narrate(vehicleId: Long): Flow<AiNarrationChunk> = narrate(vehicleId)
    }
