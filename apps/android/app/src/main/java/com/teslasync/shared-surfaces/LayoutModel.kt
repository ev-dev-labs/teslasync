// Pure, framework-free model + projection for the Layout shared surface — the native analogue of the
// state the web app shell derives before returning JSX (web/src/components/layout/Layout.tsx). No
// Compose, no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate
// so the composable stays a thin render layer.
//
// The web `Layout` is the application chrome: a collapsible sidebar (a "Current" card, a "Pinned" list,
// and the grouped, collapsible nav sections with live count badges), a header, a content host with the
// routed page, a bottom tab bar, and a footer status bar. It binds three live feeds — the vehicle list
// (`useVehicles`, drives the fleet count + the /vehicles badge + the minVehicles nav filter), the alert
// list (`useAlerts`, drives the unread badge + the SSE alert toast), and the deployment auth mode
// (`useIsForwardAuth`, hides the auth-gated nav items in open mode). This model reproduces the data those
// feeds drive — the badge counts, the nav visibility filter, the active-route match, the pinned-route
// resolution, and the cache-then-network freshness fold — so the surface can honestly render the
// prompt's loading / content / empty / error / stale / offline matrix without ever hiding the chrome.
//
// The navigation taxonomy itself is NOT re-encoded here: it is read from the shared, already-localized
// route registry (io.teslasync.android.navigation.RouteTable.drawerSections / Destinations / NavGroup),
// so the surface and the real app navigation stay in lockstep (one source of truth).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Layout — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layout

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.NavGroup
import io.teslasync.android.navigation.NavSection
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.notifications.Alert

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the default-pinned seed (web `DEFAULT_PINNED_NAV_PATHS`), the pin cap (web
 * `MAX_PINNED_NAV_ITEMS`), and the auth-gated destination ids (web `requiresAuth` items) are pinned here
 * so the native and web shells stay in lockstep.
 */
object LayoutRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Layout"

    /** Destination ids seeded into the pinned list (web `DEFAULT_PINNED_NAV_PATHS`, resolved to web paths). */
    val DEFAULT_PINNED_IDS: List<String> = listOf("dashboard", "digitalTwin", "vehicles", "charging", "liveMap")

    /** Maximum pinned items kept (web `MAX_PINNED_NAV_ITEMS`). */
    const val MAX_PINNED: Int = 8

    /** Maximum "recently used" items tracked (web `MAX_RECENT_NAV_ITEMS`). */
    const val MAX_RECENT: Int = 3

    /** Count above which a badge collapses to "N+" (web `> 9 ? '9+'`). */
    const val BADGE_OVERFLOW: Int = 9

    /**
     * Destination ids hidden when the deployment is NOT behind a ForwardAuth identity provider — the
     * native mirror of the web nav items flagged `requiresAuth`, whose endpoints 503 in open mode.
     */
    val FORWARD_AUTH_ONLY: Set<String> = setOf("myActivity", "account2fa", "accountSessions")
}

/**
 * The freshness envelope the shell flags over its live sidebar counts — folded from the bound vehicle
 * feed's [UiState] so last-known counts are never presented as live. [Live] shows no chip; [Stale] shows
 * the stale chip while a refresh runs over cached data; [Offline] shows the offline chip when a refresh
 * failed but cached data is still served.
 */
enum class LayoutFreshness { Live, Stale, Offline }

/**
 * The live sidebar counts the shell renders — the native port of the web `unreadAlerts` / `vehicleCount`
 * derivations. Both default to zero while their feed is loading or errored with no cache, so a badge is
 * never shown for an unknown count.
 *
 * @property vehicleCount the enrolled-vehicle count (web `vehicles?.length ?? 0`).
 * @property unreadAlerts the unread-alert count (web `alerts?.filter(a => !a.is_read).length ?? 0`).
 */
data class LayoutBadges(
    val vehicleCount: Int,
    val unreadAlerts: Int,
) {
    /** True when at least one vehicle is enrolled (drives the /vehicles count badge). */
    val hasVehicles: Boolean get() = vehicleCount > 0

    /** True when there is at least one unread alert (drives the alert-center badge + the bell dot). */
    val hasUnreadAlerts: Boolean get() = unreadAlerts > 0

    /** The unread-alert badge text, collapsing to "9+" past the overflow cap (web `> 9 ? '9+'`). */
    val alertBadgeText: String
        get() = if (unreadAlerts > LayoutRegistration.BADGE_OVERFLOW) "${LayoutRegistration.BADGE_OVERFLOW}+" else unreadAlerts.toString()

    /** The vehicle-count badge text (uncapped, web renders `vehicles.length` verbatim). */
    val vehicleBadgeText: String get() = vehicleCount.toString()
}

/**
 * Localized chrome labels the surface folds into its output. Built from `stringResource` at the render
 * boundary (tests pass a deterministic instance), keeping [LayoutProjection] a pure, locale-stable
 * object. Every string resolves through the P1/S10 catalog and mirrors a `t()` call in the web source.
 */
data class LayoutStrings(
    val primaryNav: String,
    val primaryHeader: String,
    val openSidebar: String,
    val closeSidebar: String,
    val current: String,
    val pinned: String,
    val pinAction: String,
    val pinnedAction: String,
    val pinCurrent: String,
    val unpinCurrent: String,
    val unpinPageTemplate: String,
    val recentlyUsed: String,
    val sections: String,
    val expandAll: String,
    val collapseAll: String,
    val quickSearchHint: String,
    val openThemePicker: String,
    val customize: String,
    val alertTitle: String,
    val viewAction: String,
    val notifications: String,
    val loading: String,
    val stale: String,
    val offline: String,
    val noVehiclesTitle: String,
    val noVehiclesMessage: String,
) {
    /** Resolves the per-item unpin label from the "Unpin %1$s" template (web `nav.unpinPage`). */
    fun unpinPage(page: String): String = unpinPageTemplate.replace("%1\$s", page)
}

/**
 * Pure projection + selection logic for the Layout surface — the native port of the web shell's
 * derivations (`isVisibleNavItem`, `isActiveNavPath`, `findNavItemByPath`, the badge counts, the pinned
 * resolution, and the cache-then-network freshness fold). Side-effect-free so the whole contract is
 * unit-tested off-device.
 */
object LayoutProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * True when [destination] should be shown — the native port of the web `isVisibleNavItem`'s
     * `requiresAuth` branch: an auth-gated destination is hidden until the deployment runs behind a
     * ForwardAuth provider ([isForwardAuth]).
     */
    fun isVisible(
        destination: Destination,
        isForwardAuth: Boolean,
    ): Boolean = isForwardAuth || destination.id !in LayoutRegistration.FORWARD_AUTH_ONLY

    /**
     * Filters each [NavSection]'s items by [isVisible] and drops sections left empty — the native port of
     * the web `visibleNavSections` memo.
     */
    fun visibleSections(
        sections: List<NavSection>,
        isForwardAuth: Boolean,
    ): List<NavSection> =
        sections
            .map { section -> section.copy(items = section.items.filter { isVisible(it, isForwardAuth) }) }
            .filter { it.items.isNotEmpty() }

    /**
     * Folds the two live feeds into the render-ready [LayoutBadges] — the native port of the web
     * `unreadAlerts` / `vehicleCount` derivations. A loading/errored feed contributes zero.
     */
    fun badges(
        vehicles: UiState<List<Vehicle>>,
        alerts: UiState<List<Alert>>,
    ): LayoutBadges =
        LayoutBadges(
            vehicleCount = vehicles.data?.size ?: 0,
            unreadAlerts = alerts.data?.count { !it.isRead } ?: 0,
        )

    /**
     * Maps the bound feed's [state] to the shell's [LayoutFreshness] chip — honest freshness so cached
     * counts served after a stale TTL or a failed refresh are flagged, never shown as live.
     */
    fun freshness(state: UiState<*>): LayoutFreshness =
        when {
            state.isOffline && state.errorKind != null -> LayoutFreshness.Offline
            state.stale -> LayoutFreshness.Stale
            else -> LayoutFreshness.Live
        }

    /**
     * True when [activeWebPath] resolves to [destinationWebPath] — the native port of the web
     * `isActiveNavPath`: the root matches only itself; every other path matches its exact value or any
     * descendant under it.
     */
    fun isActive(
        activeWebPath: String,
        destinationWebPath: String,
    ): Boolean =
        if (destinationWebPath == "/") {
            activeWebPath == "/"
        } else {
            activeWebPath == destinationWebPath || activeWebPath.startsWith("$destinationWebPath/")
        }

    /** The destination matching [activeWebPath] across [sections], or null — the web `findNavItemByPath`. */
    fun activeDestination(
        sections: List<NavSection>,
        activeWebPath: String,
    ): Destination? = sections.firstNotNullOfOrNull { section -> section.items.firstOrNull { isActive(activeWebPath, it.webPath) } }

    /** The group owning the destination matching [activeWebPath], or null (the web `activeSectionTitle`). */
    fun activeGroup(
        sections: List<NavSection>,
        activeWebPath: String,
    ): NavGroup? = sections.firstOrNull { section -> section.items.any { isActive(activeWebPath, it.webPath) } }?.group

    /** The default-pinned web paths, resolving [LayoutRegistration.DEFAULT_PINNED_IDS] via the registry. */
    fun defaultPinnedPaths(): List<String> = LayoutRegistration.DEFAULT_PINNED_IDS.map { Destinations.require(it).webPath }

    /**
     * Resolves [pinnedPaths] to visible destinations, in pin order, capped at [LayoutRegistration.MAX_PINNED]
     * — the native port of the web `pinnedNavItems` memo (a saved path no longer in the nav is dropped).
     */
    fun pinnedDestinations(
        sections: List<NavSection>,
        pinnedPaths: List<String>,
        isForwardAuth: Boolean,
    ): List<Destination> {
        val byPath = sections.flatMap { it.items }.associateBy { it.webPath }
        return pinnedPaths
            .mapNotNull { byPath[it] }
            .filter { isVisible(it, isForwardAuth) }
            .take(LayoutRegistration.MAX_PINNED)
    }

    /**
     * Resolves [recentPaths] to visible destinations, excluding the one matching [activeWebPath] (already
     * highlighted in its canonical section), capped at [LayoutRegistration.MAX_RECENT] — the native port
     * of the web `recentNavItems` memo. The web sidebar render is feature-flagged off, so a host may hide
     * this list; the tracking + resolution are reproduced verbatim.
     */
    fun recentDestinations(
        sections: List<NavSection>,
        recentPaths: List<String>,
        activeWebPath: String,
    ): List<Destination> {
        val byPath = sections.flatMap { it.items }.associateBy { it.webPath }
        return recentPaths
            .mapNotNull { byPath[it] }
            .filterNot { isActive(activeWebPath, it.webPath) }
            .take(LayoutRegistration.MAX_RECENT)
    }

    /** Prepends [path] to [recentPaths] (deduped, capped) — the native port of the web recent-tracking effect. */
    fun trackRecent(
        recentPaths: List<String>,
        path: String,
    ): List<String> = (listOf(path) + recentPaths.filterNot { it == path }).take(LayoutRegistration.MAX_RECENT)

    /** Toggles [path] in [pinnedPaths] — pin prepends (capped), unpin removes (web `pinNavPath`/`unpinNavPath`). */
    fun togglePinned(
        pinnedPaths: List<String>,
        path: String,
    ): List<String> =
        if (path in pinnedPaths) {
            pinnedPaths.filterNot { it == path }
        } else {
            (listOf(path) + pinnedPaths).take(LayoutRegistration.MAX_PINNED)
        }

    /** The most recent unread alert, or null — backs the shell's SSE alert banner (web `useRealtimeEvents`). */
    fun latestUnreadAlert(alerts: UiState<List<Alert>>): Alert? = alerts.data?.firstOrNull { !it.isRead }

    /**
     * Maps an alert severity onto the banner [Tone] — the native port of the web toast-type selection
     * (`critical → error`, `warning → warning`, else `info`).
     */
    fun alertTone(severity: String): Tone =
        when (severity) {
            "critical" -> Tone.Danger
            "warning" -> Tone.Warning
            else -> Tone.Info
        }

    /**
     * Maps the bound feed's hard-error [state] onto the shared [QueryErrorKind] recovery bucket so the
     * content host shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity
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
