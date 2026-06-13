// The single data port the AINLSqlPlayground shared surface binds to — the native analogue of the two data hooks
// the web component composes (web/src/components/ai/AINLSqlPlayground.tsx):
//   - the `withAiFeature('nl-sql-playground', ...)` gate, which reads `useAiEnabled(feature)`, and
//   - `useAiStream({ url: '/ai/power/sql/draft', body: { prompt } })`.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here the way feature sources bind VehiclesStore: the shared
// core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the streaming atoms are the
// out-of-scope P3 component-library bundle), so the production adapter is wired by the host from the shared S8
// AI-mode gate and the SSE client via [aiNlSqlPlaygroundSource]. The adapter decodes each SSE frame, lifting a
// `draft_readonly_sql` tool_result into an [AiStreamChunk.DraftCaptured] via [parseReadonlySqlDraft]. A test fake
// stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlsqlplayground

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AINLSqlPlaygroundViewModel] binds to so it depends on an abstraction (real adapter / test fake),
 * never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('nl-sql-playground')`); [draftSql] opens the cold draft stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AINLSqlPlaygroundSource {
    /**
     * Stream whether the `nl-sql-playground` AI feature is enabled (web `useAiEnabled`). When `false` the surface
     * collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh draft stream for the trimmed natural-language [prompt] — the native analogue of the web
     * `useAiStream` POST to `/ai/power/sql/draft` with `{ prompt }`. The returned cold [Flow] emits one
     * [AiStreamChunk] per parsed SSE frame (delta text, a captured `draft_readonly_sql` draft, then done) and
     * completes when the stream closes. A terminal failure may be signalled either as a terminal
     * [AiStreamChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown failure into the
     * same [io.teslasync.android.data.ErrorKind]).
     */
    fun draftSql(prompt: String): Flow<AiStreamChunk>
}

/**
 * Builds an [AINLSqlPlaygroundSource] from the two flows a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, and [draftSql] from the AI SSE client. This is the production seam — re-collecting
 * [draftSql] performs a genuine new generation, which backs the surface's draft/retry affordance (the web
 * `stream.start()`). A test fake implements [AINLSqlPlaygroundSource] directly instead.
 */
fun aiNlSqlPlaygroundSource(
    aiEnabled: () -> Flow<Boolean>,
    draftSql: (prompt: String) -> Flow<AiStreamChunk>,
): AINLSqlPlaygroundSource =
    object : AINLSqlPlaygroundSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun draftSql(prompt: String): Flow<AiStreamChunk> = draftSql(prompt)
    }
