// The single data port the AISignalExplorerNlFilter shared surface binds to — the native analogue of the two data
// hooks the web component composes (web/src/components/ai/AISignalExplorerNlFilter.tsx):
//   - the `withAiFeature('signal-explorer-nl-filter', ...)` gate, which reads `useAiEnabled(feature)`, and
//   - `useAiStream({ url: '/ai/signals/filter/draft', body: { vehicle_id, prompt } })`.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here the way feature sources bind VehiclesStore: the shared
// core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the streaming atoms are the
// out-of-scope P3 component-library bundle), so the production adapter is wired by the host from the shared S8
// AI-mode gate and the SSE client via [aiSignalExplorerNlFilterSource]. The adapter decodes each SSE frame,
// lifting a `draft_signal_filter` tool_result into an [AiStreamChunk.DraftCaptured] via [parseSignalFilterDraft].
// A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisignalexplorernlfilter

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AISignalExplorerNlFilterViewModel] binds to so it depends on an abstraction (real adapter / test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('signal-explorer-nl-filter')`); [draft] opens the cold draft stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AISignalExplorerNlFilterSource {
    /**
     * Stream whether the `signal-explorer-nl-filter` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh draft stream for [vehicleId] over the trimmed natural-language [prompt] — the native analogue
     * of the web `useAiStream` POST to `/ai/signals/filter/draft` with `{ vehicle_id, prompt }`. The returned
     * cold [Flow] emits one [AiStreamChunk] per parsed SSE frame (delta text, a captured `draft_signal_filter`
     * draft, then done) and completes when the stream closes. A terminal failure may be signalled either as a
     * terminal [AiStreamChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown failure
     * into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun draft(
        vehicleId: Long,
        prompt: String,
    ): Flow<AiStreamChunk>
}

/**
 * Builds an [AISignalExplorerNlFilterSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [draft] from the AI SSE client. This is the production seam — re-collecting
 * [draft] performs a genuine new generation, which backs the surface's draft/retry affordance (the web
 * `stream.start()`). A test fake implements [AISignalExplorerNlFilterSource] directly instead.
 */
fun aiSignalExplorerNlFilterSource(
    aiEnabled: () -> Flow<Boolean>,
    draft: (vehicleId: Long, prompt: String) -> Flow<AiStreamChunk>,
): AISignalExplorerNlFilterSource =
    object : AISignalExplorerNlFilterSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun draft(
            vehicleId: Long,
            prompt: String,
        ): Flow<AiStreamChunk> = draft(vehicleId, prompt)
    }
