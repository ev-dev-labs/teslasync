// Pure, framework-free model + projection + diagnostics for the QueryError shared surface — the native
// analogue of web/src/components/feedback/QueryError.tsx (built on _ErrorState.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :app:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): an inline error
// banner for a failed API query that branches on the failure so the user gets actionable recovery copy per
// failure mode instead of a generic "something went wrong". It derives the branch in this precedence:
//   • transient waiting (rate-limited / upstream breaker open) — a calm "Waiting for upstream" notice,
//     no CTA (the global rate-limit banner owns the countdown + retry);
//   • 404                — "{thing} not found", with an optional Back-to-list CTA;
//   • 401 / 403          — "Sign in required", with a Sign-in CTA;
//   • 5xx                — "Server error", with a Retry CTA;
//   • network online     — "Can't reach server", with a Retry CTA;
//   • network offline /
//     status 0           — "You're offline", with a DISABLED "Retry when online" CTA; when the failure
//                          carries no HTTP status the web also auto-invokes onRetry once the connection
//                          returns, so the user does not have to tap.
// When there is no error the web component renders nothing (`if (!error) return null`); that is the only
// non-rendered state and it is faithfully a no-error, not a hidden error surface.
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002): the surface's ONE live data
// source is connectivity (web `useOnlineStatus`), bound through [QueryErrorSource]; the failure being
// rendered is the input (the parent's failed query). The branch is resolved by the shared
// [io.teslasync.android.components.feedback.classifyQueryError] (reused for DRY — the same classifier the
// atomic feedback `QueryError` uses), then folded here into the framework-free [QueryErrorRender] the
// composable paints. i18n, navigation, and icon/colour resolution all happen at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/QueryError — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.queryerror

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the QueryError surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`QueryError`).
 */
object QueryErrorRegistration {
    /** Stable surface id (also the `viewModel` key prefix the host binds the surface with). */
    const val ID: String = "query-error"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "QueryError"
}

/**
 * The classified shape of the failed query the surface renders — the native input analogue of the web
 * `error` prop. It carries only the two signals the web component branches on (plus connectivity, which is
 * the live [QueryErrorSource] data): the HTTP [httpStatus] of an [io.teslasync.shared.core.net.ApiError.Http]
 * failure (or `null` for a network / decode / unknown failure with no status — the web `status === undefined`),
 * and whether the failure is a [transientWaiting] back-pressure (rate-limited / upstream breaker open, the
 * web `isTransientWaiting`). It carries no message, no stack, and no PII.
 *
 * @property httpStatus the HTTP status of the failure, or `null` when the failure has none (web
 *   `isApiError(error) ? error.status : undefined`). The web treats `0` as the explicit offline status.
 * @property transientWaiting whether the failure is a recoverable wait the global banner already narrates
 *   (web `isTransientWaiting(error)`); takes precedence over every status branch.
 */
data class QueryErrorFailure(
    val httpStatus: Int?,
    val transientWaiting: Boolean = false,
) {
    companion object {
        /** The explicit offline status the resilient client throws when connectivity is down (web `status === 0`). */
        const val OFFLINE_STATUS: Int = 0

        /** HTTP 429 — the rate-limit status the web `isTransientWaiting` folds into the calm waiting branch. */
        private const val TOO_MANY_REQUESTS: Int = 429

        /**
         * Builds a [QueryErrorFailure] from the shared [UiState] a host page already exposes for a failed feed
         * (ADR-013) — so a host that binds a real query can hand the surface its failure without re-deriving
         * the taxonomy. [UiState.httpStatus] carries the HTTP status; a circuit-open or rate-limited failure
         * is the native [transientWaiting] (the web rate-limit / upstream-breaker classification).
         */
        fun fromUiState(state: UiState<*>): QueryErrorFailure =
            QueryErrorFailure(
                httpStatus = state.httpStatus,
                transientWaiting = isTransientWaiting(state.errorKind, state.httpStatus),
            )

        /**
         * Whether an [ErrorKind] + [status] pair is a transient back-pressure wait (web `isTransientWaiting`:
         * rate-limited or upstream-unavailable / breaker open). A circuit-open failure is the breaker, and a
         * 429 is the rate limit; everything else is a hard failure the surface branches on by status.
         */
        fun isTransientWaiting(
            errorKind: ErrorKind?,
            status: Int?,
        ): Boolean = errorKind == ErrorKind.CircuitOpen || status == TOO_MANY_REQUESTS
    }
}

/**
 * The fully-resolved, framework-free render state the composable paints — the native mirror of everything the
 * web `QueryError` decides between its `error` prop and the rendered `_ErrorState` card. Pure so the
 * composable only resolves strings, icons, and a CTA callback from it.
 *
 * @property branch the recovery bucket the failure maps onto (drives icon + copy + which CTA), resolved by
 *   the shared [classifyQueryError] (web branch precedence).
 * @property retryEnabled whether the retry affordance is tappable — `false` only on the offline branch, where
 *   the web disables Retry until the connection returns (web `disabled={isOffline}`).
 * @property polite whether the surface announces politely as a non-blocking status (web `role="status"` /
 *   `aria-live="polite"` — the waiting and offline branches) rather than assertively as an alert.
 */
data class QueryErrorRender(
    val branch: QueryErrorKind,
    val retryEnabled: Boolean,
    val polite: Boolean,
)

/**
 * Pure projection of a [failure] + live connectivity [online] into the render state — the native mirror of
 * every branch the web `QueryError` derives. Returns `null` for a `null` failure (web `if (!error) return
 * null`: the no-error case, the surface's only non-rendered state). Framework-free so the whole branch set is
 * covered by the JVM unit gate without a Compose host.
 */
fun projectQueryError(
    failure: QueryErrorFailure?,
    online: Boolean,
): QueryErrorRender? {
    if (failure == null) return null
    val branch = classifyQueryError(failure.httpStatus, online, failure.transientWaiting)
    return QueryErrorRender(
        branch = branch,
        retryEnabled = branch != QueryErrorKind.Offline,
        polite = branch == QueryErrorKind.Waiting || branch == QueryErrorKind.Offline,
    )
}

/**
 * Whether [failure] should auto-invoke retry once connectivity returns — the native mirror of the web
 * offline-only auto-retry effect, which arms ONLY when the failure carries no HTTP status (web `status ===
 * undefined`) and is not a transient wait. A 4xx/5xx (or the explicit offline `status 0`) never recovers from
 * a mere `online` event, so it never auto-retries; the [QueryErrorViewModel] additionally gates this on a
 * genuine offline→online transition so a retry only fires after a real disconnect.
 */
fun armsAutoRetryOnReconnect(failure: QueryErrorFailure?): Boolean =
    failure != null && failure.httpStatus == null && !failure.transientWaiting

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [QueryErrorRegistration.SLUG]
 * (P1/S11) — never an error status, message, or connectivity payload, so a diagnostics line can never leak
 * which query failed or why. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * ViewModel calls it once per surface open.
 */
fun recordQueryErrorOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to QueryErrorRegistration.SLUG))
}
