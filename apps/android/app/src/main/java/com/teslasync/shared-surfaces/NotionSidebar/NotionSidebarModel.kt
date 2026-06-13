// Pure, framework-free model + projection + diagnostics for the NotionSidebar shared surface — the native
// analogue of everything the web component derives before it returns its <nav> tree
// (web/src/components/layout/sidebar/NotionSidebar.tsx). No Compose layout, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. (The data classes carry the Compose value types ImageVector/Color as opaque presentation
// pass-throughs — the native mirror of the web item's `icon` component + `color` class — but the projection
// performs NO framework calls and is exercised entirely on the JVM, as the sibling chart/map model tests are.)
//
// What the web source actually is (and therefore the COMPLETE branch set this surface reproduces): a
// Notion-style navigation tree driven by props (the parent Layout owns `sections`, `pinnedItems`, the pin/unpin
// + select callbacks and the alert/vehicle/stale counts) plus two hooks — `useTranslation` (labels) and
// `useLocation` (the current path it highlights). It derives, per render:
//   • the active row, per item, as `isActiveNotionPath(pathname, to)` — the root `/` matches ONLY exactly,
//     every other route matches its own path or any descendant (`startsWith(to + '/')`). Reproduced verbatim by
//     [NotionSidebarProjection.isActivePath] (shared with the sibling BottomTabBar's identical rule).
//   • the inline tree filter — the needle is tokenized (`trim().toLowerCase().split(/\s+/)`) and a label
//     matches when it contains EVERY token. Reproduced by [filterTokens] + [matches].
//   • the Favorites group — shown whenever there is >=1 pin (web `pinnedItems.length > 0`, unfiltered), its
//     rows filtered by the needle; each favorite row's affordance is always "unpin".
//   • the Pages group — each section's items filtered by the needle, empty sections dropped
//     (`expandedSections`); a section is expanded when NOT collapsed, and force-expanded while searching;
//     its glyph is borrowed from its first (filtered) item; each row's affordance is pin-or-unpin by whether
//     the item is currently pinned.
//   • the trailing badges — an alert dot on `/notifications/alerts`, a vehicle-count chip on `/vehicles`, a
//     stale-rows chip on `/data-repair`, each only when its count is > 0. Reproduced by [trailingFor].
//   • the "No matches." empty branch — shown when a needle is active and every Pages section was eliminated
//     (web `filterTokens.length > 0 && expandedSections.length === 0`), with its "Clear filter" action.
//   • the initial collapsed set — every section except the active one (web `useState` initializer).
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent here: this
// surface fetches nothing. It is navigation chrome bound to the router state-holder (the `useLocation`
// analogue, P1/S8) whose only live input is the already-resolved current path — always present, never a
// network lifecycle — plus host-owned props. Modelling loading/error/stale/offline would invent behaviour the
// web spec does not have (honesty covenant: no scope narrowing, no silent drift), exactly as the sibling
// router-driven BottomTabBar / RouteAnnouncer surfaces document. The surface's REAL, fully-reproduced state
// set is the branches listed above — each reduced here and asserted in the off-device projection test, and
// rendered (never hidden) by the composable through [NotionSidebarContent].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/NotionSidebar — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.notionsidebar

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.navigation.RouteTable
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug is pinned here so the native and web surfaces stay in lockstep.
 */
object NotionSidebarRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NotionSidebar"
}

/**
 * One navigable entry in the tree — the native port of the web `item` (`{ to, label, icon, color, dataTour }`).
 * The [label] is already localized by the host (web `navLabel(item.label)`); [icon] / [iconColor] are the
 * presentation glyph + optional accent the host supplies, mirroring the web item's `icon` component + `color`.
 *
 * @property to the route path this entry links to (web `item.to`); also the pin/unpin + active-match key.
 * @property label the already-localized display label (web `navLabel(item.label)`).
 * @property icon the entry glyph (web `item.icon`).
 * @property iconColor the optional accent applied to the glyph when the row is inactive (web `item.color`).
 * @property dataTour the optional product-tour anchor id (web `item.dataTour`).
 */
data class NotionNavItem(
    val to: String,
    val label: String,
    val icon: ImageVector,
    val iconColor: Color? = null,
    val dataTour: String? = null,
)

/**
 * One collapsible group of entries — the native port of the web `LinearSidebarSectionInput` (`{ title, items }`).
 * The [title] is already localized by the host and is the stable key the collapsed-set and active-section logic
 * use.
 */
data class NotionSidebarSection(
    val title: String,
    val items: List<NotionNavItem>,
)

/**
 * The host-owned inputs the surface folds — the native mirror of the web `NotionSidebarProps` the parent Layout
 * passes down. The view performs no networking; it renders exactly what the host provides plus the live route.
 *
 * @property sections the Pages groups, in order (web `sections`).
 * @property pinnedItems the Favorites entries, in order (web `pinnedItems`).
 * @property activeSectionTitle the section to auto-expand on first open (web `activeSectionTitle`).
 * @property alertCount unacknowledged alerts; drives the dot on `/notifications/alerts` (web `alertCount`).
 * @property vehicleCount fleet size; drives the chip on `/vehicles` (web `vehicleCount`).
 * @property staleCount stale rows; drives the chip on `/data-repair` (web `staleCount`).
 */
data class NotionSidebarInput(
    val sections: List<NotionSidebarSection>,
    val pinnedItems: List<NotionNavItem>,
    val activeSectionTitle: String? = null,
    val alertCount: Int = 0,
    val vehicleCount: Int = 0,
    val staleCount: Int = 0,
)

/**
 * The localized chrome labels the surface folds into its output, built from `stringResource` at the render
 * boundary (tests pass a deterministic instance) so [NotionSidebarProjection] stays a pure, locale-stable
 * function. Each string resolves through the web component's exact i18n keys in the P1/S10 catalog: [navLabel]
 * from `nav.sidebar`, [favorites] from `nav.favorites`, [pages] from `nav.pages`, [filterNoMatch] from
 * `nav.filterNoMatch`, [filterClear] from `nav.filterClear`. (The per-row pin/unpin + count-chip strings are
 * parameterized by the row's label / count and are resolved at the row boundary by the composable, exactly as
 * the sibling TreeSelect resolves its per-row strings.)
 */
data class NotionSidebarStrings(
    val navLabel: String,
    val favorites: String,
    val pages: String,
    val filterNoMatch: String,
    val filterClear: String,
)

/** Which count a [NotionTrailingBadge.Count] represents, so the composable can resolve the right aria label. */
enum class NotionCountKind { Vehicles, Stale }

/**
 * The optional trailing adornment a row carries — the native mirror of the web `trailingFor(to)`: either a
 * notification [Dot] (web `<NotificationDot />`) or a [Count] chip (web `<CountChip />`).
 */
sealed interface NotionTrailingBadge {
    /** A small status dot (web `NotificationDot`), e.g. unacknowledged alerts on `/notifications/alerts`. */
    data object Dot : NotionTrailingBadge

    /**
     * A numeric chip (web `CountChip`) capped at `99+`, e.g. the fleet size on `/vehicles` or stale rows on
     * `/data-repair`. [kind] tells the composable which localized aria label to attach.
     */
    data class Count(
        val value: Int,
        val kind: NotionCountKind,
    ) : NotionTrailingBadge {
        /** The chip's visible text — the web `value > 99 ? '99+' : value` rule. */
        val displayText: String get() = if (value > MAX_BADGE_VALUE) "$MAX_BADGE_VALUE+" else value.toString()

        private companion object {
            const val MAX_BADGE_VALUE = 99
        }
    }
}

/**
 * One render-ready row — an entry enriched with the flags the web row derives: whether it is [active] for the
 * current route, whether it is currently [pinned] (so the composable shows pin vs unpin), and its [trailing]
 * badge. Pure data so the projection is unit-tested without a UI host.
 */
data class NotionRowDisplay(
    val to: String,
    val label: String,
    val icon: ImageVector,
    val iconColor: Color?,
    val active: Boolean,
    val pinned: Boolean,
    val trailing: NotionTrailingBadge?,
    val dataTour: String?,
)

/**
 * One render-ready section — the filtered group enriched with everything the web section row derives: its
 * borrowed [icon] / [iconColor] glyph (first filtered item), whether it is [expanded] (force-true while
 * searching), its filtered [count] (web `section.items.length`), and the projected [items] (empty while
 * collapsed, mirroring the web DOM).
 */
data class NotionSectionDisplay(
    val title: String,
    val icon: ImageVector,
    val iconColor: Color?,
    val expanded: Boolean,
    val count: Int,
    val items: List<NotionRowDisplay>,
)

/**
 * The immutable, render-ready projection the composable draws — everything the web component computes before
 * mapping it to its <nav> tree.
 *
 * @property navLabel the landmark label (web `aria-label={t('nav.sidebar')}`).
 * @property favoritesLabel the Favorites group label (web `t('nav.favorites')`).
 * @property pagesLabel the Pages group label (web `t('nav.pages')`).
 * @property showFavorites whether the Favorites group renders (web `pinnedItems.length > 0`, unfiltered).
 * @property favorites the filtered Favorites rows (each always pin-state `true` -> unpin affordance).
 * @property sections the filtered, non-empty Pages sections with their expanded flags + rows.
 * @property showNoResults whether the "No matches." empty branch renders (web `showNoResults`).
 * @property filterNoMatchLabel the empty-branch message (web `t('nav.filterNoMatch')`).
 * @property filterClearLabel the empty-branch clear action (web `t('nav.filterClear')`).
 */
data class NotionSidebarDisplay(
    val navLabel: String,
    val favoritesLabel: String,
    val pagesLabel: String,
    val showFavorites: Boolean,
    val favorites: List<NotionRowDisplay>,
    val sections: List<NotionSectionDisplay>,
    val showNoResults: Boolean,
    val filterNoMatchLabel: String,
    val filterClearLabel: String,
) {
    /** The single active row across Favorites + every section, or `null` when the route is outside the tree. */
    val activeRow: NotionRowDisplay?
        get() = favorites.firstOrNull { it.active } ?: sections.flatMap { it.items }.firstOrNull { it.active }
}

/**
 * Pure tree logic + projection for the NotionSidebar surface — the native port of every derivation the web
 * component performs. Framework-free so the whole contract is covered by the JVM unit gate without a Compose
 * host.
 */
object NotionSidebarProjection {
    /** The root path the dashboard entry matches only exactly (web `to === '/'`). */
    const val ROOT_PATH: String = "/"

    /** The route whose alert count surfaces a notification dot (web `to === '/notifications/alerts'`). */
    const val ALERTS_PATH: String = "/notifications/alerts"

    /** The route whose vehicle count surfaces a chip (web `to === '/vehicles'`). */
    const val VEHICLES_PATH: String = "/vehicles"

    /** The route whose stale-row count surfaces a chip (web `to === '/data-repair'`). */
    const val DATA_REPAIR_PATH: String = "/data-repair"

    private val WHITESPACE = Regex("\\s+")

    /**
     * Whether [to] is active for [currentPath] — a verbatim port of the web `isActiveNotionPath`: the root tab
     * (`/`) matches ONLY an exact root path; every other entry matches its own path exactly OR any descendant
     * of it (`startsWith(to + '/')`). The trailing slash is deliberate — it keeps a sibling section from
     * lighting the entry (`/charging-curve` does not activate `/charging`, while `/charging/123` does).
     * [currentPath] is normalized first so a stray trailing slash or query string can never flip the result.
     */
    fun isActivePath(
        currentPath: String,
        to: String,
    ): Boolean {
        val path = RouteTable.normalize(currentPath)
        return if (to == ROOT_PATH) {
            path == ROOT_PATH
        } else {
            path == to || path.startsWith("$to/")
        }
    }

    /** Tokenizes a filter needle (web `filter.trim().toLowerCase().split(/\s+/).filter(Boolean)`). */
    fun filterTokens(filter: String): List<String> =
        filter
            .trim()
            .lowercase()
            .split(WHITESPACE)
            .filter { it.isNotEmpty() }

    /** Whether [label] matches every token (web `matchesFilter`: empty needle matches all, else AND-contains). */
    fun matches(
        label: String,
        tokens: List<String>,
    ): Boolean {
        if (tokens.isEmpty()) return true
        val haystack = label.lowercase()
        return tokens.all { haystack.contains(it) }
    }

    /**
     * The trailing badge for [to], a verbatim port of the web `trailingFor(to)`: a dot when [alertCount] > 0 on
     * the alerts route, a vehicle chip when [vehicleCount] > 0 on the vehicles route, a stale chip when
     * [staleCount] > 0 on the data-repair route, otherwise none.
     */
    fun trailingFor(
        to: String,
        alertCount: Int,
        vehicleCount: Int,
        staleCount: Int,
    ): NotionTrailingBadge? =
        when {
            to == ALERTS_PATH && alertCount > 0 -> NotionTrailingBadge.Dot
            to == VEHICLES_PATH && vehicleCount > 0 -> NotionTrailingBadge.Count(vehicleCount, NotionCountKind.Vehicles)
            to == DATA_REPAIR_PATH && staleCount > 0 -> NotionTrailingBadge.Count(staleCount, NotionCountKind.Stale)
            else -> null
        }

    /** The section titles collapsed on first open — every section except the active one (web `useState` init). */
    fun initialCollapsed(input: NotionSidebarInput): Set<String> =
        input.sections
            .map { it.title }
            .filterNot { it == input.activeSectionTitle }
            .toSet()

    /**
     * Folds the host [input], the live [currentPath] (the `useLocation().pathname` analogue), the inline
     * [filter] needle, the [collapsed] section set and the localized [strings] into the render-ready
     * [NotionSidebarDisplay] — the native equivalent of the web component's render body.
     */
    fun project(
        input: NotionSidebarInput,
        currentPath: String,
        filter: String,
        collapsed: Set<String>,
        strings: NotionSidebarStrings,
    ): NotionSidebarDisplay {
        val normalized = RouteTable.normalize(currentPath)
        val tokens = filterTokens(filter)
        val searching = tokens.isNotEmpty()
        val pinnedSet = input.pinnedItems.map { it.to }.toSet()

        val favorites =
            input.pinnedItems
                .filter { matches(it.label, tokens) }
                .map { row(it, normalized, pinned = true, input = input) }

        val expandedSections =
            input.sections
                .map { section -> section to section.items.filter { matches(it.label, tokens) } }
                .filter { (_, items) -> items.isNotEmpty() }

        val sections =
            expandedSections.map { (section, items) ->
                val expanded = if (searching) true else section.title !in collapsed
                val glyph = items.first()
                NotionSectionDisplay(
                    title = section.title,
                    icon = glyph.icon,
                    iconColor = glyph.iconColor,
                    expanded = expanded,
                    count = items.size,
                    items =
                        if (expanded) {
                            items.map { row(it, normalized, pinned = it.to in pinnedSet, input = input) }
                        } else {
                            emptyList()
                        },
                )
            }

        return NotionSidebarDisplay(
            navLabel = strings.navLabel,
            favoritesLabel = strings.favorites,
            pagesLabel = strings.pages,
            showFavorites = input.pinnedItems.isNotEmpty(),
            favorites = favorites,
            sections = sections,
            showNoResults = searching && expandedSections.isEmpty(),
            filterNoMatchLabel = strings.filterNoMatch,
            filterClearLabel = strings.filterClear,
        )
    }

    private fun row(
        item: NotionNavItem,
        currentPath: String,
        pinned: Boolean,
        input: NotionSidebarInput,
    ): NotionRowDisplay =
        NotionRowDisplay(
            to = item.to,
            label = item.label,
            icon = item.icon,
            iconColor = item.iconColor,
            active = isActivePath(currentPath, item.to),
            pinned = pinned,
            trailing = trailingFor(item.to, input.alertCount, input.vehicleCount, input.staleCount),
            dataTour = item.dataTour,
        )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the route
 * path nor the active entry — so a diagnostics line can never leak which screen a user is on.
 */
object NotionSidebarDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = NotionSidebarRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
