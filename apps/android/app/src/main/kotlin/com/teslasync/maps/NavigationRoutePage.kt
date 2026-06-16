// The native Jetpack Compose + Material 3 NavigationRoutePage maps surface — a parity port of
// web/src/features/maps/pages/NavigationRoutePage.tsx, the live location-tracking + navigation-status dashboard. It
// reproduces the page's thirteen panels (the navigation-status panel, the location-status cards, the five route-metric
// cards — Distance / ETA / Traffic-Delay / Avg-Speed / Energy-at-Arrival — the speed-profile chart, the route-waypoints
// table, the route-traffic-delay panel, the recent-destinations table, the home/work-presence chart and the
// location-history table), both charts (the speed-profile AreaChart + the presence LineChart), every data state
// (loading skeleton / empty / error-retry / content, plus the cache-then-network stale/offline tier the bound state
// holders carry), and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [NavigationRoutePage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the latest-snapshot feed + the history feed + the
// charging-telemetry feed + the live display preferences); [NavigationRoutePageContent] is the stateless render layer.
// The latest snapshot powers the status panel + the location-status cards + the route-metric cards; the history feed is
// folded by the framework-free model (speedProfile / presenceSeries / recentDestinations / historyRows) into the two
// charts + the two history tables — exactly as the web page threads its loaded data through the useMemo chain. SI values
// are converted to the user's units only here at the display boundary via the model's [NavDisplayPrefs] helpers
// (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList`/`CyclomaticComplexMethod` for
// the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
    "CyclomaticComplexMethod",
)

package io.teslasync.android.maps.navigationroute

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The speed-profile + presence chart heights (web `ChartContainer height={260|300}`). */
private val SPEED_CHART_HEIGHT = 260.dp
private val PRESENCE_CHART_HEIGHT = 300.dp

/** The coordinate display precision for the current-location card (web `fmtNumber(lat, 4)`). */
private const val COORD_CARD_DECIMALS = 4

// The web's data-viz accent hexes (dynamic chart / semantic values, not static theme tokens — the sibling
// RegenEfficiencyPage `REGEN_*` precedent). Used for the metric-card accents, the status-card glyph tints, the chart
// strokes and the traffic-delay coloring.
private val NAV_CYAN = Color(0xFF00F0FF)
private val NAV_PURPLE = Color(0xFFA855F7)
private val NAV_GREEN = Color(0xFF10B981)
private val NAV_AMBER = Color(0xFFF59E0B)
private val NAV_RED = Color(0xFFEF4444)
private val NAV_BLUE = Color(0xFF3B82F6)
private val NAV_EMERALD = Color(0xFF34D399)

/** The page's interaction callbacks, wired to the [NavigationRoutePageViewModel] (web event handlers). */
data class NavigationRouteActions(
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [NavigationRoutePageViewModel] over the supplied [source] (the host wires the shared
 * vehicles repository + the page-local history repository + settings holder + the app-scoped active-vehicle selection
 * via [navigationRoutePageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun NavigationRoutePage(
    source: NavigationRoutePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: NavigationRoutePageViewModel =
        viewModel(
            key = NavigationRoutePageRegistration.SLUG,
            factory = viewModelFactory { initializer { NavigationRoutePageViewModel(source, logger) } },
        )
    NavigationRoutePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] latest + history + charging feeds + display prefs to the content. */
@Composable
fun NavigationRoutePage(
    viewModel: NavigationRoutePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val latestState by viewModel.latestState.collectAsStateWithLifecycle()
    val historyState by viewModel.historyState.collectAsStateWithLifecycle()
    val chargingState by viewModel.chargingState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            NavigationRouteActions(
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
            )
        }

    NavigationRoutePageContent(
        latestState = latestState,
        historyState = historyState,
        chargingState = chargingState,
        prefs = prefs,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A first load with nothing cached on every feed renders the full-page skeleton; otherwise the
 * header is drawn, then the page-level error banner (when any feed failed), then each of the thirteen panels — every one
 * of which renders its own loading / empty / error / content surface inline, so no region ever blanks.
 */
@Composable
fun NavigationRoutePageContent(
    latestState: UiState<LocationSnapshot?>,
    historyState: UiState<List<LocationSnapshot>>,
    chargingState: UiState<ChargingTelemetry>,
    prefs: NavDisplayPrefs,
    actions: NavigationRouteActions,
    modifier: Modifier = Modifier,
) {
    if (latestState.isLoading && historyState.isLoading && chargingState.isLoading) {
        NavLoading(modifier)
        return
    }

    val latest = latestState.data
    val history = historyState.data.orEmpty()
    val anyError = latestState.hasError || historyState.hasError || chargingState.hasError

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        NavHeader(latestState = latestState, onRefresh = actions.onRefresh)

        if (anyError) {
            NavErrorBanner()
        }

        FadeIn(delayMs = 0) { NavStatusPanel(latestState = latestState, prefs = prefs) }
        GpsWarningBanner(latest = latest)
        FadeIn(delayMs = FADE_STEP_MS) { LocationStatusCards(latest = latest, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) {
            RouteMetrics(latest = latest, charging = chargingState.data, history = history, prefs = prefs)
        }
        FadeIn(delayMs = FADE_STEP_MS * 3) { SpeedProfilePanel(historyState = historyState, prefs = prefs, onRetry = actions.onRetry) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { WaypointsPanel(latest = latest, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { RouteTrafficDelayPanel(latestState = latestState, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) {
            RecentDestinationsPanel(historyState = historyState, prefs = prefs, onRetry = actions.onRetry)
        }
        FadeIn(delayMs = FADE_STEP_MS * 7) { PresencePanel(historyState = historyState, onRetry = actions.onRetry) }
        FadeIn(delayMs = FADE_STEP_MS * 8) { LocationHistoryPanel(historyState = historyState, prefs = prefs, onRetry = actions.onRetry) }
    }
}

/** The full-page loading skeleton shown before the first payload (web `PageContainer loading`). */
@Composable
private fun NavLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        ChartBlockSkeleton(height = 160.dp)
        StatGridSkeleton(count = 3)
        StatGridSkeleton(count = 2)
        ChartBlockSkeleton(height = SPEED_CHART_HEIGHT)
        ChartBlockSkeleton(height = PRESENCE_CHART_HEIGHT)
    }
}

/** The page header — the title + muted subtitle + query-freshness chip + the refresh affordance (web `PageContainer`). */
@Composable
private fun NavHeader(
    latestState: UiState<LocationSnapshot?>,
    onRefresh: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_nav_pageTitle))
                BodyText(
                    stringResource(R.string.translation_nav_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = latestState.fetchedAt?.takeIf { it > 0L },
                isFetching = latestState.refreshing,
                isStale = latestState.stale,
                isError = latestState.hasError,
                compact = true,
            )
        }
        Button(
            label = stringResource(R.string.translation_nav_refresh),
            onClick = onRefresh,
            variant = ButtonVariant.Ghost,
            leadingIcon = NavigationRouteGlyphs.RefreshCw,
        )
    }
}

/** The page-level "failed to load" banner — web `anyError && <AlertBanner variant="danger">`. */
@Composable
private fun NavErrorBanner() {
    io.teslasync.android.components.feedback.AlertBanner(
        message = stringResource(R.string.translation_error_loadFailed),
        tone = io.teslasync.android.components.feedback.Tone.Danger,
        icon = NavigationRouteGlyphs.AlertCircle,
    )
}

// ── GlassPanel1 — Navigation Status ───────────────────────────────────────────────────────────────────────────

/** GlassPanel1 — the navigation-status panel: header + status badge, route-last-updated, and the active-route grid. */
@Composable
private fun NavStatusPanel(
    latestState: UiState<LocationSnapshot?>,
    prefs: NavDisplayPrefs,
) {
    val latest = latestState.data
    val activeRoute = latest?.takeIf { it.hasActiveRoute }
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = STATUS_PANEL_DESC },
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(NavigationRouteGlyphs.Navigation, contentDescription = null, size = IconSize.Lg)
                Spacer(Modifier.width(Spacing.xs))
                SectionTitle(stringResource(R.string.translation_nav_status))
            }
            Badge(
                text =
                    if (activeRoute != null) {
                        stringResource(R.string.translation_nav_active)
                    } else {
                        stringResource(R.string.translation_nav_inactive)
                    },
                variant = if (activeRoute != null) BadgeVariant.Success else BadgeVariant.Neutral,
                dot = true,
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(NavigationRouteGlyphs.RefreshCw, contentDescription = null, size = IconSize.Xs)
            Spacer(Modifier.width(Spacing.xs))
            Caption(
                stringResource(R.string.translation_nav_routeLastUpdated) + ": " +
                    formatDateTime(latest?.routeLastUpdated, ZoneId.systemDefault(), prefs.locale),
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        when {
            latestState.isLoading -> SkeletonLines(lines = 4)
            activeRoute != null -> NavStatusGrid(latest = activeRoute, prefs = prefs)
            else ->
                EmptyState(
                    icon = NavigationRouteGlyphs.Navigation,
                    message = stringResource(R.string.translation_nav_noActiveNav),
                )
        }
    }
}

/** The four active-route fields (web `grid lg:grid-cols-4`): destination, ETA, distance remaining, traffic delay. */
@Composable
private fun NavStatusGrid(
    latest: LocationSnapshot,
    prefs: NavDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            NavStatusField(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_destination),
                value = latest.destinationName ?: EM_DASH,
            )
            NavStatusField(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_eta),
                value = "${prefs.number(latest.minutesToArrival ?: 0.0, 0)} ${stringResource(R.string.translation_nav_minutes)}",
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            NavStatusField(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_distanceRemaining),
                value = prefs.withUnit(prefs.toDistanceDisplay(latest.milesToArrivalMeters ?: 0.0), prefs.distanceLabel, 1),
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_nav_trafficDelay))
                TrafficDelayBadge(seconds = latest.routeTrafficDelaySeconds ?: 0.0, prefs = prefs)
            }
        }
    }
}

@Composable
private fun NavStatusField(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        BodyText(value, maxLines = 1)
    }
}

/** The traffic-delay chip — web `TrafficDelayBadge` (success/warning/danger by the 5/15-minute thresholds). */
@Composable
private fun TrafficDelayBadge(
    seconds: Double,
    prefs: NavDisplayPrefs,
) {
    val variant =
        when (trafficSeverity(seconds)) {
            TrafficSeverity.Ok -> BadgeVariant.Success
            TrafficSeverity.Warning -> BadgeVariant.Warning
            TrafficSeverity.Critical -> BadgeVariant.Danger
        }
    Badge(
        text = "${prefs.duration(seconds)} ${stringResource(R.string.translation_nav_delay)}",
        variant = variant,
        dot = true,
    )
}

/** The GPS-coordinates-missing info banner — web `!hasValidLocation && latest && <AlertBanner variant="info">`. */
@Composable
private fun GpsWarningBanner(latest: LocationSnapshot?) {
    if (latest != null && !latest.hasValidLocation) {
        io.teslasync.android.components.feedback.AlertBanner(
            message = stringResource(R.string.translation_nav_noGps),
            tone = io.teslasync.android.components.feedback.Tone.Info,
        )
    }
}

// ── GlassPanel2 — Location Status Cards ───────────────────────────────────────────────────────────────────────

/** GlassPanel2 — the five location-status cards (current location, GPS fix, heading, home, work). */
@Composable
private fun LocationStatusCards(
    latest: LocationSnapshot?,
    prefs: NavDisplayPrefs,
) {
    val fix = normalizeGpsState(latest?.gpsState)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LocationStatusCard(
                modifier = Modifier.weight(1f),
                icon = NavigationRouteGlyphs.MapPin,
                label = stringResource(R.string.translation_nav_currentLocation),
                value =
                    if (latest?.hasValidLocation == true) {
                        "${prefs.number(latest.latitude ?: 0.0, COORD_CARD_DECIMALS)}, " +
                            prefs.number(latest.longitude ?: 0.0, COORD_CARD_DECIMALS)
                    } else {
                        stringResource(R.string.translation_nav_locationUnavailable)
                    },
                active = latest?.hasValidLocation == true,
            )
            LocationStatusCard(
                modifier = Modifier.weight(1f),
                icon = NavigationRouteGlyphs.Satellite,
                label = stringResource(R.string.translation_nav_gpsFixQuality),
                value = stringResource(gpsStateLabelRes(fix)),
                active = fix == GpsFixState.Locked,
            )
            LocationStatusCard(
                modifier = Modifier.weight(1f),
                icon = NavigationRouteGlyphs.Compass,
                label = stringResource(R.string.translation_nav_heading),
                value =
                    if (latest?.heading != null) {
                        stringResource(
                            R.string.translation_nav_headingValue,
                            headingToCardinal(latest.heading),
                            Math.round(latest.heading).toString(),
                        )
                    } else {
                        stringResource(R.string.translation_nav_unknown)
                    },
                active = latest?.heading != null,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LocationStatusCard(
                modifier = Modifier.weight(1f),
                icon = NavigationRouteGlyphs.Home,
                label = stringResource(R.string.translation_nav_homeStatus),
                value = homeStatusValue(latest),
                active = latest?.locatedAtHome == true,
            )
            LocationStatusCard(
                modifier = Modifier.weight(1f),
                icon = NavigationRouteGlyphs.Briefcase,
                label = stringResource(R.string.translation_nav_workStatus),
                value =
                    when (latest?.locatedAtWork) {
                        true -> stringResource(R.string.translation_nav_atWork)
                        false -> stringResource(R.string.translation_nav_notAtWork)
                        null -> stringResource(R.string.translation_nav_unknown)
                    },
                active = latest?.locatedAtWork == true,
            )
            Spacer(Modifier.weight(1f))
        }
    }
}

/** The home-status card value — web `atHome ? … : homelinkNearby ? … : awayFromHome` (else `unknown`). */
@Composable
private fun homeStatusValue(latest: LocationSnapshot?): String =
    when (latest?.locatedAtHome) {
        true -> stringResource(R.string.translation_nav_atHome)
        false ->
            if (latest.homelinkNearby == true) {
                stringResource(R.string.translation_nav_homelinkNearby)
            } else {
                stringResource(R.string.translation_nav_awayFromHome)
            }
        null -> stringResource(R.string.translation_nav_unknown)
    }

/** One location-status card — web `LocationStatusCard` (icon chip + label/value + ✓/— badge, ringed when active). */
@Composable
private fun LocationStatusCard(
    icon: ImageVector,
    label: String,
    value: String,
    active: Boolean,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                icon,
                contentDescription = null,
                size = IconSize.Md,
                tint = if (active) NAV_EMERALD else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(Spacing.sm))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MetricLabel(label)
                BodyText(value, maxLines = 1)
            }
            Badge(
                text = if (active) "\u2713" else EM_DASH,
                variant = if (active) BadgeVariant.Success else BadgeVariant.Neutral,
            )
        }
    }
}

// ── Distance / ETA / Traffic-Delay / Avg-Speed / Energy-at-Arrival metric cards ───────────────────────────────

/** The five route-metric cards (web `MetricCard` grid). Each always renders, showing the em dash when inactive. */
@Composable
private fun RouteMetrics(
    latest: LocationSnapshot?,
    charging: ChargingTelemetry?,
    history: List<LocationSnapshot>,
    prefs: NavDisplayPrefs,
) {
    val activeRoute = latest?.takeIf { it.hasActiveRoute }
    val avgSpeed = remember(history, prefs) { avgSpeedDisplay(history, prefs) }
    val energyPct = charging?.expectedEnergyPctAtArrival
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_metric_distance),
                value =
                    if (activeRoute != null) {
                        prefs.withUnit(prefs.toDistanceDisplay(activeRoute.milesToArrivalMeters ?: 0.0), prefs.distanceLabel, 1)
                    } else {
                        EM_DASH
                    },
                icon = NavigationRouteGlyphs.Route,
                accent = NAV_CYAN,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_metric_eta),
                value =
                    if (activeRoute != null) {
                        "${prefs.number(activeRoute.minutesToArrival ?: 0.0, 0)} ${stringResource(R.string.translation_nav_minutes)}"
                    } else {
                        EM_DASH
                    },
                icon = NavigationRouteGlyphs.Clock,
                accent = NAV_PURPLE,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_metric_trafficDelay),
                value = if (activeRoute != null) prefs.duration(activeRoute.routeTrafficDelaySeconds ?: 0.0) else EM_DASH,
                icon = NavigationRouteGlyphs.BatteryCharging,
                accent = NAV_GREEN,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_metric_avgSpeed),
                value = prefs.withUnit(avgSpeed, prefs.speedLabel, 1),
                icon = NavigationRouteGlyphs.Gauge,
                accent = NAV_AMBER,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_nav_metric_energyAtArrival),
                value = if (energyPct != null) "${prefs.number(energyPct, 0)}%" else EM_DASH,
                icon = NavigationRouteGlyphs.BatteryCharging,
                accent = NAV_GREEN,
            )
            Spacer(Modifier.weight(1f))
        }
    }
}

// ── GlassPanel8 — Speed Profile (AreaChart) ───────────────────────────────────────────────────────────────────

/** GlassPanel8 — the speed-profile area chart (web `AreaChart`: display speed + distance-to-arrival over time). */
@Composable
private fun SpeedProfilePanel(
    historyState: UiState<List<LocationSnapshot>>,
    prefs: NavDisplayPrefs,
    onRetry: () -> Unit,
) {
    val points = remember(historyState.data, prefs) { speedProfile(historyState.data.orEmpty(), prefs) }
    ChartContainer(
        title = stringResource(R.string.translation_nav_speedProfile),
        status = chartStatusOf(historyState, points.isEmpty()),
        height = SPEED_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_nav_speedProfile),
        emptyMessage = stringResource(R.string.translation_nav_noHistory),
        errorMessage = stringResource(R.string.translation_error_loadFailed),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_nav_col_time),
                stringResource(R.string.translation_nav_chartSpeedV2, prefs.speedLabel),
                stringResource(R.string.translation_nav_chartDistanceV2, prefs.distanceLabel),
            ),
        dataTableRows = points.map { listOf(it.time, prefs.number(it.speed, 1), prefs.number(it.distance, 1)) },
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "speed",
                        label = stringResource(R.string.translation_nav_legendSpeedV2, prefs.speedLabel),
                        values = points.map { it.speed },
                        color = NAV_CYAN,
                    ),
                    ChartSeries(
                        key = "distance",
                        label = stringResource(R.string.translation_nav_legendDistanceToArrivalV2, prefs.distanceLabel),
                        values = points.map { it.distance },
                        color = NAV_PURPLE,
                    ),
                ),
            xLabels = points.map { it.time },
            height = SPEED_CHART_HEIGHT,
        )
    }
}

// ── GlassPanel9 — Route Waypoints ─────────────────────────────────────────────────────────────────────────────

/** GlassPanel9 — the route-waypoints table (web `Waypoints`): destination/supercharger nodes for the active route. */
@Composable
private fun WaypointsPanel(
    latest: LocationSnapshot?,
    prefs: NavDisplayPrefs,
) {
    val waypoints = remember(latest) { buildWaypoints(latest) }
    GlassPanel(padding = PanelPadding.Lg) {
        PanelHeader(icon = NavigationRouteGlyphs.Zap, title = stringResource(R.string.translation_nav_waypoints))
        Spacer(Modifier.height(Spacing.sm))
        when {
            latest?.hasActiveRoute != true ->
                EmptyState(message = stringResource(R.string.translation_navigation_noRoute))
            waypoints.isEmpty() ->
                EmptyState(
                    icon = NavigationRouteGlyphs.Activity,
                    message = stringResource(R.string.translation_common_noData),
                )
            else -> {
                TableHeaderRow(
                    stringResource(R.string.translation_nav_wp_name),
                    stringResource(R.string.translation_nav_wp_type),
                    stringResource(R.string.translation_nav_wp_distance),
                )
                waypoints.forEach { wp -> WaypointRow(wp = wp, prefs = prefs) }
            }
        }
    }
}

@Composable
private fun WaypointRow(
    wp: Waypoint,
    prefs: NavDisplayPrefs,
) {
    val (icon, tint) =
        when (wp.type) {
            WaypointType.Supercharger -> NavigationRouteGlyphs.Zap to NAV_RED
            WaypointType.Destination -> NavigationRouteGlyphs.MapPin to NAV_CYAN
            WaypointType.Waypoint -> NavigationRouteGlyphs.Route to NAV_AMBER
        }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, size = IconSize.Sm, tint = tint)
            Spacer(Modifier.width(Spacing.xs))
            BodyText(wp.name, maxLines = 1)
        }
        Box(modifier = Modifier.weight(1f)) {
            Badge(
                text = wp.type.name.lowercase(),
                variant =
                    when (wp.type) {
                        WaypointType.Supercharger -> BadgeVariant.Danger
                        WaypointType.Destination -> BadgeVariant.Info
                        WaypointType.Waypoint -> BadgeVariant.Neutral
                    },
            )
        }
        BodyText(
            prefs.withUnit(prefs.toDistanceDisplay(wp.distanceMeters), prefs.distanceLabel, 1),
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── GlassPanel10 — Route Traffic Delay ────────────────────────────────────────────────────────────────────────

/** GlassPanel10 — the route-traffic-delay panel (web `Route Traffic Delay`): big colored figure + the delay chip. */
@Composable
private fun RouteTrafficDelayPanel(
    latestState: UiState<LocationSnapshot?>,
    prefs: NavDisplayPrefs,
) {
    val seconds = latestState.data?.routeTrafficDelaySeconds ?: 0.0
    GlassPanel(padding = PanelPadding.Lg) {
        PanelHeader(
            icon = NavigationRouteGlyphs.TrafficCone,
            iconTint = NAV_AMBER,
            title = stringResource(R.string.translation_nav_trafficDelay),
        )
        Spacer(Modifier.height(Spacing.sm))
        if (latestState.isLoading) {
            Skeleton(height = 48.dp)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                BodyText(
                    prefs.duration(seconds),
                    color =
                        when (trafficSeverity(seconds)) {
                            TrafficSeverity.Ok -> NAV_GREEN
                            TrafficSeverity.Warning -> NAV_AMBER
                            TrafficSeverity.Critical -> NAV_RED
                        },
                )
                TrafficDelayBadge(seconds = seconds, prefs = prefs)
            }
        }
    }
}

// ── GlassPanel11 — Recent Destinations ────────────────────────────────────────────────────────────────────────

/** GlassPanel11 — the recent-destinations table (web `Recent Destinations`): unique active-route destinations. */
@Composable
private fun RecentDestinationsPanel(
    historyState: UiState<List<LocationSnapshot>>,
    prefs: NavDisplayPrefs,
    onRetry: () -> Unit,
) {
    val rows = remember(historyState.data, prefs) { recentDestinations(historyState.data.orEmpty(), prefs) }
    GlassPanel(padding = PanelPadding.Lg) {
        PanelHeader(
            icon = NavigationRouteGlyphs.Clock,
            iconTint = NAV_CYAN,
            title = stringResource(R.string.translation_nav_recentDestinations),
        )
        Spacer(Modifier.height(Spacing.sm))
        when {
            historyState.isLoading -> SkeletonLines(lines = 6)
            historyState.isError -> RetrySurface(onRetry)
            rows.isEmpty() -> EmptyState(message = stringResource(R.string.translation_nav_noDestinations))
            else -> {
                TableHeaderRow(
                    stringResource(R.string.translation_nav_col_time),
                    stringResource(R.string.translation_nav_col_destination),
                    stringResource(R.string.translation_nav_col_distance),
                    stringResource(R.string.translation_nav_col_eta),
                )
                rows.forEach { row ->
                    TableDataRow(
                        row.time,
                        row.destination,
                        prefs.withUnit(row.distance, prefs.distanceLabel, 1),
                        "${prefs.number(row.etaMinutes, 0)} ${stringResource(R.string.translation_nav_minutes)}",
                    )
                }
            }
        }
    }
}

// ── GlassPanel12 — Home / Work Presence (LineChart) ───────────────────────────────────────────────────────────

/** GlassPanel12 — the home/work-presence step line chart (web `LineChart`: home/work/homelink presence over time). */
@Composable
private fun PresencePanel(
    historyState: UiState<List<LocationSnapshot>>,
    onRetry: () -> Unit,
) {
    val points = remember(historyState.data) { presenceSeries(historyState.data.orEmpty()) }
    val yes = stringResource(R.string.translation_common_yes)
    val no = stringResource(R.string.translation_common_no)
    ChartContainer(
        title = stringResource(R.string.translation_nav_presenceChart),
        status = chartStatusOf(historyState, points.isEmpty()),
        height = PRESENCE_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_nav_presenceChart),
        emptyMessage = stringResource(R.string.translation_nav_noPresence),
        errorMessage = stringResource(R.string.translation_error_loadFailed),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_nav_col_time),
                stringResource(R.string.translation_nav_atHome),
                stringResource(R.string.translation_nav_atWork),
                stringResource(R.string.translation_nav_homelinkNearby),
            ),
        dataTableRows =
            points.map {
                listOf(
                    it.time,
                    if (it.home > 0.0) yes else no,
                    if (it.work > 0.0) yes else no,
                    if (it.homelink > 0.0) yes else no,
                )
            },
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "home",
                        label = stringResource(R.string.translation_nav_atHome),
                        values = points.map { it.home },
                        color = NAV_GREEN,
                    ),
                    ChartSeries(
                        key = "work",
                        label = stringResource(R.string.translation_nav_atWork),
                        values = points.map { it.work },
                        color = NAV_BLUE,
                    ),
                    ChartSeries(
                        key = "homelink",
                        label = stringResource(R.string.translation_nav_homelinkNearby),
                        values = points.map { it.homelink },
                        color = NAV_PURPLE,
                    ),
                ),
            xLabels = points.map { it.time },
            height = PRESENCE_CHART_HEIGHT,
        )
    }
}

// ── GlassPanel13 — Location History ───────────────────────────────────────────────────────────────────────────

/** GlassPanel13 — the location-history table (web `Location History`): time / lat / lon / home / work / destination. */
@Composable
private fun LocationHistoryPanel(
    historyState: UiState<List<LocationSnapshot>>,
    prefs: NavDisplayPrefs,
    onRetry: () -> Unit,
) {
    val rows = remember(historyState.data, prefs) { historyRows(historyState.data.orEmpty(), prefs.locale) }
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = HISTORY_PANEL_DESC },
        padding = PanelPadding.Lg,
    ) {
        PanelHeader(icon = NavigationRouteGlyphs.Compass, title = stringResource(R.string.translation_nav_locationHistory))
        Spacer(Modifier.height(Spacing.sm))
        when {
            historyState.isLoading -> SkeletonLines(lines = 8)
            historyState.isError -> RetrySurface(onRetry)
            rows.isEmpty() -> EmptyState(message = stringResource(R.string.translation_nav_noSnapshots))
            else -> {
                TableHeaderRow(
                    stringResource(R.string.translation_nav_col_time),
                    stringResource(R.string.translation_nav_col_lat),
                    stringResource(R.string.translation_nav_col_lon),
                    stringResource(R.string.translation_nav_col_home),
                    stringResource(R.string.translation_nav_col_work),
                    stringResource(R.string.translation_nav_col_destination),
                )
                rows.forEach { row -> LocationHistoryRow(row) }
            }
        }
    }
}

@Composable
private fun LocationHistoryRow(row: HistoryRow) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CellText(row.time, modifier = Modifier.weight(1.4f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        CellText(row.latitude, modifier = Modifier.weight(1f))
        CellText(row.longitude, modifier = Modifier.weight(1f))
        BoolCell(row.atHome, modifier = Modifier.weight(0.7f), trueTint = NAV_GREEN)
        BoolCell(row.atWork, modifier = Modifier.weight(0.7f), trueTint = NAV_BLUE)
        CellText(row.destination, modifier = Modifier.weight(1.3f))
    }
}

// ── Shared table + state helpers ──────────────────────────────────────────────────────────────────────────────

@Composable
private fun PanelHeader(
    icon: ImageVector,
    title: String,
    iconTint: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, size = IconSize.Md, tint = iconTint)
        Spacer(Modifier.width(Spacing.xs))
        SectionTitle(title)
    }
}

@Composable
private fun TableHeaderRow(vararg headers: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        headers.forEach { header -> Caption(header, modifier = Modifier.weight(1f)) }
    }
}

@Composable
private fun TableDataRow(vararg cells: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        cells.forEach { cell -> BodyText(cell, modifier = Modifier.weight(1f), maxLines = 1) }
    }
}

@Composable
private fun CellText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
) {
    BodyText(text, modifier = modifier, color = color, maxLines = 1)
}

/** A boolean table cell — localized Yes / No (or the em dash when unknown), colored when true (web `Yes/No/—`). */
@Composable
private fun BoolCell(
    value: Boolean?,
    trueTint: Color,
    modifier: Modifier = Modifier,
) {
    val text =
        when (value) {
            true -> stringResource(R.string.translation_common_yes)
            false -> stringResource(R.string.translation_common_no)
            null -> EM_DASH
        }
    BodyText(
        text,
        modifier = modifier,
        color = if (value == true) trueTint else MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
    )
}

/** A hard-error retry surface for a section whose feed failed with nothing cached (web `error` ▸ retry). */
@Composable
private fun RetrySurface(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** Maps a feed's [UiState] + emptiness to the chart-container status (web `loading ? … : empty ? … : ready`). */
private fun chartStatusOf(
    state: UiState<*>,
    isEmpty: Boolean,
): ChartStatus =
    when {
        state.isLoading -> ChartStatus.Loading
        state.isError -> ChartStatus.Error
        isEmpty -> ChartStatus.Empty
        else -> ChartStatus.Ready
    }

/** The catalog string id for a normalized GPS fix state (`nav.gpsState.*`). */
private fun gpsStateLabelRes(fix: GpsFixState): Int =
    when (fix) {
        GpsFixState.Locked -> R.string.translation_nav_gpsState_locked
        GpsFixState.Unlocked -> R.string.translation_nav_gpsState_unlocked
        GpsFixState.Unknown -> R.string.translation_nav_gpsState_unknown
    }

private const val STATUS_PANEL_DESC = "Navigation status"
private const val HISTORY_PANEL_DESC = "Location history"

