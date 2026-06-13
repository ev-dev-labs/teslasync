// The single data port the AIPiiRedactionSharedExports shared surface binds to — the native analogue of the
// two data hooks the web component composes (web/src/components/ai/AIPiiRedactionSharedExports.tsx):
//   • the `withAiFeature('pii-redaction-shared-exports', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/exports/redaction/draft', body: { export_type } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiPiiRedactionSharedExportsSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipiiredactionsharedexports

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIPiiRedactionSharedExportsViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('pii-redaction-shared-exports')`); [draft] opens the cold plan stream (web `useAiStream`). No
 * HTTP touches the view.
 */
interface AIPiiRedactionSharedExportsSource {
    /**
     * Stream whether the `pii-redaction-shared-exports` AI feature is enabled (web `useAiEnabled`). When `false`
     * the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh plan stream for [exportType] — the native analogue of the web `useAiStream` POST to
     * `/ai/exports/redaction/draft` with `{ export_type }`. The returned cold [Flow] emits one
     * [AiRedactionChunk] per parsed SSE frame and completes when the stream closes. A terminal failure may be
     * signalled either as a terminal [AiRedactionChunk.Failed] frame or by the flow throwing (the view-model
     * classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun draft(exportType: String): Flow<AiRedactionChunk>
}

/**
 * Builds an [AIPiiRedactionSharedExportsSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [draft] from the AI SSE client. This is the production seam —
 * re-collecting [draft] performs a genuine new generation, which backs the surface's plan/retry affordance (the
 * web `stream.start()`). A test fake implements [AIPiiRedactionSharedExportsSource] directly instead.
 */
fun aiPiiRedactionSharedExportsSource(
    aiEnabled: () -> Flow<Boolean>,
    draft: (exportType: String) -> Flow<AiRedactionChunk>,
): AIPiiRedactionSharedExportsSource =
    object : AIPiiRedactionSharedExportsSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun draft(exportType: String): Flow<AiRedactionChunk> = draft(exportType)
    }
