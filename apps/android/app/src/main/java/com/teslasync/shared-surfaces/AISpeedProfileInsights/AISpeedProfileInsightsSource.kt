// The single data port the AISpeedProfileInsights shared surface binds to — the native analogue of the two
// data hooks the web component composes (web/src/components/ai/AISpeedProfileInsights.tsx):
//   • the `withAiFeature('speed-profile-insights', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/drives/{driveID}/speed-profile/insights', body: {} })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here the way other surfaces bind VehiclesStore /
// AnomaliesStore: the shared core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the
// streaming atoms are the out-of-scope P3 component-library bundle), so the production adapter is wired by the
// host from the shared S8 AI-mode gate and the SSE client via [aiSpeedProfileInsightsSource]. A test fake
// stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces/AISpeedProfileInsights) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aispeedprofileinsights

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AISpeedProfileInsightsViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('speed-profile-insights')`); [insights] opens the cold insights stream (web `useAiStream`). No
 * HTTP touches the view.
 */
interface AISpeedProfileInsightsSource {
    /**
     * Stream whether the `speed-profile-insights` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh insights stream for [driveId] — the native analogue of the web `useAiStream` POST to
     * `/ai/drives/{driveID}/speed-profile/insights` with an empty body. The returned cold [Flow] emits one
     * [AiStreamChunk] per parsed SSE frame and completes when the stream closes. A terminal failure may be
     * signalled either as a terminal [AiStreamChunk.Failed] frame or by the flow throwing (the view-model
     * classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun insights(driveId: String): Flow<AiStreamChunk>
}

/**
 * Builds an [AISpeedProfileInsightsSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [insights] from the AI SSE client. This is the production seam —
 * re-collecting [insights] performs a genuine new generation, which backs the surface's generate/retry
 * affordance (the web `stream.start()`). A test fake implements [AISpeedProfileInsightsSource] directly
 * instead.
 */
fun aiSpeedProfileInsightsSource(
    aiEnabled: () -> Flow<Boolean>,
    insights: (driveId: String) -> Flow<AiStreamChunk>,
): AISpeedProfileInsightsSource =
    object : AISpeedProfileInsightsSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun insights(driveId: String): Flow<AiStreamChunk> = insights(driveId)
    }
