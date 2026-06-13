// The single data port the AIStateMachineDebuggerNarrator shared surface binds to — the native analogue of the
// two data hooks the web component composes (web/src/components/ai/AIStateMachineDebuggerNarrator.tsx):
//   • the `withAiFeature('state-machine-debugger-narrator', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/system/fsm/narrate', body: { vehicle_id, from_unix, to_unix } })`, the SSE
//     consumer that streams a factual narration of the in-window FSM transition trace.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiStateMachineDebuggerNarratorSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aistatemachinedebuggernarrator

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIStateMachineDebuggerNarratorViewModel] binds to so it depends on an abstraction (real
 * adapter ↔ test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature
 * gate (web `useAiEnabled('state-machine-debugger-narrator')`); [narrate] opens the cold narrate stream (web
 * `useAiStream`). No HTTP touches the view.
 */
interface AIStateMachineDebuggerNarratorSource {
    /**
     * Stream whether the `state-machine-debugger-narrator` AI feature is enabled (web `useAiEnabled`). When
     * `false` the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`
     * (ADR-015 §I5).
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh narrate stream for [vehicleId] over the inclusive Unix-second window [fromUnix]..[toUnix] —
     * the native analogue of the web `useAiStream` POST to `/ai/system/fsm/narrate` with
     * `{ vehicle_id, from_unix, to_unix }`. The in-scope tuple is carried in the body so the LLM cannot widen
     * it (ADR-015 §I8 propose-only). The returned cold [Flow] emits one [AiNarrationChunk] per parsed SSE
     * frame and completes when the stream closes. A terminal failure may be signalled either as a terminal
     * [AiNarrationChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown failure into
     * the same [io.teslasync.android.data.ErrorKind]).
     */
    fun narrate(
        vehicleId: Long,
        fromUnix: Long,
        toUnix: Long,
    ): Flow<AiNarrationChunk>
}

/**
 * Builds an [AIStateMachineDebuggerNarratorSource] from the two flows a host wires to the shared layer:
 * [aiEnabled] from the shared S8 AI-mode gate, and [narrate] from the AI SSE client. This is the production
 * seam — re-collecting [narrate] performs a genuine new generation, which backs the surface's narrate/retry
 * affordance (the web `stream.start()`). A test fake implements [AIStateMachineDebuggerNarratorSource]
 * directly instead.
 */
fun aiStateMachineDebuggerNarratorSource(
    aiEnabled: () -> Flow<Boolean>,
    narrate: (vehicleId: Long, fromUnix: Long, toUnix: Long) -> Flow<AiNarrationChunk>,
): AIStateMachineDebuggerNarratorSource =
    object : AIStateMachineDebuggerNarratorSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun narrate(
            vehicleId: Long,
            fromUnix: Long,
            toUnix: Long,
        ): Flow<AiNarrationChunk> = narrate(vehicleId, fromUnix, toUnix)
    }
