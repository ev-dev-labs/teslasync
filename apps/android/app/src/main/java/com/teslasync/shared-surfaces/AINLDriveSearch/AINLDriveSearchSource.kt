// The single data port the AINLDriveSearch shared surface binds to — the native analogue of the two data hooks
// the web component composes (web/src/components/ai/AINLDriveSearch.tsx):
//   • the `withAiFeature('nl-drive-search-replay', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/drives/search', body: { prompt } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores but
// no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so the
// production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiNlDriveSearchSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainldrivesearch

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AINLDriveSearchViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('nl-drive-search-replay')`); [search] opens the cold search stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AINLDriveSearchSource {
    /**
     * Stream whether the `nl-drive-search-replay` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh search stream for the free-text [prompt] — the native analogue of the web `useAiStream` POST
     * to `/ai/drives/search` with `{ prompt }`. The returned cold [Flow] emits one [AiSearchChunk] per parsed
     * SSE frame (typically [AiSearchChunk.Delta] narration followed by [AiSearchChunk.Done]) and completes when
     * the stream closes. A terminal failure may be signalled either as a terminal [AiSearchChunk.Failed] frame
     * or by the flow throwing (the view-model classifies a thrown failure into the same
     * [io.teslasync.android.data.ErrorKind]).
     */
    fun search(prompt: String): Flow<AiSearchChunk>
}

/**
 * Builds an [AINLDriveSearchSource] from the two flows a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, and [search] from the AI SSE client (which POSTs `{ prompt }` to
 * [AI_NL_DRIVE_SEARCH_URL] and decodes each frame via [parseAiSearchFrame]). This is the production seam —
 * re-collecting [search] performs a genuine new search, which backs the surface's search/retry affordance (the
 * web `stream.start()`). A test fake implements [AINLDriveSearchSource] directly instead.
 */
fun aiNlDriveSearchSource(
    aiEnabled: () -> Flow<Boolean>,
    search: (prompt: String) -> Flow<AiSearchChunk>,
): AINLDriveSearchSource =
    object : AINLDriveSearchSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun search(prompt: String): Flow<AiSearchChunk> = search(prompt)
    }
