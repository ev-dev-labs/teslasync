// The native Jetpack Compose + Material 3 Layout shared surface — a parity port of the web app shell
// web/src/components/layout/Layout.tsx. The web component is the application chrome: a collapsible
// sidebar (a "Current" card with a pin toggle, a "Pinned" list, an optional "Recently Used" list, and the
// grouped, collapsible nav sections with live count badges), a header, a content host with the routed
// page + a "Ctrl+K to jump" hint, a bottom tab bar, and a footer status bar. This native surface keeps
// that contract end to end and renders every state the prompt's matrix mandates without ever hiding the
// chrome: loading (skeleton content host), content (the routed slot), empty (no vehicles → a friendly
// empty state), a hard error with Retry, and the stale/offline freshness chips over last-known counts.
//
// It performs NO HTTP and binds the three live feeds only through the shared S8 seam ([LayoutSource])
// folded through [LayoutViewModel] + the pure [LayoutProjection]; the composable resolves the i18n
// labels (P1/S10) and design tokens (P1/S9) and draws what the projection returns, reusing the shared
// component library (ui GlassPanel/Button/IconButton/Badge/StatusPill/typography, feedback
// AlertBanner/EmptyState/QueryError/Skeleton, motion FadeIn) and the shared, already-localized route
// registry (navigation RouteTable/Destinations/navTitle/navIcon) — never a re-encoded nav tree. The
// one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Web hooks with no Android analogue are intentionally not ported: `useTitleBadge` / `useFaviconBadge` /
// `useDynamicAppIcon` (browser-tab/favicon badging) and `useCriticalAlertFlash` (document-title flash)
// have no surface on a native app and are handled by the OS notification channel instead.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Layout) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layout

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.navigation.NavGroup
import io.teslasync.android.navigation.NavSection
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.navigation.navGroupIcon
import io.teslasync.android.navigation.navGroupTitle
import io.teslasync.android.navigation.navIcon
import io.teslasync.android.navigation.navTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.notifications.Alert
import kotlin.time.Instant

/** Test tag on the surface root so on-device UI tests can locate the rendered shell in any state. */
const val LAYOUT_TEST_TAG: String = "layout"

/** Test tag on the sidebar region. */
const val LAYOUT_SIDEBAR_TEST_TAG: String = "layout-sidebar"

/** Test tag on the content host region. */
const val LAYOUT_CONTENT_TEST_TAG: String = "layout-content"

private val SIDEBAR_WIDTH: Dp = 288.dp
private val FLEET_SKELETON_HEIGHT: Dp = 18.dp
private val LOADING_BLOCK_HEIGHT: Dp = 120.dp

// The product wordmark. A brand mark is identity, not translatable copy (the web renders `<Logo>`), so it
// is a constant rather than a localized resource.
private const val BRAND: String = "TeslaSync"

private const val NOTIFICATIONS_INBOX_PATH = "/notifications/inbox"
private const val ALERTS_PATH = "/notifications/alerts"
private const val VEHICLES_PATH = "/vehicles"

/**
 * Stateful entry point — the parity port of the web `<Layout/>`. Binds the three shared feeds via
 * [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition, collects the
 * vehicle [UiState] (+ alerts + auth mode), auto-refreshes a stale fleet, and renders the chrome.
 *
 * @param viewModel the state holder bound to the shared S8 Vehicles/Notifications/AuthMode seam.
 * @param activeWebPath the current route (web `useLocation().pathname`); drives the active nav highlight.
 * @param onNavigate invoked with a destination web path when a nav target is chosen (web `useNavigate`).
 * @param content the routed page host rendered in the content area's content phase (web `<Outlet/>`).
 */
@Composable
fun Layout(
    viewModel: LayoutViewModel,
    modifier: Modifier = Modifier,
    activeWebPath: String = "/",
    onNavigate: (String) -> Unit = {},
    content: @Composable () -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberLayoutStrings()
    val vehicles by viewModel.state.collectAsStateWithLifecycle()
    val alerts by viewModel.alerts.collectAsStateWithLifecycle()
    val isForwardAuth by viewModel.isForwardAuth.collectAsStateWithLifecycle()

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires
    // at most once per distinct cached value, never in a loop.
    LaunchedEffect(vehicles.stale, vehicles.fetchedAt) {
        if (LayoutProjection.freshness(vehicles) == LayoutFreshness.Stale) viewModel.refresh()
    }

    LayoutChrome(
        vehicles = vehicles,
        alerts = alerts,
        isForwardAuth = isForwardAuth,
        activeWebPath = activeWebPath,
        strings = strings,
        modifier = modifier,
        onNavigate = onNavigate,
        onRetry = viewModel::retry,
        content = content,
    )
}

/**
 * Stateless app shell — renders every region the web source draws (sidebar, header, content host, bottom
 * tab bar) plus the bound vehicle feed's lifecycle in the content host. The sidebar/header/bottom bar
 * always render; only the content host switches surface by phase. Hoisted out of the ViewModel so it is
 * preview- and screenshot-testable for each state.
 */
@Composable
fun LayoutChrome(
    vehicles: UiState<List<Vehicle>>,
    alerts: UiState<List<Alert>>,
    isForwardAuth: Boolean,
    activeWebPath: String,
    strings: LayoutStrings,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    onRetry: () -> Unit = {},
    content: @Composable () -> Unit = {},
) {
    val sections = remember(isForwardAuth) { LayoutProjection.visibleSections(RouteTable.drawerSections, isForwardAuth) }
    val badges = remember(vehicles, alerts) { LayoutProjection.badges(vehicles, alerts) }
    val freshness = remember(vehicles) { LayoutProjection.freshness(vehicles) }
    val activeDestination = remember(sections, activeWebPath) { LayoutProjection.activeDestination(sections, activeWebPath) }
    val activeGroup = remember(sections, activeWebPath) { LayoutProjection.activeGroup(sections, activeWebPath) }
    val latestAlert = remember(alerts) { LayoutProjection.latestUnreadAlert(alerts) }

    var sidebarExpanded by remember { mutableStateOf(true) }
    var pinnedPaths by remember { mutableStateOf(LayoutProjection.defaultPinnedPaths()) }
    var recentPaths by remember { mutableStateOf(emptyList<String>()) }
    var expandedGroups by remember { mutableStateOf(emptySet<NavGroup>()) }

    // Auto-expand the active group + track recents — the web effects that add the active section to
    // `expandedSections` and prepend the active page to `recentNavPaths`.
    LaunchedEffect(activeGroup, activeDestination) {
        if (activeGroup != null) expandedGroups = expandedGroups + activeGroup
        val to = activeDestination?.webPath
        if (to != null && to != "/" && to !in pinnedPaths) recentPaths = LayoutProjection.trackRecent(recentPaths, to)
    }

    val pinnedDestinations =
        remember(sections, pinnedPaths, isForwardAuth) {
            LayoutProjection.pinnedDestinations(sections, pinnedPaths, isForwardAuth)
        }
    val recentDestinations =
        remember(sections, recentPaths, activeWebPath) {
            LayoutProjection.recentDestinations(sections, recentPaths, activeWebPath)
        }

    Row(modifier = modifier.fillMaxSize().testTag(LAYOUT_TEST_TAG)) {
        if (sidebarExpanded) {
            LayoutSidebar(
                sections = sections,
                pinnedDestinations = pinnedDestinations,
                recentDestinations = recentDestinations,
                pinnedPaths = pinnedPaths,
                expandedGroups = expandedGroups,
                activeDestination = activeDestination,
                activeGroup = activeGroup,
                activeWebPath = activeWebPath,
                badges = badges,
                vehicles = vehicles,
                freshness = freshness,
                strings = strings,
                modifier = Modifier.width(SIDEBAR_WIDTH).fillMaxHeight(),
                onNavigate = onNavigate,
                onClose = { sidebarExpanded = false },
                onToggleGroup = { group ->
                    expandedGroups =
                        if (group in expandedGroups && group != activeGroup) expandedGroups - group else expandedGroups + group
                },
                onExpandAll = { expandedGroups = sections.map { it.group }.toSet() },
                onCollapseAll = { expandedGroups = emptySet() },
                onTogglePin = { path -> pinnedPaths = LayoutProjection.togglePinned(pinnedPaths, path) },
            )
        }
        Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
            LayoutTopBar(
                sidebarExpanded = sidebarExpanded,
                badges = badges,
                freshness = freshness,
                strings = strings,
                onOpenSidebar = { sidebarExpanded = true },
                onNavigate = onNavigate,
            )
            LayoutContentHost(
                vehicles = vehicles,
                activeDestination = activeDestination,
                latestAlert = latestAlert,
                strings = strings,
                modifier = Modifier.weight(1f),
                onRetry = onRetry,
                onNavigate = onNavigate,
                content = content,
            )
            LayoutBottomBar(activeWebPath = activeWebPath, onNavigate = onNavigate)
        }
    }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun LayoutSidebar(
    sections: List<NavSection>,
    pinnedDestinations: List<Destination>,
    recentDestinations: List<Destination>,
    pinnedPaths: List<String>,
    expandedGroups: Set<NavGroup>,
    activeDestination: Destination?,
    activeGroup: NavGroup?,
    activeWebPath: String,
    badges: LayoutBadges,
    vehicles: UiState<List<Vehicle>>,
    freshness: LayoutFreshness,
    strings: LayoutStrings,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit,
    onClose: () -> Unit,
    onToggleGroup: (NavGroup) -> Unit,
    onExpandAll: () -> Unit,
    onCollapseAll: () -> Unit,
    onTogglePin: (String) -> Unit,
) {
    GlassPanel(
        modifier = modifier.testTag(LAYOUT_SIDEBAR_TEST_TAG).semantics { paneTitle = strings.primaryNav },
        padding = PanelPadding.Sm,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            // Brand header + theme/bell entries + close affordance (web sidebar header).
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Subhead(BRAND, modifier = Modifier.weight(1f))
                LayoutThemeControl(strings = strings)
                NotificationBell(badges = badges, strings = strings, onNavigate = onNavigate)
                IconButton(
                    imageVector = TeslaGlyphs.Close,
                    contentDescription = strings.closeSidebar,
                    onClick = onClose,
                    size = IconSize.Md,
                )
            }

            // Sticky search trigger (web CommandPaletteTrigger; the "Ctrl+K to jump" hint).
            Button(
                onClick = { onNavigate("/search") },
                modifier = Modifier.fillMaxWidth(),
                variant = ButtonVariant.Outline,
            ) {
                Icon(NavGlyphs.Search, contentDescription = null, size = IconSize.Md)
                Spacer(Modifier.width(Spacing.sm))
                BodyText(strings.quickSearchHint, modifier = Modifier.weight(1f))
            }

            SidebarFleetStatus(vehicles = vehicles, badges = badges, freshness = freshness, strings = strings)

            if (activeDestination != null) {
                SidebarCurrentCard(
                    destination = activeDestination,
                    isPinned = activeDestination.webPath in pinnedPaths,
                    strings = strings,
                    onTogglePin = { onTogglePin(activeDestination.webPath) },
                )
            }

            if (pinnedDestinations.isNotEmpty()) {
                SidebarPinnedList(
                    destinations = pinnedDestinations,
                    activeWebPath = activeWebPath,
                    badges = badges,
                    strings = strings,
                    onNavigate = onNavigate,
                    onUnpin = onTogglePin,
                )
            }

            if (recentDestinations.isNotEmpty()) {
                Caption(strings.recentlyUsed)
                recentDestinations.forEach { destination ->
                    SidebarNavRow(
                        destination = destination,
                        active = LayoutProjection.isActive(activeWebPath, destination.webPath),
                        badges = badges,
                        onClick = onNavigate,
                    )
                }
            }

            SidebarSections(
                sections = sections,
                expandedGroups = expandedGroups,
                activeGroup = activeGroup,
                activeWebPath = activeWebPath,
                badges = badges,
                strings = strings,
                onNavigate = onNavigate,
                onToggleGroup = onToggleGroup,
                onExpandAll = onExpandAll,
                onCollapseAll = onCollapseAll,
            )
        }
    }
}

@Composable
private fun SidebarFleetStatus(
    vehicles: UiState<List<Vehicle>>,
    badges: LayoutBadges,
    freshness: LayoutFreshness,
    strings: LayoutStrings,
) {
    if (vehicles.isLoading) {
        Column(
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Skeleton(widthFraction = 0.6f, height = FLEET_SKELETON_HEIGHT)
            Skeleton(widthFraction = 0.4f, height = FLEET_SKELETON_HEIGHT)
        }
        return
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(NavGlyphs.Car, contentDescription = null, size = IconSize.Sm)
        BodyText(badges.vehicleBadgeText)
        Icon(NavGlyphs.Bell, contentDescription = null, size = IconSize.Sm)
        BodyText(badges.alertBadgeText)
        Spacer(Modifier.weight(1f))
        FreshnessChip(freshness = freshness, strings = strings)
    }
}

@Composable
private fun SidebarCurrentCard(
    destination: Destination,
    isPinned: Boolean,
    strings: LayoutStrings,
    onTogglePin: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Sm, modifier = Modifier.fillMaxWidth()) {
        Caption(strings.current)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            BodyText(navTitle(destination), modifier = Modifier.weight(1f), maxLines = 1)
            Button(
                onClick = onTogglePin,
                variant = ButtonVariant.Ghost,
                modifier = Modifier.semantics { contentDescription = if (isPinned) strings.unpinCurrent else strings.pinCurrent },
            ) {
                Icon(TeslaGlyphs.Pin, contentDescription = null, size = IconSize.Sm)
                Spacer(Modifier.width(Spacing.xs))
                BodyText(if (isPinned) strings.pinnedAction else strings.pinAction)
            }
        }
    }
}

@Composable
private fun SidebarPinnedList(
    destinations: List<Destination>,
    activeWebPath: String,
    badges: LayoutBadges,
    strings: LayoutStrings,
    onNavigate: (String) -> Unit,
    onUnpin: (String) -> Unit,
) {
    Caption(strings.pinned)
    destinations.forEach { destination ->
        val title = navTitle(destination)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                SidebarNavRow(
                    destination = destination,
                    active = LayoutProjection.isActive(activeWebPath, destination.webPath),
                    badges = badges,
                    onClick = onNavigate,
                )
            }
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = strings.unpinPage(title),
                onClick = { onUnpin(destination.webPath) },
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun SidebarSections(
    sections: List<NavSection>,
    expandedGroups: Set<NavGroup>,
    activeGroup: NavGroup?,
    activeWebPath: String,
    badges: LayoutBadges,
    strings: LayoutStrings,
    onNavigate: (String) -> Unit,
    onToggleGroup: (NavGroup) -> Unit,
    onExpandAll: () -> Unit,
    onCollapseAll: () -> Unit,
) {
    val allExpanded = sections.isNotEmpty() && sections.all { it.group in expandedGroups }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(strings.sections, modifier = Modifier.weight(1f))
        IconButton(
            imageVector = TeslaGlyphs.Plus,
            contentDescription = strings.expandAll,
            onClick = onExpandAll,
            enabled = !allExpanded,
            size = IconSize.Sm,
        )
        IconButton(
            imageVector = TeslaGlyphs.Minus,
            contentDescription = strings.collapseAll,
            onClick = onCollapseAll,
            enabled = expandedGroups.isNotEmpty(),
            size = IconSize.Sm,
        )
    }
    sections.forEach { section ->
        val expanded = section.group in expandedGroups
        Button(
            onClick = { onToggleGroup(section.group) },
            modifier = Modifier.fillMaxWidth(),
            variant = if (section.group == activeGroup) ButtonVariant.Secondary else ButtonVariant.Ghost,
        ) {
            Icon(navGroupIcon(section.group), contentDescription = null, size = IconSize.Md)
            Spacer(Modifier.width(Spacing.sm))
            Subhead(navGroupTitle(section.group), modifier = Modifier.weight(1f))
            Badge(section.items.size.toString(), variant = BadgeVariant.Neutral)
            Spacer(Modifier.width(Spacing.xs))
            Icon(
                imageVector = if (expanded) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
            )
        }
        if (expanded) {
            section.items.forEach { destination ->
                SidebarNavRow(
                    destination = destination,
                    active = LayoutProjection.isActive(activeWebPath, destination.webPath),
                    badges = badges,
                    onClick = onNavigate,
                )
            }
        }
    }
}

@Composable
private fun SidebarNavRow(
    destination: Destination,
    active: Boolean,
    badges: LayoutBadges,
    onClick: (String) -> Unit,
) {
    val badge = navRowBadge(destination, badges)
    Button(
        onClick = { onClick(destination.webPath) },
        modifier = Modifier.fillMaxWidth(),
        variant = if (active) ButtonVariant.Secondary else ButtonVariant.Ghost,
    ) {
        Icon(navIcon(destination), contentDescription = null, size = IconSize.Md)
        Spacer(Modifier.width(Spacing.sm))
        BodyText(navTitle(destination), modifier = Modifier.weight(1f), maxLines = 1)
        if (badge != null) Badge(badge.first, variant = badge.second)
    }
}

// ── Header ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun LayoutTopBar(
    sidebarExpanded: Boolean,
    badges: LayoutBadges,
    freshness: LayoutFreshness,
    strings: LayoutStrings,
    onOpenSidebar: () -> Unit,
    onNavigate: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md).semantics { paneTitle = strings.primaryHeader },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!sidebarExpanded) {
            IconButton(
                imageVector = NavGlyphs.Menu,
                contentDescription = strings.openSidebar,
                onClick = onOpenSidebar,
                size = IconSize.Lg,
            )
        }
        Subhead(BRAND)
        Spacer(Modifier.weight(1f))
        FreshnessChip(freshness = freshness, strings = strings)
        NotificationBell(badges = badges, strings = strings, onNavigate = onNavigate)
        LayoutThemeControl(strings = strings)
    }
}

@Composable
private fun FreshnessChip(
    freshness: LayoutFreshness,
    strings: LayoutStrings,
) {
    when (freshness) {
        LayoutFreshness.Live -> Unit
        LayoutFreshness.Stale ->
            StatusPill(
                text = strings.stale,
                tone = StatusTone.Warning,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        LayoutFreshness.Offline ->
            StatusPill(
                text = strings.offline,
                tone = StatusTone.Danger,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
    }
}

@Composable
private fun NotificationBell(
    badges: LayoutBadges,
    strings: LayoutStrings,
    onNavigate: (String) -> Unit,
) {
    Box {
        IconButton(
            imageVector = NavGlyphs.Bell,
            contentDescription = strings.notifications,
            onClick = { onNavigate(NOTIFICATIONS_INBOX_PATH) },
            size = IconSize.Lg,
        )
        if (badges.hasUnreadAlerts) {
            Badge(
                text = badges.alertBadgeText,
                variant = BadgeVariant.Danger,
                modifier = Modifier.align(Alignment.TopEnd),
            )
        }
    }
}

@Composable
private fun LayoutThemeControl(strings: LayoutStrings) {
    var open by remember { mutableStateOf(false) }
    Column(horizontalAlignment = Alignment.End) {
        IconButton(
            imageVector = NavGlyphs.Sliders,
            contentDescription = strings.openThemePicker,
            onClick = { open = !open },
            size = IconSize.Lg,
        )
        if (open) {
            Button(
                label = strings.customize,
                onClick = { open = false },
                variant = ButtonVariant.Ghost,
            )
        }
    }
}

// ── Content host ──────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun LayoutContentHost(
    vehicles: UiState<List<Vehicle>>,
    activeDestination: Destination?,
    latestAlert: Alert?,
    strings: LayoutStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit,
    onNavigate: (String) -> Unit,
    content: @Composable () -> Unit,
) {
    val vehiclesResource = navTitle(Destinations.require("vehicles"))
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .testTag(LAYOUT_CONTENT_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (activeDestination != null) {
                SectionTitle(navTitle(activeDestination), modifier = Modifier.weight(1f))
            } else {
                Spacer(Modifier.weight(1f))
            }
            Caption(strings.quickSearchHint)
        }

        if (latestAlert != null) {
            AlertBanner(
                message = latestAlert.message.ifBlank { latestAlert.title.ifBlank { strings.alertTitle } },
                title = latestAlert.title.ifBlank { strings.alertTitle },
                tone = LayoutProjection.alertTone(latestAlert.severity),
                action = BannerAction(label = strings.viewAction, onClick = { onNavigate(ALERTS_PATH) }),
            )
        }

        FadeIn(modifier = Modifier.fillMaxWidth()) {
            when (vehicles.phase) {
                UiPhase.Loading -> FleetLoading(strings = strings)
                UiPhase.Error ->
                    QueryError(
                        kind = LayoutProjection.queryErrorKind(vehicles),
                        resourceName = vehiclesResource,
                        onRetry = onRetry,
                    )
                UiPhase.Empty ->
                    EmptyState(
                        message = strings.noVehiclesMessage,
                        title = strings.noVehiclesTitle,
                        icon = NavGlyphs.Car,
                    )
                UiPhase.Content -> content()
            }
        }
    }
}

@Composable
private fun FleetLoading(strings: LayoutStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = 0.4f, height = FLEET_SKELETON_HEIGHT)
        Skeleton(height = LOADING_BLOCK_HEIGHT)
        Skeleton(height = LOADING_BLOCK_HEIGHT)
    }
}

// ── Bottom tab bar ────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun LayoutBottomBar(
    activeWebPath: String,
    onNavigate: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceAround,
    ) {
        RouteTable.bottomBar.forEach { destination ->
            val active = LayoutProjection.isActive(activeWebPath, destination.webPath)
            IconButton(
                imageVector = navIcon(destination),
                contentDescription = navTitle(destination),
                onClick = { onNavigate(destination.webPath) },
                tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Strings + badge helpers ───────────────────────────────────────────────────────────────────────────

/** Builds the localized chrome labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberLayoutStrings(): LayoutStrings =
    LayoutStrings(
        primaryNav = stringResource(R.string.translation_a11y_primaryNav),
        primaryHeader = stringResource(R.string.translation_a11y_primaryHeader),
        openSidebar = stringResource(R.string.translation_nav_openSidebar),
        closeSidebar = stringResource(R.string.translation_nav_closeSidebar),
        current = stringResource(R.string.translation_nav_currentSection),
        pinned = stringResource(R.string.translation_nav_pinned),
        pinAction = stringResource(R.string.translation_nav_pinAction),
        pinnedAction = stringResource(R.string.translation_nav_pinnedAction),
        pinCurrent = stringResource(R.string.translation_nav_pinCurrent),
        unpinCurrent = stringResource(R.string.translation_nav_unpinCurrent),
        unpinPageTemplate = stringResource(R.string.translation_nav_unpinPage),
        recentlyUsed = stringResource(R.string.translation_nav_recentlyUsed),
        sections = stringResource(R.string.translation_nav_sections),
        expandAll = stringResource(R.string.translation_nav_expandAll),
        collapseAll = stringResource(R.string.translation_nav_collapseAll),
        quickSearchHint = stringResource(R.string.translation_nav_quickSearchHint),
        openThemePicker = stringResource(R.string.translation_theme_openPicker),
        customize = stringResource(R.string.translation_theme_customize),
        alertTitle = stringResource(R.string.translation_alerts_toast_title),
        viewAction = stringResource(R.string.translation_alerts_toast_view),
        notifications = navGroupTitle(NavGroup.Notifications),
        loading = stringResource(R.string.translation_common_loading),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
        noVehiclesTitle = stringResource(R.string.translation_commands_noVehicles),
        noVehiclesMessage = stringResource(R.string.translation_common_noVehicleSelected_desc),
    )

/** Resolves the colored count badge a sidebar row shows (web alert/vehicle badges), or null when none. */
private fun navRowBadge(
    destination: Destination,
    badges: LayoutBadges,
): Pair<String, BadgeVariant>? =
    when {
        destination.webPath == ALERTS_PATH && badges.hasUnreadAlerts -> badges.alertBadgeText to BadgeVariant.Danger
        destination.webPath == VEHICLES_PATH && badges.hasVehicles -> badges.vehicleBadgeText to BadgeVariant.Info
        else -> null
    }

// ── Previews — one per rendered state (loading / content / empty / error / stale / offline). ───────────

private fun previewStrings(): LayoutStrings =
    LayoutStrings(
        primaryNav = "Primary",
        primaryHeader = "Site header",
        openSidebar = "Open sidebar",
        closeSidebar = "Close sidebar",
        current = "Current",
        pinned = "Pinned",
        pinAction = "Pin",
        pinnedAction = "Pinned",
        pinCurrent = "Pin current page",
        unpinCurrent = "Remove current page from pinned",
        unpinPageTemplate = "Unpin %1\$s",
        recentlyUsed = "Recently Used",
        sections = "Sections",
        expandAll = "Expand all sections",
        collapseAll = "Collapse all sections",
        quickSearchHint = "Ctrl+K to jump",
        openThemePicker = "Open theme picker",
        customize = "Customize",
        alertTitle = "Alert",
        viewAction = "View",
        notifications = "Notifications",
        loading = "Loading",
        stale = "Stale",
        offline = "Offline",
        noVehiclesTitle = "No vehicles found",
        noVehiclesMessage = "Add a vehicle to your fleet to see data on this page.",
    )

private fun sampleVehicle(): Vehicle =
    Vehicle(
        createdAt = Instant.fromEpochSeconds(0),
        displayName = "Garage Car",
        enrolledAt = Instant.fromEpochSeconds(0),
        id = 1,
        teslaId = 1,
        timezone = "UTC",
        updatedAt = Instant.fromEpochSeconds(0),
        vin = "VIN1",
        model = "Model 3",
    )

private fun sampleAlert(): Alert =
    Alert(
        id = 1,
        severity = "warning",
        title = "Tire pressure low",
        message = "Front-left tire is below the recommended pressure.",
        isRead = false,
    )

private fun fleetContent(): UiState<List<Vehicle>> = UiState(UiPhase.Content, data = listOf(sampleVehicle()), fetchedAt = PREVIEW_STAMP)

private fun alertFeed(): UiState<List<Alert>> = UiState(UiPhase.Content, data = listOf(sampleAlert()), fetchedAt = PREVIEW_STAMP)

@Composable
private fun PreviewShell(
    vehicles: UiState<List<Vehicle>>,
    alerts: UiState<List<Alert>>,
) {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutChrome(
            vehicles = vehicles,
            alerts = alerts,
            isForwardAuth = true,
            activeWebPath = "/charging",
            strings = previewStrings(),
            content = { BodyText("Charging overview") },
        )
    }
}

@Preview(name = "Layout · loading", showBackground = true, widthDp = 760, heightDp = 640)
@Composable
private fun LayoutLoadingPreview() = PreviewShell(vehicles = UiState.loading(), alerts = UiState.loading())

@Preview(name = "Layout · content", showBackground = true, widthDp = 760, heightDp = 640)
@Composable
private fun LayoutContentPreview() = PreviewShell(vehicles = fleetContent(), alerts = alertFeed())

@Preview(name = "Layout · empty", showBackground = true, widthDp = 760, heightDp = 640)
@Composable
private fun LayoutEmptyPreview() =
    PreviewShell(
        vehicles = UiState(UiPhase.Empty, data = emptyList(), fetchedAt = PREVIEW_STAMP),
        alerts = UiState(UiPhase.Empty, data = emptyList(), fetchedAt = PREVIEW_STAMP),
    )

@Preview(name = "Layout · error", showBackground = true, widthDp = 760, heightDp = 640)
@Composable
private fun LayoutErrorPreview() =
    PreviewShell(
        vehicles = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = PREVIEW_SERVER_ERROR),
        alerts = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = PREVIEW_SERVER_ERROR),
    )

@Preview(name = "Layout · stale", showBackground = true, widthDp = 760, heightDp = 640)
@Composable
private fun LayoutStalePreview() =
    PreviewShell(
        vehicles = UiState(UiPhase.Content, data = listOf(sampleVehicle()), fetchedAt = PREVIEW_STAMP, stale = true, refreshing = true),
        alerts = alertFeed(),
    )

@Preview(name = "Layout · offline", showBackground = true, widthDp = 760, heightDp = 640)
@Composable
private fun LayoutOfflinePreview() =
    PreviewShell(
        vehicles =
            UiState(
                UiPhase.Content,
                data = listOf(sampleVehicle()),
                fetchedAt = PREVIEW_STAMP,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        alerts = alertFeed(),
    )

private const val PREVIEW_STAMP = 1_700_000_000_000L
private const val PREVIEW_SERVER_ERROR = 503
