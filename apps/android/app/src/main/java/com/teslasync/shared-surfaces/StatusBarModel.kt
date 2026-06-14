// Pure, framework-free model + projection for the StatusBar shared surface — the native analogue of the
// state the web footer derives before returning JSX (web/src/components/layout/StatusBar.tsx). No Compose,
// no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so the
// composable stays a thin render layer.
//
// The web `StatusBar` is the always-on footer chrome: a fixed bar pinned to the bottom of the viewport
// that consolidates five status segments (API health · live telemetry · active vehicle · background jobs ·
// version, plus a help cluster). The container itself reads no remote data — each segment is its own
// component fed by its own hook, and each is ported as its OWN P3 shared surface (A-0178 ConnectionSegment,
// …). What the CONTAINER owns, and what this model reproduces, is: the persisted user preferences
// (`useStatusBarPrefs` — show/hide the bar, force icon-only), the narrow-viewport → icon-only collapse
// (`useNarrowViewport`, the web `lg`/1024px breakpoint), the responsive height/placement, and the
// `role="status" aria-live="polite"` landmark that announces offline↔online transitions. The segments are
// composed through slots (the web `<ConnectionSegment/>`… children), never re-encoded here.
//
// The preferences are the surface's single (local) data source, so their cache-then-network lifecycle —
// hydrating from persistence → resolved, the disabled bar (the structurally-"empty" branch), a read
// failure that degrades to last-known/defaults — drives the prompt's loading/content/empty/error/stale/
// offline state matrix honestly, without ever fabricating a remote feed the web container does not have.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/StatusBar — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.statusbar

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.WindowWidth

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the persistence key (web `STORAGE_KEY`), and the default preferences (web `DEFAULTS`)
 * are pinned here so the native and web shells stay in lockstep.
 */
object StatusBarRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StatusBar"

    /** Persistence key for the bar preferences (web `STORAGE_KEY` = `teslasync-status-bar-prefs`). */
    const val STORAGE_KEY: String = "teslasync-status-bar-prefs"

    /** Bar height in dp when expanded — the web desktop `h-7` (28px) tier. */
    const val HEIGHT_WIDE_DP: Int = 28

    /** Bar height in dp when collapsed — the web mobile `h-6` (24px) tier. */
    const val HEIGHT_NARROW_DP: Int = 24

    /** The defaults applied before/without persisted state (web `DEFAULTS = { enabled: true, iconOnly: false }`). */
    val DEFAULTS: StatusBarPreferences = StatusBarPreferences(enabled = true, iconOnly = false)
}

/**
 * The persisted footer preferences — the native port of the web `StatusBarPrefs`. Both fields default via
 * [StatusBarRegistration.DEFAULTS] so a missing/corrupt persisted value never hides the bar unexpectedly.
 *
 * @property enabled show the status bar at all (web `enabled`); `false` ⇒ the structurally-empty branch.
 * @property iconOnly force every segment into its icon-only variant regardless of width (web `iconOnly`).
 */
data class StatusBarPreferences(
    val enabled: Boolean,
    val iconOnly: Boolean,
)

/**
 * The freshness envelope the shell flags over its (locally persisted) preferences — folded from the bound
 * preference feed's [UiState] so last-known prefs are never presented as live. [Live] shows no chip;
 * [Stale] shows the stale chip while a re-hydrate runs over cached prefs; [Offline] shows the offline chip
 * when a persistence read failed but cached prefs are still served. The bar's `aria-live` region announces
 * the transition either way (web `role="status" aria-live="polite"`).
 */
enum class StatusBarFreshness { Live, Stale, Offline }

/**
 * The responsive geometry the bar renders at — the native port of the web `h-6 lg:h-7` / `bottom-14
 * lg:bottom-0` rules. On narrow widths the bar is denser and stacks above the bottom tab bar; on expanded
 * widths it is taller and sits flush at the bottom.
 *
 * @property heightDp the bar content height in dp.
 * @property stacksAboveTabBar whether the bar sits above the bottom tab bar (web mobile `bottom-14`).
 */
data class StatusBarMetrics(
    val heightDp: Int,
    val stacksAboveTabBar: Boolean,
)

/**
 * Localized chrome labels the surface folds into its output. Built from `stringResource` at the render
 * boundary (tests pass a deterministic instance), keeping [StatusBarProjection] a pure, locale-stable
 * object. `applicationStatus` mirrors the only `t()` call in the web container (`statusBar.aria`); the
 * remaining labels back the container-owned affordances (the disabled-bar restore action and the
 * freshness chips), each resolving through the P1/S10 catalog.
 */
data class StatusBarStrings(
    val applicationStatus: String,
    val barLabel: String,
    val showBar: String,
    val showBarHelp: String,
    val hiddenNotice: String,
    val iconOnlyLabel: String,
    val loading: String,
    val stale: String,
    val offline: String,
    val retry: String,
) {
    /** True when every accessibility-critical label is present (no blank aria/action copy ships). */
    val hasAccessibilityLabels: Boolean
        get() = applicationStatus.isNotBlank() && showBar.isNotBlank() && barLabel.isNotBlank()
}

/**
 * Pure projection + selection logic for the StatusBar surface — the native port of the web container's
 * derivations (`iconOnly = compact || prefs.iconOnly || isNarrow`, the `useNarrowViewport` breakpoint, the
 * responsive height/placement, and the freshness fold). Side-effect-free so the whole contract is
 * unit-tested off-device.
 */
object StatusBarProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * True when the bar should collapse to icon-only — the native port of the web `useNarrowViewport`'s
     * `(max-width: 1023px)` query: every width below the `lg` (expanded) tier is "narrow".
     */
    fun isNarrow(width: WindowWidth): Boolean = width != WindowWidth.Expanded

    /**
     * Resolves the icon-only mode exactly as the web container does:
     * `compact || prefs.iconOnly || isNarrow` (the `compact` prop, the persisted preference, or a narrow
     * viewport each force it).
     */
    fun iconOnly(
        prefs: StatusBarPreferences,
        compact: Boolean,
        width: WindowWidth,
    ): Boolean = compact || prefs.iconOnly || isNarrow(width)

    /**
     * The structurally-empty predicate for the preference feed — a disabled bar (web `if (!prefs.enabled)
     * return null`) is the "no value to show" branch, surfaced as a friendly restore affordance rather
     * than the web's blank `null` per the prompt's states contract.
     */
    fun isHidden(prefs: StatusBarPreferences): Boolean = !prefs.enabled

    /**
     * The responsive [StatusBarMetrics] for [width] — the native port of the web `h-6 lg:h-7` /
     * `bottom-14 lg:bottom-0` rules.
     */
    fun metrics(width: WindowWidth): StatusBarMetrics =
        if (isNarrow(width)) {
            StatusBarMetrics(heightDp = StatusBarRegistration.HEIGHT_NARROW_DP, stacksAboveTabBar = true)
        } else {
            StatusBarMetrics(heightDp = StatusBarRegistration.HEIGHT_WIDE_DP, stacksAboveTabBar = false)
        }

    /**
     * Maps the bound feed's [state] to the shell's [StatusBarFreshness] chip — honest freshness so cached
     * preferences served after a stale TTL or a failed read are flagged, never shown as live.
     */
    fun freshness(state: UiState<*>): StatusBarFreshness =
        when {
            state.isOffline && state.errorKind != null -> StatusBarFreshness.Offline
            state.stale -> StatusBarFreshness.Stale
            else -> StatusBarFreshness.Live
        }

    /**
     * Maps the bound feed's hard-error [state] onto the shared [QueryErrorKind] recovery bucket so the
     * bar's error branch shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity
     * failure → [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 →
     * [QueryErrorKind.NotFound]; every other failure → [QueryErrorKind.ServerError] with a retry.
     */
    fun queryErrorKind(state: UiState<*>): QueryErrorKind =
        when (state.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (state.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}
