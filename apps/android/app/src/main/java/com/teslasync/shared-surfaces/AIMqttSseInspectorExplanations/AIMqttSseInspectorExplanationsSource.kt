// The single data port the AIMqttSseInspectorExplanations shared surface binds to — the native analogue of the
// two data hooks the web component composes (web/src/components/ai/AIMqttSseInspectorExplanations.tsx):
//   • the `withAiFeature('mqtt-sse-inspector-explanations', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/system/streams/explain', body: { from_unix, to_unix } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores but
// no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so the
// production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiMqttSseInspectorExplanationsSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimqttsseinspectorexplanations

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIMqttSseInspectorExplanationsViewModel] binds to so it depends on an abstraction (real adapter
 * ↔ test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('mqtt-sse-inspector-explanations')`); [explain] opens the cold explain stream (web
 * `useAiStream`). No HTTP touches the view.
 */
interface AIMqttSseInspectorExplanationsSource {
    /**
     * Stream whether the `mqtt-sse-inspector-explanations` AI feature is enabled (web `useAiEnabled`). When
     * `false` the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh explain stream for the inclusive [fromUnix]..[toUnix] window (Unix seconds) — the native
     * analogue of the web `useAiStream` POST to `/ai/system/streams/explain` with `{ from_unix, to_unix }`. The
     * window carries the in-scope tuple so the LLM cannot widen it; the production adapter redacts broker
     * hostnames, ports, SSE client identifiers, and VINs before the message reaches the provider. The returned
     * cold [Flow] emits one [ExplainerChunk] per parsed SSE frame and completes when the stream closes. A
     * terminal failure may be signalled either as a terminal [ExplainerChunk.Failed] frame or by the flow
     * throwing (the view-model classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun explain(
        fromUnix: Long,
        toUnix: Long,
    ): Flow<ExplainerChunk>
}

/**
 * Builds an [AIMqttSseInspectorExplanationsSource] from the two flows a host wires to the shared layer:
 * [aiEnabled] from the shared S8 AI-mode gate, and [explain] from the AI SSE client. This is the production
 * seam — re-collecting [explain] performs a genuine new generation, which backs the surface's explain/retry
 * affordance (the web `stream.start()`). A test fake implements [AIMqttSseInspectorExplanationsSource] directly
 * instead.
 */
fun aiMqttSseInspectorExplanationsSource(
    aiEnabled: () -> Flow<Boolean>,
    explain: (fromUnix: Long, toUnix: Long) -> Flow<ExplainerChunk>,
): AIMqttSseInspectorExplanationsSource =
    object : AIMqttSseInspectorExplanationsSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun explain(
            fromUnix: Long,
            toUnix: Long,
        ): Flow<ExplainerChunk> = explain(fromUnix, toUnix)
    }
