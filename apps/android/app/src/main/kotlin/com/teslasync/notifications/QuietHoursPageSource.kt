// The data seam the QuietHoursPage binds to for the embedded AI advisor's on-demand draft stream, plus its
// production binding over the shared resilient HTTP client. The page (composable) performs NO HTTP — it only
// collects state from the AIQuietHoursSuggestion view-model, which drives this seam, satisfying the "no direct
// HTTP from the view" contract (ADR-002) while reproducing the web component's `useAiStream` (an on-demand
// POST, NOT a polling feed). The quiet-hours panel half of the page binds through the shared S7
// NotificationsRepository in the host; this file owns only the AI draft seam.
//
// Why a dedicated seam and not a shared P1/S8 store: there is no shared AI-draft store in the KMP core (the
// `useAiStream` SSE primitive is an atomic shared component). The seam over the same shared `ApiHttpClient`
// every repository builds on reproduces the on-demand POST semantics here without inventing core surface area,
// and the embedded view-model is fully tested against a fake implementation of [AiQuietHoursStreamSource].
//
// Streaming note: the shared client reads a complete response body (it has no incremental SSE reader yet), so
// the parsed frames arrive together rather than token-by-token. [splitSseFrames] + the surface's `parseSseFrame`
// already handle the multi-frame delta sequence, so when a shared incremental SSE primitive lands the surface
// upgrades for free with no view change. The final proposal + the terminal done/error semantics are faithful
// today. A transport fault (including the off-mode 404 the gated backend route returns) becomes a terminal
// [AiStreamEvent.StreamError] the embedded view-model classifies, never a thrown exception.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` /
// `filename` are suppressed for the co-located binding extension.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.notifications.quiethours

import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.AiQuietHoursStreamSource
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.AiStreamEvent
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Binds the embedded AIQuietHoursSuggestion surface to the shared resilient [ApiHttpClient] — the same client
 * every S7 repository builds on (auto `/api/v1` prefix, circuit breaker, auth seam, [ApiError] mapping). The
 * host constructs the advisor with `api.asAiQuietHoursStreamSource()`, exactly as the safety-explainer host
 * binds its surface with `api.asAiExplainStreamSource()`. The single POST uses the non-throwing [safeRequest],
 * so a transport fault becomes a terminal [AiStreamEvent.StreamError] the surface classifies (and falls back to
 * its resting invitation), never a crash.
 */
fun ApiHttpClient.asAiQuietHoursStreamSource(): AiQuietHoursStreamSource {
    val api = this
    return AiQuietHoursStreamSource {
        flow {
            val events =
                api
                    .safeRequest<String>(
                        method = HttpMethodKind.POST,
                        path = AI_DRAFT_PATH,
                        body = AI_DRAFT_BODY,
                    ).fold(
                        onSuccess = { body -> splitSseFrames(body) },
                        onFailure = { error -> listOf(transportError(error)) },
                    )
            events.forEach { emit(it) }
        }
    }
}

/**
 * Maps a transport/HTTP failure to a terminal [AiStreamEvent.StreamError] carrying a stable
 * `stream_http_{status}` message for an HTTP failure (web `stream_http_${res.status}`) or the throwable's
 * message otherwise. No structured rate-limit reason is attached (a transport fault is not a cost-cap signal),
 * so the surface renders its generic hard-error retry affordance rather than a limit banner.
 */
internal fun transportError(error: Throwable): AiStreamEvent.StreamError {
    val message =
        when (error) {
            is ApiError.Http -> "stream_http_${error.status}"
            else -> error.message ?: ERROR_UNKNOWN
        }
    return AiStreamEvent.StreamError(
        message = message,
        reason = null,
        retryAfterS = null,
        bannerLevel = null,
        baselineAvailable = false,
    )
}

private const val ERROR_UNKNOWN = "stream_error"
