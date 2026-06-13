// The single data port the AIInboxAutoCategorization shared surface binds to — the native analogue of the
// `useAiStream` hook the web component composes (web/src/components/ai/AIInboxAutoCategorization.tsx):
//   • the `withAiFeature('inbox-auto-categorization', …)` gate (wired by the host as a `StateFlow<Boolean>`), and
//   • `useAiStream({ url: '/ai/alerts/inbox/categorize', body: { vehicle_id, window_days, severities, rule_ids } })`,
//     the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI SSE transport in production, a
// fake in tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary,
// ADR-002).
//
// There is deliberately no concrete transport binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so the
// production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiInboxCategorizeSource]; a production adapter decodes each SSE block with [parseSseFrame] and builds the
// request body with [inboxCategorizeRequestBody]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiinboxautocategorization

import kotlinx.coroutines.flow.Flow

/**
 * The streaming seam this surface binds — the native counterpart of the web `useAiStream` hook against
 * POST /ai/alerts/inbox/categorize. A production binding adapts the shared AI SSE transport (decoding frames via
 * [parseSseFrame], building the body via [inboxCategorizeRequestBody]); tests pass a lambda emitting a scripted
 * [AiStreamEvent] sequence. The view-model owns cancellation (on a new suggest, a scope change, or its own
 * clearing), so an implementation only needs to emit events and complete the flow. Re-collecting performs a
 * genuine new generation — backing the surface's suggest / retry affordance (the web `stream.start()`).
 */
fun interface AiInboxCategorizeStreamSource {
    /** Opens one categorize stream for the optional inbox [scope] (web `useAiStream` over the memoised body). */
    fun categorize(scope: InboxScope): Flow<AiStreamEvent>
}

/**
 * Builds an [AiInboxCategorizeStreamSource] from the [categorize] flow a host wires to the shared AI SSE client.
 * This is the production seam — a thin adapter so the host owns transport wiring while the view-model stays
 * bound to the abstraction. A test fake implements [AiInboxCategorizeStreamSource] directly instead.
 */
fun aiInboxCategorizeSource(categorize: (scope: InboxScope) -> Flow<AiStreamEvent>): AiInboxCategorizeStreamSource =
    AiInboxCategorizeStreamSource { scope -> categorize(scope) }
