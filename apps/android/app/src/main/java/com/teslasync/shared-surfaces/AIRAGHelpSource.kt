// The single data port the AIRAGHelp shared surface binds to — the native analogue of the two data hooks the
// web component composes (web/src/components/ai/AIRAGHelp.tsx):
//   • the `withAiFeature('rag-help', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/help/query', body: { prompt } })`.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here the way feature sources bind VehiclesStore: the shared
// core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the streaming atoms are the
// out-of-scope P3 component-library bundle), so the production adapter is wired by the host from the shared S8
// AI-mode gate and the SSE client via [aiRagHelpSource]. A test fake stands in for the whole domain. This
// mirrors the sibling AIDigestNarrationSource exactly.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.airaghelp

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIRAGHelpViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake), never
 * on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('rag-help')`); [ask] opens the cold help-query stream (web `useAiStream`). No HTTP touches the
 * view.
 */
interface AIRAGHelpSource {
    /**
     * Stream whether the `rag-help` AI feature is enabled (web `useAiEnabled`). When `false` the surface
     * collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh help-query stream for [prompt] — the native analogue of the web `useAiStream` POST to
     * `/ai/help/query` with `{ prompt }`. The returned cold [Flow] emits one [AiStreamChunk] per parsed SSE
     * frame and completes when the stream closes. A terminal failure may be signalled either as a terminal
     * [AiStreamChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown failure into
     * the same [io.teslasync.android.data.ErrorKind]).
     */
    fun ask(prompt: String): Flow<AiStreamChunk>
}

/**
 * Builds an [AIRAGHelpSource] from the two flows a host wires to the shared layer: [aiEnabled] from the shared
 * S8 AI-mode gate, and [ask] from the AI SSE client. This is the production seam — re-collecting [ask] performs
 * a genuine new query, which backs the surface's ask/retry affordance (the web `stream.start()`). A test fake
 * implements [AIRAGHelpSource] directly instead.
 */
fun aiRagHelpSource(
    aiEnabled: () -> Flow<Boolean>,
    ask: (prompt: String) -> Flow<AiStreamChunk>,
): AIRAGHelpSource =
    object : AIRAGHelpSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun ask(prompt: String): Flow<AiStreamChunk> = ask(prompt)
    }
