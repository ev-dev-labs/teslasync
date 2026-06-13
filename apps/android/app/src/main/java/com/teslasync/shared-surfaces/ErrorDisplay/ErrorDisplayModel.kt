// Pure, framework-free model + projection + diagnostics for the ErrorDisplay shared surface — the native
// analogue of web/src/components/feedback/ErrorDisplay.tsx (and its internal `_ErrorState` chrome). No
// Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a status-aware
// error banner that branches on `ApiError.status` exactly as the web `QueryError` does, plus a `compact`
// variant for inline contexts. The four terminal renders, in the web's branch precedence:
//   • 404            → "{thing} not found" with an optional Back-to-list CTA (only when a list href exists);
//   • 401 / 403      → "Sign in required" with a Sign-in CTA;
//   • 5xx            → "Server error" with an optional Retry CTA;
//   • network / else → `isOffline = !online || status == 0` splits this into two honest surfaces:
//        - offline → "You're offline" (role=status, polite) + a DISABLED "Retry when online" CTA;
//        - network → "Can't reach server" (role=alert, assertive) + a Retry CTA.
// When there is no error the web component returns `null`; this surface renders nothing in that case
// (`ErrorDisplayProjection.render` returns `null`), faithfully reproducing that branch.
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002): the surface binds a
// representative cache-then-network feed through [ErrorDisplaySource] (the Charging history feed, the same
// worked example the sibling DataFreshness surface binds) plus the connectivity signal (web
// `useOnlineStatus`). The feed's [io.teslasync.android.data.UiState] carries the `httpStatus` + `errorKind`
// the web reads off `error.status`; together with the online flag they fold here into a PII-free
// [ErrorSnapshot] (no charging rows ever escape) and then into the resolved [ErrorRender] the composable
// paints. Everything below is framework-free so the whole contract is covered by the JVM unit gate without a
// Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ErrorDisplay — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.errordisplay

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the ErrorDisplay surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`ErrorDisplay`).
 */
object ErrorDisplayRegistration {
    /** Stable surface id (also the `viewModel` key prefix the host binds the banner with). */
    const val ID: String = "error-display"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ErrorDisplay"
}

/**
 * The terminal failure branch the banner renders, mirroring the web `ErrorDisplay` status branching. [slug]
 * is the PII-free state word interpolated into the surface's accessibility state-description and is never a
 * vehicle id or message body, so it is safe to expose to TalkBack.
 */
enum class ErrorBranch(
    val slug: String,
) {
    /** HTTP 404 — the record was deleted or the link is wrong (web `status === 404`). */
    NotFound("notFound"),

    /** HTTP 401 / 403 — the session expired or RBAC denied the request (web `status === 401 || 403`). */
    Unauthorized("unauthorized"),

    /** HTTP 5xx — a backend failure (web `status >= 500`). */
    ServerError("serverError"),

    /** No connectivity (or `status == 0`) — the honest "offline / will retry" surface (web `isOffline`). */
    Offline("offline"),

    /** A reachable-but-failed request with connectivity present (web network / unknown fall-through). */
    Network("network"),
}

/**
 * Which glyph the banner paints for a branch — the native mirror of the web lucide icon per branch
 * (`FileQuestion` / `Lock` / `Server` / `WifiOff` / `AlertCircle`). The model stays framework-free; the
 * composable maps each case to a concrete `ImageVector`.
 */
enum class ErrorGlyph {
    /** 404 (web `FileQuestion`). */
    FileQuestion,

    /** 401 / 403 (web `Lock`). */
    Lock,

    /** 5xx (web `Server`). */
    Server,

    /** Offline (web `WifiOff`). */
    WifiOff,

    /** Network / unknown (web `AlertCircle`). */
    AlertCircle,
}

/** Which recovery CTA the banner offers — the native mirror of the web `_ErrorState` `action` button. */
enum class ErrorActionKind {
    /** Navigate to the corresponding list view (web 404 + `listHref`). */
    BackToList,

    /** Send the user to sign in again (web 401 / 403 → `/login`). */
    SignIn,

    /** Re-run the failed request (web 5xx / network `onRetry`). */
    Retry,

    /** A disabled affordance shown while offline (web "Retry when online", `disabled`). */
    RetryWhenOnline,
}

/**
 * A resolved CTA: its [kind] (selects the localized label + the host callback) and whether it is [enabled]
 * (the offline "Retry when online" affordance is rendered disabled, mirroring the web `disabled` button).
 */
data class ErrorAction(
    val kind: ErrorActionKind,
    val enabled: Boolean,
)

/**
 * The failure-relevant, PII-free projection of the bound feed's [UiState] plus connectivity — it carries no
 * charging rows, only the signals the banner branches on. Folded from [UiState] by [toErrorSnapshot] and
 * projected by [ErrorDisplayProjection.render], so neither the ViewModel nor the view re-derives the
 * contract.
 *
 * @property present whether there is a failure to show at all (web truthy `error`); `false` renders nothing.
 * @property httpStatus the HTTP status of an `ApiError.Http` failure, else `null` (web `error.status`).
 * @property transportFailure whether the failure was a transport error (network / timeout / circuit-open) —
 *   the native equivalent of the web `status === 0` offline signal.
 * @property online whether connectivity is currently present (web `useOnlineStatus()`).
 */
data class ErrorSnapshot(
    val present: Boolean,
    val httpStatus: Int?,
    val transportFailure: Boolean,
    val online: Boolean,
) {
    companion object {
        /** The initial, pre-collection snapshot: no failure, online — the banner shows nothing. */
        fun none(): ErrorSnapshot =
            ErrorSnapshot(
                present = false,
                httpStatus = null,
                transportFailure = false,
                online = true,
            )
    }
}

/**
 * The fully-resolved render state the composable paints — the native mirror of every value the web
 * `ErrorDisplay` derives between its props and the rendered `_ErrorState`. Pure so the composable only
 * resolves localized strings + colors from it.
 *
 * @property branch the failure tier (selects title + message copy).
 * @property glyph the icon the banner paints.
 * @property action the recovery CTA, or `null` when the branch offers none in the current configuration.
 * @property assertive whether the banner announces assertively (web `role="alert"`) vs politely
 *   (web offline `role="status"`).
 */
data class ErrorRender(
    val branch: ErrorBranch,
    val glyph: ErrorGlyph,
    val action: ErrorAction?,
    val assertive: Boolean,
)

/**
 * Folds the bound feed's [UiState] and the [online] flag onto the PII-free failure signals (no rows escape).
 * The web `error` / `error.status` map onto the cache-then-network UiState's `hasError` / `httpStatus`; a
 * transport error (no HTTP status) is flagged so the projection can treat it as the web `status === 0`
 * offline case.
 */
fun <T> UiState<T>.toErrorSnapshot(online: Boolean): ErrorSnapshot =
    ErrorSnapshot(
        present = hasError,
        httpStatus = httpStatus,
        transportFailure =
            errorKind == ErrorKind.Network ||
                errorKind == ErrorKind.Timeout ||
                errorKind == ErrorKind.CircuitOpen,
        online = online,
    )

/**
 * Pure projection of an [ErrorSnapshot] into the render state — the native mirror of every decision the web
 * `ErrorDisplay` makes between its props and the rendered banner. Framework-free so the whole contract is
 * covered by the JVM unit gate without a Compose host.
 */
object ErrorDisplayProjection {
    private const val HTTP_NOT_FOUND = 404
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_SERVER_ERROR = 500
    private const val HTTP_OFFLINE = 0

    /**
     * Projects [snapshot] into the render state, or `null` when there is no failure to show (web
     * `if (!error) return null`). [hasListHref] gates the 404 Back-to-list CTA (web `listHref`);
     * [retryable] gates the 5xx / network / offline retry CTA (web `onRetry`).
     */
    fun render(
        snapshot: ErrorSnapshot,
        hasListHref: Boolean,
        retryable: Boolean,
    ): ErrorRender? {
        if (!snapshot.present) return null
        val branch = branchFor(snapshot)
        return ErrorRender(
            branch = branch,
            glyph = glyphFor(branch),
            action = actionFor(branch, hasListHref, retryable),
            assertive = branch != ErrorBranch.Offline,
        )
    }

    /**
     * The failure tier, in the web branch precedence 404 → 401/403 → 5xx → offline → network. A transport
     * failure, an explicit offline flag, or a `status == 0` collapses into [ErrorBranch.Offline]; anything
     * else with a present failure is [ErrorBranch.Network].
     */
    fun branchFor(snapshot: ErrorSnapshot): ErrorBranch {
        val status = snapshot.httpStatus
        return when {
            status == HTTP_NOT_FOUND -> ErrorBranch.NotFound
            status == HTTP_UNAUTHORIZED || status == HTTP_FORBIDDEN -> ErrorBranch.Unauthorized
            status != null && status >= HTTP_SERVER_ERROR -> ErrorBranch.ServerError
            isOffline(snapshot) -> ErrorBranch.Offline
            else -> ErrorBranch.Network
        }
    }

    /**
     * Whether the failure should be shown as offline — the native mirror of the web
     * `isOffline = !online || status === 0`, extended with the transport-failure signal the cache-then-network
     * data layer produces when a request never reaches the server.
     */
    fun isOffline(snapshot: ErrorSnapshot): Boolean = !snapshot.online || snapshot.transportFailure || snapshot.httpStatus == HTTP_OFFLINE

    /** The glyph for a branch — the native mirror of the web per-branch lucide icon. */
    fun glyphFor(branch: ErrorBranch): ErrorGlyph =
        when (branch) {
            ErrorBranch.NotFound -> ErrorGlyph.FileQuestion
            ErrorBranch.Unauthorized -> ErrorGlyph.Lock
            ErrorBranch.ServerError -> ErrorGlyph.Server
            ErrorBranch.Offline -> ErrorGlyph.WifiOff
            ErrorBranch.Network -> ErrorGlyph.AlertCircle
        }

    /**
     * The recovery CTA for a branch — the native mirror of the web `action` slot. Back-to-list appears only
     * when a list href exists; Sign-in always appears for an unauthorized failure; retry appears only when the
     * surface is retryable, and is rendered disabled for the offline branch (web "Retry when online").
     */
    fun actionFor(
        branch: ErrorBranch,
        hasListHref: Boolean,
        retryable: Boolean,
    ): ErrorAction? =
        when (branch) {
            ErrorBranch.NotFound -> if (hasListHref) ErrorAction(ErrorActionKind.BackToList, enabled = true) else null
            ErrorBranch.Unauthorized -> ErrorAction(ErrorActionKind.SignIn, enabled = true)
            ErrorBranch.ServerError -> if (retryable) ErrorAction(ErrorActionKind.Retry, enabled = true) else null
            ErrorBranch.Network -> if (retryable) ErrorAction(ErrorActionKind.Retry, enabled = true) else null
            ErrorBranch.Offline -> if (retryable) ErrorAction(ErrorActionKind.RetryWhenOnline, enabled = false) else null
        }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the banner's retry affordance is invoked. */
const val EVENT_RETRY: String = "errorDisplay.retry"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [ErrorDisplayRegistration.SLUG]
 * (P1/S11) — never a vehicle id nor a failure payload, so a diagnostics line can never leak what the user
 * was viewing or why a request failed. Kept free of Compose so it is unit-tested with a recording [Logger];
 * the ViewModel calls it once per surface open.
 */
fun recordErrorDisplayOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ErrorDisplayRegistration.SLUG))
}

/**
 * Emits the PII-safe retry diagnostic carrying only the surface slug — never a vehicle id nor a failure
 * payload — so retries are observable without leaking which feed the user re-ran or why it had failed.
 */
fun recordErrorDisplayRetry(logger: Logger) {
    logger.info(EVENT_RETRY, mapOf(FIELD_SURFACE to ErrorDisplayRegistration.SLUG))
}
