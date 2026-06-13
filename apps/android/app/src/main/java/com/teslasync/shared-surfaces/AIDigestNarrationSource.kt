// The single data port the AIDigestNarration shared surface binds to — the native analogue of the two data
// hooks the web component composes (web/src/components/ai/AIDigestNarration.tsx):
//   • the `withAiFeature('digest-narration', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/digests/weekly/narrate', body: { vehicle_id, week_offset_weeks: 0 } })`.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here the way feature sources bind VehiclesStore: the shared
// core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the streaming atoms are the out-of-
// scope P3 component-library bundle), so the production adapter is wired by the host from the shared S8 AI-mode
// gate and the SSE client via [aiDigestNarrationSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aidigestnarration

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIDigestNarrationViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('digest-narration')`); [narrate] opens the cold narrate stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AIDigestNarrationSource {
    /**
     * Stream whether the `digest-narration` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh narrate stream for [vehicleId] over the week selected by [weekOffsetWeeks] — the native
     * analogue of the web `useAiStream` POST to `/ai/digests/weekly/narrate` with
     * `{ vehicle_id, week_offset_weeks }`. The returned cold [Flow] emits one [AiStreamChunk] per parsed SSE
     * frame and completes when the stream closes. A terminal failure may be signalled either as a terminal
     * [AiStreamChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown failure into
     * the same [io.teslasync.android.data.ErrorKind]).
     */
    fun narrate(
        vehicleId: Long,
        weekOffsetWeeks: Int,
    ): Flow<AiStreamChunk>
}

/**
 * Builds an [AIDigestNarrationSource] from the two flows a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, and [narrate] from the AI SSE client. This is the production seam — re-collecting
 * [narrate] performs a genuine new generation, which backs the surface's generate/retry affordance (the web
 * `stream.start()`). A test fake implements [AIDigestNarrationSource] directly instead.
 */
fun aiDigestNarrationSource(
    aiEnabled: () -> Flow<Boolean>,
    narrate: (vehicleId: Long, weekOffsetWeeks: Int) -> Flow<AiStreamChunk>,
): AIDigestNarrationSource =
    object : AIDigestNarrationSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun narrate(
            vehicleId: Long,
            weekOffsetWeeks: Int,
        ): Flow<AiStreamChunk> = narrate(vehicleId, weekOffsetWeeks)
    }
