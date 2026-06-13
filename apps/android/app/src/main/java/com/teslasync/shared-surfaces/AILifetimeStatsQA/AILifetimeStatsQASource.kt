// The single data port the AILifetimeStatsQA shared surface binds to — the native analogue of the two data
// hooks the web component composes (web/src/components/ai/AILifetimeStatsQA.tsx):
//   • the `withAiFeature('lifetime-stats-qa', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/analytics/lifetime/qa', body: { vehicle_id, question } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiLifetimeStatsQASource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailifetimestatsqa

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AILifetimeStatsQAViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('lifetime-stats-qa')`); [ask] opens the cold answer stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AILifetimeStatsQASource {
    /**
     * Stream whether the `lifetime-stats-qa` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh answer stream for [vehicleId] over the user's [question] — the native analogue of the web
     * `useAiStream` POST to `/ai/analytics/lifetime/qa` with `{ vehicle_id, question }`. The returned cold
     * [Flow] emits one [AiQaChunk] per parsed SSE frame and completes when the stream closes. A terminal
     * failure may be signalled either as a terminal [AiQaChunk.Failed] frame or by the flow throwing (the
     * view-model classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun ask(
        vehicleId: Long,
        question: String,
    ): Flow<AiQaChunk>
}

/**
 * Builds an [AILifetimeStatsQASource] from the two flows a host wires to the shared layer: [aiEnabled] from
 * the shared S8 AI-mode gate, and [ask] from the AI SSE client. This is the production seam — re-collecting
 * [ask] performs a genuine new generation, which backs the surface's ask/retry affordance (the web
 * `stream.start()`). A test fake implements [AILifetimeStatsQASource] directly instead.
 */
fun aiLifetimeStatsQASource(
    aiEnabled: () -> Flow<Boolean>,
    ask: (vehicleId: Long, question: String) -> Flow<AiQaChunk>,
): AILifetimeStatsQASource =
    object : AILifetimeStatsQASource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun ask(
            vehicleId: Long,
            question: String,
        ): Flow<AiQaChunk> = ask(vehicleId, question)
    }
