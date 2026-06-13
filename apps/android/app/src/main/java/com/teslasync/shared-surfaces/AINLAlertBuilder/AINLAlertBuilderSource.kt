// The single data port the AINLAlertBuilder shared surface binds to — the native analogue of the two data
// hooks the web component composes (web/src/components/ai/AINLAlertBuilder.tsx):
//   • the `withAiFeature('nl-alert-builder', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/alerts/rules/draft', body: { vehicle_id, prompt } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiNLAlertBuilderSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlalertbuilder

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AINLAlertBuilderViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('nl-alert-builder')`); [draft] opens the cold draft stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AINLAlertBuilderSource {
    /**
     * Stream whether the `nl-alert-builder` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh draft stream for [vehicleId] from the free-text [prompt] — the native analogue of the web
     * `useAiStream` POST to `/ai/alerts/rules/draft` with `{ vehicle_id, prompt }`. The returned cold [Flow]
     * emits one [AiDraftChunk] per parsed SSE frame and completes when the stream closes. A terminal failure
     * may be signalled either as a terminal [AiDraftChunk.Failed] frame or by the flow throwing (the
     * view-model classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun draft(
        vehicleId: Long,
        prompt: String,
    ): Flow<AiDraftChunk>
}

/**
 * Builds an [AINLAlertBuilderSource] from the two flows a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, and [draft] from the AI SSE client. This is the production seam — re-collecting
 * [draft] performs a genuine new generation, which backs the surface's draft/retry affordance (the web
 * `stream.start()`). A test fake implements [AINLAlertBuilderSource] directly instead.
 */
fun aiNLAlertBuilderSource(
    aiEnabled: () -> Flow<Boolean>,
    draft: (vehicleId: Long, prompt: String) -> Flow<AiDraftChunk>,
): AINLAlertBuilderSource =
    object : AINLAlertBuilderSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun draft(
            vehicleId: Long,
            prompt: String,
        ): Flow<AiDraftChunk> = draft(vehicleId, prompt)
    }
