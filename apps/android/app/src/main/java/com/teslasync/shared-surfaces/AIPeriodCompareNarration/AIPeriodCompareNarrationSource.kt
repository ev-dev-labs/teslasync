// The single data port the AIPeriodCompareNarration shared surface binds to — the native analogue of the two
// data hooks the web component composes (web/src/components/ai/AIPeriodCompareNarration.tsx):
//   • the `withAiFeature('period-compare-narration', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/analytics/period-compare/narrate', body: { vehicle_id, days_a, days_b } })`, the
//     SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiPeriodCompareNarrationSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiperiodcomparenarration

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIPeriodCompareNarrationViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('period-compare-narration')`); [narrate] opens the cold narrate stream (web `useAiStream`). No
 * HTTP touches the view.
 */
interface AIPeriodCompareNarrationSource {
    /**
     * Stream whether the `period-compare-narration` AI feature is enabled (web `useAiEnabled`). When `false`
     * the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh narrate stream for [vehicleId] over the two optional trailing-day windows [daysA] / [daysB]
     * — the native analogue of the web `useAiStream` POST to `/ai/analytics/period-compare/narrate` with
     * `{ vehicle_id, days_a, days_b }`. Each `null` window omits its field so the backend applies its default;
     * a window of `0` ("all time") is a real value the caller passes through (see [normalizeDays]). The
     * returned cold [Flow] emits one [AiNarrationChunk] per parsed SSE frame and completes when the stream
     * closes. A terminal failure may be signalled either as a terminal [AiNarrationChunk.Failed] frame or by
     * the flow throwing (the view-model classifies a thrown failure into the same
     * [io.teslasync.android.data.ErrorKind]).
     */
    fun narrate(
        vehicleId: Long,
        daysA: Int?,
        daysB: Int?,
    ): Flow<AiNarrationChunk>
}

/**
 * Builds an [AIPeriodCompareNarrationSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [narrate] from the AI SSE client. This is the production seam — re-
 * collecting [narrate] performs a genuine new generation, which backs the surface's narrate/retry affordance
 * (the web `stream.start()`). A test fake implements [AIPeriodCompareNarrationSource] directly instead.
 */
fun aiPeriodCompareNarrationSource(
    aiEnabled: () -> Flow<Boolean>,
    narrate: (vehicleId: Long, daysA: Int?, daysB: Int?) -> Flow<AiNarrationChunk>,
): AIPeriodCompareNarrationSource =
    object : AIPeriodCompareNarrationSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun narrate(
            vehicleId: Long,
            daysA: Int?,
            daysB: Int?,
        ): Flow<AiNarrationChunk> = narrate(vehicleId, daysA, daysB)
    }
