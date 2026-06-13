// Pure model + projection for the LinearSidebar shared surface — the native analogue of everything the web
// component derives before returning JSX (web/src/components/layout/sidebar/LinearSidebar.tsx). The projection
// performs NO @Composable work and makes NO Android-framework calls, so every derivation here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer. (An
// [ImageVector] is carried per row as an immutable leading page-marker glyph handle the host supplies from the
// canonical nav registry — a plain data carrier, constructed freely on the JVM in tests.)
//
// The web `LinearSidebar` is a Linear/Notion-inspired single quiet column that replaces the default sidebar's
// `<nav>` block: a permanent un-collapsable "Favorites" group (whenever ≥1 item is pinned), tiny uppercase
// click-to-collapse section headers, an active row marked only by a 2px left accent bar + medium weight, and
// an inline Notion-style tree filter that narrows the tree without flattening it (every whitespace token must
// substring-match the label) and silently collapses sections with no match. This native surface reproduces
// each of those derivations exactly and layers them onto the shared cache-then-network lifecycle (folded once
// by the canonical [io.teslasync.android.data.toUiState]) so freshness is interpreted identically here and on
// every other native surface: loading / content / empty / error, plus the ADR-013 stale·offline·refreshing
// flags carried over cached rows, plus the web source's own "no results after filter" branch.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/LinearSidebar — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.linearsidebar

import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug is pinned here so the native and web surfaces stay in lockstep.
 */
object LinearSidebarRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LinearSidebar"
}

// ─── Feed input (the native analogue of the web component's props, owned by the host) ────────────────────

/**
 * One navigable destination — the native analogue of the web nav item `{ to, icon, label, dataTour }`. The
 * [label] is already resolved by the host through the P1/S10 i18n facade (web `navLabel(item.label)`); the
 * [icon] is the quiet leading page-marker glyph the host pulls from the canonical nav registry; [to] is the
 * route the active-path comparison and trailing-badge rules key on; [dataTour] is an optional product-tour /
 * test anchor (web `data-tour`).
 */
data class LinearNavItem(
    val to: String,
    val label: String,
    val icon: ImageVector,
    val dataTour: String? = null,
)

/** One titled, collapsible section of nav items — the native analogue of the web `navSections` entry. */
data class LinearNavSection(
    val title: String,
    val items: List<LinearNavItem>,
)

/**
 * The full nav payload the surface binds to (the native analogue of the web component's props, already
 * visibility-filtered by the host). [activePath] is the live route (web `useLocation().pathname`) that drives
 * the active-row highlight and the default section expansion; [pinnedItems] is the Favorites group in
 * pin-order; the badge counts drive the quiet trailing markers (a dot for alerts, a chip for vehicles /
 * stale-rows) exactly as the web source.
 */
data class LinearSidebarNav(
    val sections: List<LinearNavSection>,
    val pinnedItems: List<LinearNavItem> = emptyList(),
    val activePath: String = "/",
    val alertCount: Int = 0,
    val vehicleCount: Int = 0,
    val staleCount: Int = 0,
)

// ─── Projection output (render-ready) ────────────────────────────────────────────────────────────────────

/**
 * The mutually-exclusive primary surface the sidebar body renders for the bound nav feed — the native mirror
 * of the web source's branches (the tree, the no-results row) extended with the explicit loading / empty /
 * error surfaces the prompt's state matrix mandates. Freshness (stale/offline/refreshing) is carried as
 * orthogonal flags on [LinearSidebarDisplay] so cached rows stay visible while a chip is shown.
 */
enum class LinearSidebarPhase {
    /** A first nav load is in flight with nothing cached — shimmering skeleton chrome. */
    Loading,

    /** The nav resolved with one or more sections / pinned items — render the tree (fresh or cached). */
    Content,

    /** The nav resolved with zero sections and zero pinned items — a friendly empty state, never a blank box. */
    Empty,

    /** A hard nav-load failure with nothing cached to fall back on — an error surface with retry. */
    Error,
}

/** Which quiet trailing marker a row carries (web `trailingFor`) — a dot for alerts, a count chip otherwise. */
sealed interface TrailingBadge {
    /** A single dot for "has unread", never a number (web `NotificationDot` on `/notifications/alerts`). */
    data object AlertDot : TrailingBadge

    /** A tiny monochrome count chip (web `CountChip`) for the vehicles / stale-rows counts. */
    data class Count(
        val value: Int,
        val semantic: CountSemantic,
    ) : TrailingBadge
}

/** The semantic of a [TrailingBadge.Count] so the render layer can resolve the right P1/S10 accessible label. */
enum class CountSemantic { Vehicles, Stale }

/**
 * One render-ready nav row — a nav item enriched with everything the web `LinearNavLink` carries: whether it
 * is the [active] page, its quiet [trailing] marker, whether it is already [pinned] (so a section row hides
 * its pin affordance while a favorites row shows unpin), and the leading page-marker [icon].
 */
data class LinearNavRow(
    val to: String,
    val label: String,
    val icon: ImageVector,
    val active: Boolean,
    val trailing: TrailingBadge?,
    val dataTour: String?,
    val pinned: Boolean,
)

/**
 * One render-ready section row — the filtered section enriched with whether it is [expanded] (force-true while
 * searching, else driven by the collapsed set), its [itemCount] (web header count), and the projected [rows]
 * (populated only while [expanded], mirroring the web DOM which maps items only when open).
 */
data class LinearSectionRow(
    val title: String,
    val expanded: Boolean,
    val itemCount: Int,
    val rows: List<LinearNavRow>,
)

/**
 * The projected, render-ready sidebar state — everything the web component computes before mapping it to rows,
 * plus the ADR-013 freshness flags.
 *
 * @property phase the primary body surface to render.
 * @property favorites the filtered Favorites rows (web pinned `.filter(matchesFilter).map(...)`).
 * @property hasFavorites whether the Favorites group header shows at all (web `pinnedItems.length > 0`).
 * @property sections the filtered, non-empty section rows (web `expandedSections`).
 * @property activeSectionTitle the title of the section containing the active page (drives auto-expand), or null.
 * @property isSearching whether a non-blank filter needle is active (web `filterTokens.length > 0`).
 * @property noResults true when a filter is active but every section was eliminated (web `showNoResults`).
 * @property stale whether the shown rows are flagged stale (older than TTL, refresh in flight, no failure).
 * @property offline whether cached rows are shown because a refresh failed (network unreachable).
 * @property refreshing whether a refresh is currently running over already-shown rows.
 * @property errorKind the classification of the most recent failure, or `null` when there is none.
 * @property httpStatus the HTTP status when [errorKind] is [ErrorKind.Http], else `null`.
 * @property canRetry whether a retry affordance should be offered (hard error, or stale/offline cache).
 * @property freshnessStamp the `fetchedAt` of the shown rows; keys the stale auto-refresh effect.
 */
data class LinearSidebarDisplay(
    val phase: LinearSidebarPhase,
    val favorites: List<LinearNavRow> = emptyList(),
    val hasFavorites: Boolean = false,
    val sections: List<LinearSectionRow> = emptyList(),
    val activeSectionTitle: String? = null,
    val isSearching: Boolean = false,
    val noResults: Boolean = false,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val canRetry: Boolean = false,
    val freshnessStamp: Long? = null,
) {
    /** True while a loading mark should spin (a first load, or a refresh over cached rows). */
    val busy: Boolean get() = phase == LinearSidebarPhase.Loading || refreshing

    /** True when a freshness chip (stale or offline) should be shown over the cached rows. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when the resolved tree (favorites and/or sections) should be drawn, rather than a chrome surface. */
    val showTree: Boolean get() = phase == LinearSidebarPhase.Content
}

/**
 * The immutable, render-ready model the composable draws — the sidebar [display] folded together with the
 * controlled [filterQuery] the inline tree-filter box reflects. Pure data so the projection is unit-tested
 * with no UI host.
 */
data class LinearSidebarUiModel(
    val display: LinearSidebarDisplay,
    val filterQuery: String,
)

/**
 * The controlled interaction state the web LinearSidebar owns alongside the nav feed — the [collapsed] section
 * titles and the [filter] needle. Grouped into one value so [LinearSidebarProjection.project] folds the feed
 * and the interaction in a single call.
 */
data class LinearSidebarInteraction(
    val collapsed: Set<String> = emptySet(),
    val filter: String = "",
)

/**
 * Pure projection from the nav feed + interaction state to the render-ready [LinearSidebarUiModel] — a 1:1
 * port of the web LinearSidebar's derivations (the active-path test, the non-flattening tree filter, the
 * force-expand-while-searching rule, the default "collapse all but the active section" expansion, the quiet
 * trailing badges, and the pinned/favorites handling), layered onto the shared cache-then-network lifecycle so
 * freshness is interpreted identically here and on every other native surface.
 */
object LinearSidebarProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /** Routes whose trailing badge logic the web source special-cases. */
    private const val ROUTE_ALERTS = "/notifications/alerts"
    private const val ROUTE_VEHICLES = "/vehicles"
    private const val ROUTE_DATA_REPAIR = "/data-repair"

    private val WHITESPACE = Regex("\\s+")
    private val EMPTY_NAV = LinearSidebarNav(sections = emptyList())

    /**
     * The web active-path test (`isActiveLinearPath`): the root is active only on an exact match; any other
     * route is active on an exact match OR when [pathname] is nested beneath it (`to` + `/`).
     */
    fun isActivePath(
        pathname: String,
        to: String,
    ): Boolean =
        if (to == "/") {
            pathname == "/"
        } else {
            pathname == to || pathname.startsWith("$to/")
        }

    /** Splits the filter needle into lowercase whitespace tokens (web `filterTokens`). */
    fun tokenize(filter: String): List<String> =
        filter
            .trim()
            .lowercase()
            .split(WHITESPACE)
            .filter { it.isNotEmpty() }

    /** Every token must substring-match the label (web `matchesFilter`); a blank filter matches everything. */
    fun matchesFilter(
        label: String,
        tokens: List<String>,
    ): Boolean {
        if (tokens.isEmpty()) return true
        val haystack = label.lowercase()
        return tokens.all { haystack.contains(it) }
    }

    /** The title of the first section containing the active page, or null (web `activeSectionTitle`). */
    fun activeSectionTitle(nav: LinearSidebarNav): String? =
        nav.sections.firstOrNull { section -> section.items.any { isActivePath(nav.activePath, it.to) } }?.title

    /**
     * The default collapsed set: every section EXCEPT the one containing the active page (web's initial
     * `collapsed` state), so the sidebar opens showing "where I am" rather than a full wall of rows.
     */
    fun defaultCollapsed(nav: LinearSidebarNav): Set<String> {
        val active = activeSectionTitle(nav)
        return nav.sections.mapNotNull { section -> section.title.takeIf { it != active } }.toSet()
    }

    /**
     * Folds the nav-feed [state] together with the [interaction] inputs into the render-ready model. The body
     * phase is taken from the shared [io.teslasync.android.data.toUiState] projection (so an error-with-cache
     * stays a visible Content surface flagged offline, never a blank error), the tree is filtered by the needle,
     * sections are force-expanded while searching, and the quiet trailing badges are derived per row.
     */
    fun project(
        state: UiState<LinearSidebarNav>,
        interaction: LinearSidebarInteraction,
    ): LinearSidebarUiModel {
        val nav = state.data ?: EMPTY_NAV
        val phase = phaseOf(state.phase)
        val tokens = tokenize(interaction.filter)
        val isSearching = tokens.isNotEmpty()
        val pinnedSet = nav.pinnedItems.mapTo(HashSet()) { it.to }

        val favorites =
            nav.pinnedItems
                .filter { matchesFilter(it.label, tokens) }
                .map { row(it, nav, pinned = true) }

        val sectionRows =
            nav.sections.mapNotNull { section ->
                val items = section.items.filter { matchesFilter(it.label, tokens) }
                if (items.isEmpty()) {
                    null
                } else {
                    val expanded = isSearching || section.title !in interaction.collapsed
                    LinearSectionRow(
                        title = section.title,
                        expanded = expanded,
                        itemCount = items.size,
                        rows = if (expanded) items.map { row(it, nav, pinned = it.to in pinnedSet) } else emptyList(),
                    )
                }
            }

        val display =
            LinearSidebarDisplay(
                phase = phase,
                favorites = favorites,
                hasFavorites = nav.pinnedItems.isNotEmpty(),
                sections = sectionRows,
                activeSectionTitle = activeSectionTitle(nav),
                isSearching = isSearching,
                noResults = isSearching && sectionRows.isEmpty(),
                stale = state.stale && state.errorKind == null,
                offline = state.stale && state.hasData && state.errorKind != null,
                refreshing = state.refreshing,
                errorKind = state.errorKind,
                httpStatus = state.httpStatus,
                canRetry = state.canRetry,
                freshnessStamp = state.fetchedAt,
            )
        return LinearSidebarUiModel(display = display, filterQuery = interaction.filter)
    }

    /** The quiet trailing marker for a route (web `trailingFor`): an alert dot, a count chip, or nothing. */
    fun trailingFor(
        to: String,
        nav: LinearSidebarNav,
    ): TrailingBadge? =
        when {
            to == ROUTE_ALERTS && nav.alertCount > 0 -> TrailingBadge.AlertDot
            to == ROUTE_VEHICLES && nav.vehicleCount > 0 -> TrailingBadge.Count(nav.vehicleCount, CountSemantic.Vehicles)
            to == ROUTE_DATA_REPAIR && nav.staleCount > 0 -> TrailingBadge.Count(nav.staleCount, CountSemantic.Stale)
            else -> null
        }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface shows
     * the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: LinearSidebarDisplay): QueryErrorKind =
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

    private fun row(
        item: LinearNavItem,
        nav: LinearSidebarNav,
        pinned: Boolean,
    ): LinearNavRow =
        LinearNavRow(
            to = item.to,
            label = item.label,
            icon = item.icon,
            active = isActivePath(nav.activePath, item.to),
            trailing = trailingFor(item.to, nav),
            dataTour = item.dataTour,
            pinned = pinned,
        )

    private fun phaseOf(phase: UiPhase): LinearSidebarPhase =
        when (phase) {
            UiPhase.Loading -> LinearSidebarPhase.Loading
            UiPhase.Empty -> LinearSidebarPhase.Empty
            UiPhase.Error -> LinearSidebarPhase.Error
            UiPhase.Content -> LinearSidebarPhase.Content
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [LinearSidebarRegistration.SLUG] — never a nav label, route or pinned id — so a diagnostics line can never
 * leak what the user navigated to or pinned.
 */
object LinearSidebarDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** The structured event name emitted when the nav feed is re-fetched after an error/stale chip. */
    const val REFRESH_EVENT: String = "linearSidebar.refresh"

    /** The single structured field every diagnostic carries — the surface slug, nothing else. */
    fun surfaceField(): Map<String, String> = mapOf(SURFACE_KEY to LinearSidebarRegistration.SLUG)

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) = logger.info(VIEW_OPENED, surfaceField())

    /** Emits the `linearSidebar.refresh` diagnostic when the nav feed is re-fetched (retry / stale refresh). */
    fun recordRefresh(logger: Logger) = logger.info(REFRESH_EVENT, surfaceField())
}
