// The data seam the AISafetySettingExplainer surface binds to for its on-demand narration stream, plus
// its production binding over the shared resilient HTTP client. The view (composable) performs NO HTTP —
// it only collects state from the ViewModel, which drives this seam, satisfying the "no direct HTTP from
// the view" contract (ADR-002) while reproducing the web component's `useAiStream` (an on-demand POST,
// NOT a polling feed).
//
// Why a dedicated seam and not a shared P1/S8 store: there is no shared AI-narration store in the KMP
// core (the `useAiStream` SSE primitive is an atomic shared component, explicitly out of scope for this
// per-surface prompt). The seam over the same shared `ApiHttpClient` every repository builds on
// reproduces the on-demand POST semantics here without inventing core surface area, and the ViewModel is
// fully tested against a fake implementation of it.
//
// Request shape: the web body is the empty object (`useMemo(() => ({}), [])`) because the backend reads
// the user's identity from the ForwardAuth subject and applies a deterministic default question. The
// native binder posts the same empty JSON object — there is no vehicle id.
//
// Streaming note: the shared client reads a complete response body (it has no incremental SSE reader
// yet), so the parsed frames arrive together rather than token-by-token. The parser
// ([AISafetySettingExplainerProjection.parseExplainStream]) already handles the multi-frame delta
// sequence, so when a shared incremental SSE primitive lands the surface upgrades for free with no view
// change. The final narration text + the terminal done/error semantics are faithful today.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AISafetySettingExplainer) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisafetysettingexplainer

import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonObject

/**
 * The single seam the [AISafetySettingExplainerViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete client — the Android counterpart of the web `useAiStream`
 * hook (P1/S8 state-holder boundary). [explain] opens ONE narration run and emits the parsed lifecycle
 * events in arrival order; transport faults surface as a terminal [AiExplainEvent.Error] (mirroring the
 * web hook's `state='error'`), never as a thrown exception. No HTTP touches the view.
 */
fun interface AiExplainStreamSource {
    /** Streams the parsed narration events (web `stream.start()` against the explain URL). */
    fun explain(): Flow<AiExplainEvent>
}

/**
 * Binds the surface to the shared resilient [ApiHttpClient] — the same client every S7 repository builds
 * on (auto `/api/v1` prefix, circuit breaker, auth seam, [ApiError] mapping). A host constructs the
 * surface with `api.asAiExplainStreamSource()`, exactly as the dev-tools host binds a surface with
 * `api.asInfrastructureSectionSource()`. The single POST uses the non-throwing [safeRequest], so a
 * transport fault (including the off-mode 404 the gated backend route returns) becomes a terminal error
 * event the projection classifies — and the surface falls back to the deterministic safety list below
 * (ADR-015).
 */
fun ApiHttpClient.asAiExplainStreamSource(): AiExplainStreamSource {
    val api = this
    return AiExplainStreamSource {
        flow {
            val events =
                api
                    .safeRequest<String>(
                        method = HttpMethodKind.POST,
                        path = AISafetySettingExplainerRegistration.EXPLAIN_PATH,
                        body = EXPLAIN_BODY,
                    ).fold(
                        onSuccess = { body -> AISafetySettingExplainerProjection.parseExplainStream(body) },
                        onFailure = { error -> listOf(transportError(error)) },
                    )
            events.forEach { emit(it) }
        }
    }
}

// The explain request body — verbatim the web `useAiStream({ body: {} })`. The backend reads identity
// from the ForwardAuth subject, so no fields are sent.
private val EXPLAIN_BODY: JsonObject = JsonObject(emptyMap())

/**
 * Maps a transport/HTTP failure to a terminal [AiExplainEvent.Error] carrying the classified
 * [io.teslasync.android.data.ErrorKind] + HTTP status (so the surface picks the right recovery copy) and
 * a stable `stream_http_{status}` message for an HTTP failure (web `stream_http_${res.status}`).
 */
internal fun transportError(error: Throwable): AiExplainEvent.Error {
    val kind = errorKindOf(error)
    val status = httpStatusOf(error)
    val message =
        when (error) {
            is ApiError.Http -> "stream_http_${error.status}"
            else -> error.message ?: kind.name
        }
    return AiExplainEvent.Error(message = message, kind = kind, httpStatus = status)
}
