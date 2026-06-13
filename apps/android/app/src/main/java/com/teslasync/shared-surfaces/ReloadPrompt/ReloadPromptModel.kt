// Pure, framework-free model + projection for the ReloadPrompt shared surface — the native analogue of the
// data the web component derives before returning JSX (web/src/components/feedback/ReloadPrompt.tsx). No
// Compose, no Android UI, no HTTP: every type here is exercised by the :app:testReleaseUnitTest gate so the
// composable stays a thin render layer.
//
// The web `ReloadPrompt` shows a non-intrusive banner when a new build is deployed. Its signal comes from
// `useRegisterSW().needRefresh` (a service-worker registration that periodically re-fetches the manifest);
// when a new version is waiting it renders a spinning refresh icon, a "New version available" title, a
// "Reloading in {{seconds}}s..." countdown that auto-reloads after three seconds, a "Later" dismiss, and a
// "Reload Now" action — and renders nothing while the running build is current. `useRegisterSW` is a client
// runtime capability, not a REST hook, so the native analogue is a runtime availability signal: this model
// folds that signal's cache-then-network lifecycle so the surface honestly renders the prompt's loading /
// Available / up-to-date (empty) / error / stale / offline matrix without ever hiding a region.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ReloadPrompt — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from
// the path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.reloadprompt

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the auto-reload countdown length are pinned here so the native and web surfaces stay
 * in lockstep.
 */
object ReloadPromptRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ReloadPrompt"

    /** Seconds the banner counts down before auto-reloading (web `COUNTDOWN_SECONDS = 3`). */
    const val COUNTDOWN_SECONDS: Int = 3
}

/**
 * The runtime update-availability signal the surface renders — the native port of the web
 * `useRegisterSW().needRefresh` boolean plus the optional version label a native update checker can expose
 * (the web service worker has no version, so it stays `null` there). [updateAvailable] mirrors `needRefresh`:
 * `true` means a newer build is waiting and the banner should show, `false` means the running build is
 * current.
 */
data class ReloadAvailability(
    val updateAvailable: Boolean,
    val version: String? = null,
)

/**
 * The mutually-exclusive render surface the prompt draws. [Available] is the web's single visible branch (the
 * banner); [UpToDate] reproduces the web's `if (!needRefresh) return null` as an explicit, never-hidden
 * empty state; [Loading] and [Error] surface the genuine cold-start and check-failure states of the
 * update-availability signal the surface binds.
 */
enum class ReloadPromptPhase {
    /** First availability check in flight with nothing known yet — render skeleton chrome (never a blank box). */
    Loading,

    /** A newer build is waiting (web `needRefresh`) — render the banner with the countdown + actions. */
    Available,

    /** The running build is current (web's `return null`) — render an explicit "up to date" empty state. */
    UpToDate,

    /** The availability check failed with nothing cached to fall back on — render a classified error + retry. */
    Error,
}

/**
 * Pure countdown logic for the auto-reload timer — the native port of the web `setInterval` tick
 * (`setCountdown(prev => prev <= 1 ? (reload(); 0) : prev - 1)`). Framework-free so the timing contract is
 * unit-tested without a coroutine host or a UI.
 */
object ReloadCountdown {
    /** The starting value (web `COUNTDOWN_SECONDS`). */
    const val SECONDS: Int = ReloadPromptRegistration.COUNTDOWN_SECONDS

    /** One countdown step: the [value] to display next, and whether this step triggers the auto-reload. */
    data class Tick(
        val value: Int,
        val reload: Boolean,
    )

    /**
     * Computes the next countdown step from the [current] value — the native port of the web
     * `prev <= 1 ? (reload; 0) : prev - 1`. At one second (or below) the step both reports the reload and
     * lands on zero; otherwise it simply decrements.
     */
    fun next(current: Int): Tick = if (current <= 1) Tick(0, reload = true) else Tick(current - 1, reload = false)
}

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [ReloadPromptProjection] a pure, locale-stable function.
 * Every string resolves through the P1/S10 catalog. The live "Reloading in Ns..." subtitle is formatted at
 * the render boundary because it interpolates the changing countdown, so it is not stored here.
 *
 * @property title the banner heading (web `t('pwa.newVersion')`).
 * @property later the dismiss action label (web `t('pwa.later')`).
 * @property reloadNow the apply-now action label (web `t('pwa.reloadNow')`).
 * @property upToDate the explicit empty-state label shown when the running build is current.
 * @property loadingLabel the TalkBack label for the first availability check.
 * @property staleLabel the freshness chip shown when the last check is past its TTL.
 * @property offlineLabel the freshness chip shown when the last check could not reach the server.
 */
data class ReloadPromptStrings(
    val title: String,
    val later: String,
    val reloadNow: String,
    val upToDate: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
)

/**
 * The immutable, render-ready projection the composable draws — the resolved [phase] and update [version]
 * plus the auto-reload clock ([countdownSeconds]/[autoReloadArmed]) and the cache-then-network freshness
 * envelope ([stale]/[offline]/[refreshing] + [errorKind]) so the surface honestly flags a last-known check
 * instead of presenting it as live. Pure data so [ReloadPromptProjection] is unit-tested without a UI host.
 *
 * @property autoReloadArmed the countdown is actively running toward an auto-reload (web's live `setInterval`).
 * @property dismissed the user tapped "Later"; the auto-reload is cancelled but the banner stays (the manual
 *   "Reload Now" affordance remains, so no pending update is silently hidden).
 * @property freshnessStamp the `fetchedAt` of the shown signal; keys the stale auto-refresh effect.
 */
data class ReloadPromptDisplay(
    val phase: ReloadPromptPhase,
    val version: String? = null,
    val countdownSeconds: Int = ReloadCountdown.SECONDS,
    val autoReloadArmed: Boolean = false,
    val dismissed: Boolean = false,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale or offline) should be shown over the last-known check. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == ReloadPromptPhase.Error

    /** True when the countdown subtitle ("Reloading in Ns...") should be shown. */
    val showCountdown: Boolean get() = phase == ReloadPromptPhase.Available && autoReloadArmed && !dismissed

    /** True when the dismiss ("Later") affordance should still be offered. */
    val showLater: Boolean get() = phase == ReloadPromptPhase.Available && autoReloadArmed && !dismissed
}

/**
 * Pure projection + classification logic for the ReloadPrompt surface — the native port of the web
 * component's render decisions (the `needRefresh` visible/empty branch and the countdown) plus the
 * settings-document-style freshness fold the sibling surfaces use.
 */
object ReloadPromptProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Maps the data layer's [UiPhase] onto the surface's [ReloadPromptPhase]: a first check with nothing
     * cached → [ReloadPromptPhase.Loading]; an "update available" payload → [ReloadPromptPhase.Available]
     * (web `needRefresh`); the structurally-empty "no update" payload → [ReloadPromptPhase.UpToDate] (web's
     * `return null`); a hard failure → [ReloadPromptPhase.Error].
     */
    fun phaseFor(uiPhase: UiPhase): ReloadPromptPhase =
        when (uiPhase) {
            UiPhase.Loading -> ReloadPromptPhase.Loading
            UiPhase.Content -> ReloadPromptPhase.Available
            UiPhase.Empty -> ReloadPromptPhase.UpToDate
            UiPhase.Error -> ReloadPromptPhase.Error
        }

    /**
     * Folds the availability [state] (the genuine async dependency) into the render-ready
     * [ReloadPromptDisplay] together with the holder's live countdown ([countdownSeconds]/[autoReloadArmed])
     * and the user's [dismissed] choice. The auto-reload clock is only armed for the visible [Available]
     * branch and is cleared by a dismiss, so the projection never shows a countdown for a hidden banner.
     */
    fun project(
        state: UiState<ReloadAvailability>,
        countdownSeconds: Int,
        autoReloadArmed: Boolean,
        dismissed: Boolean,
    ): ReloadPromptDisplay {
        val phase = phaseFor(state.phase)
        val armed = autoReloadArmed && phase == ReloadPromptPhase.Available && !dismissed
        return ReloadPromptDisplay(
            phase = phase,
            version = state.data?.version,
            countdownSeconds = countdownSeconds,
            autoReloadArmed = armed,
            dismissed = dismissed,
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: ReloadPromptDisplay): QueryErrorKind =
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

    /**
     * The spoken (TalkBack) description for the surface's current state — a pure function so the a11y contract
     * is unit-tested off-device. The live countdown subtitle is supplied pre-formatted by the render boundary
     * (it interpolates the changing seconds), so callers pass [countdownText] for the armed [Available] case.
     */
    fun contentDescription(
        display: ReloadPromptDisplay,
        strings: ReloadPromptStrings,
        countdownText: String,
    ): String =
        when (display.phase) {
            ReloadPromptPhase.Loading -> strings.loadingLabel
            ReloadPromptPhase.UpToDate -> strings.upToDate
            ReloadPromptPhase.Error -> strings.title
            ReloadPromptPhase.Available ->
                if (display.showCountdown) "${strings.title}. $countdownText" else strings.title
        }
}
