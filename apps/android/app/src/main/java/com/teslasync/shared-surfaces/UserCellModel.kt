// Pure, framework-free model + projection for the UserCell shared surface — the native analogue of the
// data the web component derives before returning JSX (web/src/components/data-display/UserCell.tsx). No
// Compose, no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so
// the composable stays a thin render layer.
//
// The web `UserCell` is a tiny presentational cell for user-attributed columns (audit "actor", feedback
// "reporter", notification "delivered to", …). Given a (possibly null) user it renders the shared Avatar
// beside a display name with an optional muted email line, or an em dash when the user has no identity worth
// showing. Its display-name priority is name → email local-part → id → t('avatar.unknown'). This model
// reproduces that selection + the empty branch EXACTLY, and folds in the cache-then-network lifecycle of the
// genuine async dependency a self-contained surface binds — the P1/S8 current-user document
// (`GET /users/me`) — so the surface can honestly render the prompt's loading / content / empty / error /
// stale / offline matrix without ever hiding a region.
//
// The atomic `components/datadisplay/UserCell` is the bare inline cell (the component-library bundle, out of
// scope here); THIS surface is the state-aware identity card. It reuses the one shared component the web
// source actually composes — the native `Avatar` — at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/UserCell — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usercell

import io.teslasync.android.components.datadisplay.AvatarSize
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.user.User

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the i18n key for the unknown-user fallback, and the em dash the empty branch renders are
 * pinned here so the native and web surfaces stay in lockstep.
 */
object UserCellRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "UserCell"

    /** i18n key for the no-name fallback display name (web `t('avatar.unknown', 'Unknown user')`). */
    const val UNKNOWN_LABEL_KEY: String = "avatar.unknown"

    /** The em dash the web renders when the user has no attributable identity (`<span>—</span>`). */
    const val EMPTY_VALUE: String = "\u2014"
}

/**
 * Minimal user record the cell renders — the native port of the web `UserCellUser`
 * (`{ id?, name?, email?, avatarUrl? }`). Every field is optional; a record with none of [id]/[name]/[email]
 * is "unattributable" and renders as the empty em dash, exactly like the web `!user.id && …` branch.
 */
data class UserCellUser(
    val id: String? = null,
    val name: String? = null,
    val email: String? = null,
    val avatarUrl: String? = null,
) {
    /**
     * True when the user has at least one non-empty identity field worth rendering — the native port of the
     * web truthiness check `user && (user.name || user.email || user.id)`. An empty string counts as missing
     * (the web `''` is falsy), so a blank-only record is correctly treated as empty.
     */
    val isAttributable: Boolean
        get() = !name.isNullOrEmpty() || !email.isNullOrEmpty() || !id.isNullOrEmpty()

    companion object {
        /**
         * Projects the shared-core [User] document (`GET /users/me`) onto the cell's record — the native port
         * of `<UserCell user={me} />`. The [User] string fields default to `""`; empties collapse to `null` so
         * the attributability check and the em-dash empty branch behave exactly as the web's falsy checks do.
         */
        fun fromUser(user: User): UserCellUser =
            UserCellUser(
                id = user.id.ifEmpty { null },
                name = user.displayName.ifEmpty { null },
                email = user.email.ifEmpty { null },
                avatarUrl = user.avatarUrl?.ifEmpty { null },
            )
    }
}

/**
 * The mutually-exclusive render surface the cell draws. [Content] and [Empty] reproduce the web's two
 * visible branches (the avatar + name vs the em dash); [Loading] and [Error] surface the genuine cold-start
 * and hard-failure states of the current-user document the surface binds.
 */
enum class UserCellPhase {
    /** First current-user load with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** An attributable user is available — render the avatar + display name (+ optional email). */
    Content,

    /** The user resolved but has no attributable identity (web `!name && !email && !id`) — render the em dash. */
    Empty,

    /** The current-user load failed with nothing cached to fall back on — render a classified error + retry. */
    Error,
}

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [UserCellProjection] a pure, locale-stable function. Every
 * string resolves through the P1/S10 catalog.
 *
 * @property unknownLabel the no-name fallback (web `t('avatar.unknown')`).
 * @property loadingLabel the TalkBack label for the loading skeleton.
 * @property staleLabel the freshness chip shown when cached identity is past its TTL.
 * @property offlineLabel the freshness chip shown when cached identity is served after a failed refresh.
 * @property title the resource noun the error surface personalises ("Profile not found", …).
 */
data class UserCellStrings(
    val unknownLabel: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val title: String,
)

/**
 * The immutable, render-ready projection the composable draws — everything the web `UserCell` folds together
 * (the resolved [user], the computed [displayName], whether the [email] line shows) plus the cache-then-
 * network freshness envelope ([stale]/[offline]/[refreshing] + [errorKind]) so the surface honestly flags
 * last-known identity instead of presenting it as live. Pure data so [UserCellProjection] is unit-tested
 * without a UI host.
 *
 * @property stale cached identity is past its TTL and a refresh is in flight (no failure yet).
 * @property offline cached identity is shown because a refresh failed (network unreachable / "last known").
 * @property freshnessStamp the `fetchedAt` of the shown identity; keys the stale auto-refresh effect.
 */
data class UserCellDisplay(
    val phase: UserCellPhase,
    val user: UserCellUser?,
    val displayName: String,
    val email: String?,
    val showEmailLine: Boolean,
    val size: AvatarSize,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale or offline) should be shown over the cached identity. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == UserCellPhase.Error
}

/**
 * Pure projection + selection logic for the UserCell surface — the native port of the web component's
 * display-name derivation and empty branch, plus the settings-document-style freshness fold the sibling
 * surfaces use.
 */
object UserCellProjection {
    private const val EMAIL_LOCAL_DELIMITER = "@"
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Computes the rendered display name — the native port of the web
     * `user.name?.trim() || user.email?.split('@')[0] || user.id || t('avatar.unknown')`. Each candidate is
     * accepted only when non-empty (the web falsy chain), so a whitespace-only name falls through to the email
     * local-part, then the id, then the localized unknown label.
     */
    fun displayName(
        user: UserCellUser?,
        unknownLabel: String,
    ): String {
        if (user == null) return unknownLabel
        return user.name?.trim()?.takeIf { it.isNotEmpty() }
            ?: user.email?.substringBefore(EMAIL_LOCAL_DELIMITER)?.takeIf { it.isNotEmpty() }
            ?: user.id?.takeIf { it.isNotEmpty() }
            ?: unknownLabel
    }

    /**
     * Folds the current-user [state] (the genuine async dependency) into the render-ready [UserCellDisplay]
     * with the caller's [showEmail] + avatar [size] preferences. Phase resolution honours both the web's two
     * visible branches and the document's async lifecycle: a hard failure with no cache → [UserCellPhase.Error];
     * a first load with nothing cached → [UserCellPhase.Loading]; otherwise an attributable user →
     * [UserCellPhase.Content] (web avatar + name) and an unattributable one → [UserCellPhase.Empty] (web em dash).
     */
    fun project(
        state: UiState<User>,
        showEmail: Boolean,
        size: AvatarSize,
        unknownLabel: String,
    ): UserCellDisplay {
        val user = state.data?.let(UserCellUser::fromUser)
        val attributable = user?.isAttributable == true
        val phase =
            when {
                state.isError -> UserCellPhase.Error
                state.isLoading -> UserCellPhase.Loading
                !attributable -> UserCellPhase.Empty
                else -> UserCellPhase.Content
            }
        val name = if (phase == UserCellPhase.Content) displayName(user, unknownLabel) else unknownLabel
        val email = user?.email
        return UserCellDisplay(
            phase = phase,
            user = user,
            displayName = name,
            email = email,
            showEmailLine = showEmail && phase == UserCellPhase.Content && !email.isNullOrBlank(),
            size = size,
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * The spoken (TalkBack) description for the cell's current surface — a pure function so the a11y contract
     * is unit-tested off-device. Loading announces the loading label, the empty branch announces the unknown
     * label (never a bare dash), and content announces the name plus the email when that line is shown.
     */
    fun contentDescription(
        display: UserCellDisplay,
        strings: UserCellStrings,
    ): String =
        when (display.phase) {
            UserCellPhase.Loading -> strings.loadingLabel
            UserCellPhase.Empty -> strings.unknownLabel
            UserCellPhase.Error -> strings.title
            UserCellPhase.Content ->
                if (display.showEmailLine && !display.email.isNullOrBlank()) {
                    "${display.displayName}, ${display.email}"
                } else {
                    display.displayName
                }
        }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface shows
     * the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure → [QueryErrorKind.Network];
     * a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound]; every other HTTP/decode/unknown
     * failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: UserCellDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}
