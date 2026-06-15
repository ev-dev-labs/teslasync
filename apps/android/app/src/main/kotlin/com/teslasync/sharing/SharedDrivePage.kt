// The native Jetpack Compose + Material 3 SharedDrivePage sharing surface — a parity port of
// web/src/features/sharing/pages/SharedDrivePage.tsx, the chrome-less public "shared drive report" recipients open
// from a `/s/{token}` link. It reproduces the page's header, hero route map, eleven panels (the seven summary
// StatCards — distance, duration, efficiency, battery, max-speed, avg-speed, elevation-gain — the vehicle badge,
// the elevation-profile + speed-profile chart panels, and the no-route fallback), both charts (the A3 area + line
// wrappers), every data state (loading spinner / unavailable / report), and every visible string (resolved from the
// generated res/values catalog, ADR-014). The map carries the route polyline + green start / red end markers over
// the dark base tile.
//
// Composition: [SharedDrivePage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the share feed + the live display preferences);
// [SharedDrivePageContent] is the stateless render layer. The decoded SI [SharedDrive] is folded by the
// framework-free model (SharedDrivePageModel.kt) into the cards, charts, and map — exactly as the web page threads
// its normalized data through the useMemo chain. SI values are converted to the user's units only here at the
// display boundary via [SharedDriveDisplayPrefs] (Phase-48 SI-canonical); each card/chart renders its own fallback
// so no region is ever hidden.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
)

package io.teslasync.android.sharing.shareddrive

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapDotMarker
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Logo
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/** The hero map takes the top half of the screen (web `h-[50vh]`). */
private const val HERO_MAP_FRACTION = 0.5f

/** Both profile charts are 200 dp tall (web `height={200}`). */
private val CHART_HEIGHT = 200.dp

/** The report content column caps at the web `max-w-4xl` (56 rem) and centers. */
private val CONTENT_MAX_WIDTH = 896.dp

/** The hero map's fixed zoom (web `zoom={7}`). */
private const val MAP_ZOOM = 7f

/** The fallback map centre when the route has no points (web `[47.6, -122.3]`). */
private val DEFAULT_MAP_CENTER = GeoPoint(47.6, -122.3)

/** Route trail width + opacity (web `weight: 3, opacity: 0.8`). */
private const val ROUTE_TRAIL_WIDTH = 6f
private const val ROUTE_TRAIL_ALPHA = 0.8f

/** Start marker green / end marker red (web `#22c55e` / `#ef4444`). */
private val ROUTE_START_COLOR = Color(0xFF22C55E)
private val ROUTE_END_COLOR = Color(0xFFEF4444)

/** The speed-profile line accent (web `stroke="#00f0ff"`). */
private val SPEED_LINE_COLOR = Color(0xFF00F0FF)

/** Per-panel entrance-fade stagger (web `FadeIn delay` cascade), in ms per ordinal. */
private const val FADE_STEP_MS = 50

/** The project repository the footer "Learn more" affordance opens (web footer `<a href>`). */
private const val SHARED_DRIVE_REPO_URL = "https://github.com/ev-dev-labs/teslasync"

private val ICON_CIRCLE_LG = 64.dp
private val ICON_CIRCLE_SM = 32.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SharedDrivePageViewModel] over the supplied [source] (the host wires the shared
 * resilient client + settings holder via [sharedDrivePageSourceOf]) for the public [token]. [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun SharedDrivePage(
    source: SharedDrivePageSource,
    token: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SharedDrivePageViewModel =
        viewModel(
            key = "${SharedDrivePageRegistration.SLUG}:$token",
            factory = viewModelFactory { initializer { SharedDrivePageViewModel(source, token, logger) } },
        )
    SharedDrivePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] share feed + display prefs to the stateless content. */
@Composable
fun SharedDrivePage(
    viewModel: SharedDrivePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    SharedDrivePageContent(
        state = state,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A first load with nothing decoded shows the centered loader; a null decode (web `!data`)
 * or a transport failure (web `error`) shows the "share link unavailable" surface; a decoded payload renders the
 * full report. The page is chrome-less (web public route), filling the screen over the primary background.
 */
@Composable
fun SharedDrivePageContent(
    state: UiState<SharedDrive?>,
    prefs: SharedDriveDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
    ) {
        val drive = state.data
        when {
            state.isLoading -> SharedDriveLoading()
            drive == null -> ExpiredShareView(onRetry = onRetry)
            else -> SharedDriveReport(drive = drive, prefs = prefs)
        }
    }
}

/** The first-load state: a centered brand spinner (web `<Spinner className="h-8 w-8" />`). */
@Composable
private fun SharedDriveLoading() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Spinner(size = SpinnerSize.Md)
    }
}

/**
 * The unavailable state — the web `ExpiredShareView`, shown when the link errored or decoded to nothing. A muted pin
 * badge, the unavailable title + explanation, and a "Go to TeslaSync" affordance that relaunches the app at its
 * start destination (the web `<a href="/">`). The whole surface carries the title as its accessible name.
 */
@Composable
private fun ExpiredShareView(onRetry: () -> Unit) {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_share_expired_title)
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(Spacing.lg)
                .semantics { contentDescription = title },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
    ) {
        IconCircle(diameter = ICON_CIRCLE_LG, iconSize = IconSize.Xl, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Heading(title, level = HeadingLevel.Section)
        BodyText(
            stringResource(R.string.translation_share_expired_description),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
            label = stringResource(R.string.translation_share_expired_home),
            onClick = {
                val launch =
                    context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                    }
                if (launch != null) context.startActivity(launch) else onRetry()
            },
            variant = ButtonVariant.Ghost,
        )
    }
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The full report: the branded header, the hero route map (when the trail has more than one point, web
 * `mapPoints.length > 1`), then the centered, width-capped content column — title block, the seven summary cards,
 * the vehicle badge, the elevation + speed chart panels, the no-route fallback (only when nothing is plottable, web
 * `mapPoints==0 && elevation==0 && speed==0`), and the footer.
 */
@Composable
private fun SharedDriveReport(
    drive: SharedDrive,
    prefs: SharedDriveDisplayPrefs,
) {
    val info = drive.drive
    val hasRoute = drive.mapPoints.size > 1
    val noPlottableData =
        drive.mapPoints.isEmpty() && drive.elevationProfile.isEmpty() && drive.speedProfile.isEmpty()

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        SharedDriveHeader(modifier = Modifier.fillMaxWidth())

        if (hasRoute) {
            FadeIn(modifier = Modifier.fillMaxWidth()) { SharedDriveMap(mapPoints = drive.mapPoints) }
        }

        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .widthIn(max = CONTENT_MAX_WIDTH)
                    .padding(horizontal = Spacing.lg, vertical = Spacing.xl3),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
        ) {
            FadeIn { SharedDriveTitleBlock(drive = drive) }
            FadeIn(delayMs = FADE_STEP_MS) { SharedDriveStatsGrid(info = info, prefs = prefs) }
            FadeIn(delayMs = FADE_STEP_MS * 2) { SharedDriveVehicleBadge(vehicle = drive.vehicle) }
            FadeIn(delayMs = FADE_STEP_MS * 3) { SharedDriveElevationPanel(points = drive.elevationProfile, prefs = prefs) }
            FadeIn(delayMs = FADE_STEP_MS * 4) { SharedDriveSpeedPanel(points = drive.speedProfile, prefs = prefs) }
            if (noPlottableData) {
                SharedDriveNoData()
            }
            FadeIn(delayMs = FADE_STEP_MS * 5) { SharedDriveFooter() }
        }
    }
}

/** The branded header — the [Logo] + the "Shared Drive Report" caption above a subtle divider (web `<header>`). */
@Composable
private fun SharedDriveHeader(modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Logo()
            Caption(stringResource(R.string.translation_share_header))
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/**
 * The hero route map — the native analogue of the web `<MapContainer>` + `<MapTileLayer style="dark" />`. The dark
 * base tile is the [MapStyleId.Dark] style; the trail is a [Polyline] in the theme primary; the route ends are the
 * green start / red end [MapDotMarker]s (the web start/end `<CircleMarker>`s). The camera seeds at the route's
 * midpoint and the web fixed zoom.
 */
@Composable
private fun SharedDriveMap(
    mapPoints: List<GeoPoint>,
    modifier: Modifier = Modifier,
) {
    val heightDp = (LocalConfiguration.current.screenHeightDp * HERO_MAP_FRACTION).dp
    val center = remember(mapPoints) { sharedDriveMapCenter(mapPoints) }
    val camera = rememberMapCameraState(CameraSnapshot(center, MAP_ZOOM))
    val trailColor = MaterialTheme.colorScheme.primary.copy(alpha = ROUTE_TRAIL_ALPHA)
    val routeLabel = stringResource(R.string.translation_share_header)

    Box(modifier = modifier.fillMaxWidth().height(heightDp)) {
        TeslaMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            style = MapStyleId.Dark,
            contentDescription = routeLabel,
        ) {
            Polyline(
                points = mapPoints.map { it.toLatLng() },
                color = trailColor,
                width = ROUTE_TRAIL_WIDTH,
            )
            mapPoints.firstOrNull()?.let { MapDotMarker(point = it, color = ROUTE_START_COLOR) }
            mapPoints.lastOrNull()?.let { MapDotMarker(point = it, color = ROUTE_END_COLOR) }
        }
    }
}

/** The title block — the report title, optional description, and the date + start→end addresses (web title div). */
@Composable
private fun SharedDriveTitleBlock(drive: SharedDrive) {
    val info = drive.drive
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Heading(drive.title, level = HeadingLevel.Page)
        if (!drive.description.isNullOrBlank()) {
            BodyText(drive.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(
            modifier = Modifier.padding(top = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (info.date.isNotBlank()) Caption(info.date)
            val start = info.startAddress
            val end = info.endAddress
            if (!start.isNullOrBlank() && !end.isNullOrBlank()) {
                Caption("$start \u2192 $end")
            }
        }
    }
}

/**
 * The seven summary cards (web `<Grid cols={{ default: 2, md: 4 }}>` of `<StatCard>`s): distance, duration,
 * efficiency, battery, max-speed, avg-speed, elevation-gain — two per row. Each renders its em-dash fallback when
 * the underlying SI value is absent, so no card is ever hidden.
 */
@Composable
private fun SharedDriveStatsGrid(
    info: SharedDriveInfo,
    prefs: SharedDriveDisplayPrefs,
) {
    val cards =
        listOf(
            SharedStat(stringResource(R.string.translation_share_distance), prefs.distance(info.distanceM, precision = 1), SharedDriveGlyphs.MapPin),
            SharedStat(stringResource(R.string.translation_share_duration), formatDurationSecondsAsMinutes(info.durationS), SharedDriveGlyphs.Clock),
            SharedStat(
                stringResource(R.string.translation_share_efficiency),
                info.efficiencyWhPerM?.let(prefs::efficiencyDisplay) ?: SHARED_DRIVE_EM_DASH,
                SharedDriveGlyphs.Zap,
            ),
            SharedStat(
                stringResource(R.string.translation_share_battery),
                batteryRange(info.startBattery, info.endBattery),
                SharedDriveGlyphs.Battery,
            ),
            SharedStat(
                stringResource(R.string.translation_share_maxSpeed),
                info.maxSpeedMps?.let { prefs.speed(it, precision = 0) } ?: SHARED_DRIVE_EM_DASH,
                SharedDriveGlyphs.Gauge,
            ),
            SharedStat(
                stringResource(R.string.translation_share_avgSpeed),
                info.avgSpeedMps?.let { prefs.speed(it, precision = 0) } ?: SHARED_DRIVE_EM_DASH,
                SharedDriveGlyphs.TrendingUp,
            ),
            SharedStat(
                stringResource(R.string.translation_share_elevGain),
                info.elevationGainM?.let(prefs::elevationDisplay) ?: SHARED_DRIVE_EM_DASH,
                SharedDriveGlyphs.Mountain,
            ),
        )

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        cards.chunked(2).forEach { rowCards ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowCards.forEach { card ->
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = card.label,
                        value = card.value,
                        icon = card.icon,
                    )
                }
                if (rowCards.size == 1) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}

/**
 * The vehicle badge (web `{data.vehicle && (<GlassPanel>…)}`) — the bolt chip + the "Tesla {model}" / colour rows.
 * Always rendered with an em-dash fallback when the share carries no vehicle, so the panel is never hidden.
 */
@Composable
private fun SharedDriveVehicleBadge(vehicle: SharedVehicle?) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            IconCircle(
                diameter = ICON_CIRCLE_SM,
                iconSize = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                if (vehicle != null) {
                    BodyText("Tesla ${vehicle.model}")
                    if (vehicle.color.isNotBlank()) Caption(vehicle.color)
                } else {
                    BodyText(SHARED_DRIVE_EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/**
 * The elevation-profile panel (web `<ChartContainer title={share.elevation}><AreaChart>`). Framed by
 * [ChartContainer] over the A3 [AreaChartWrapper]; the trace is SI metres converted to the display elevation unit at
 * the boundary. Empty (rather than hidden) when the share carries no elevation samples.
 */
@Composable
private fun SharedDriveElevationPanel(
    points: List<SharedElevationPoint>,
    prefs: SharedDriveDisplayPrefs,
) {
    val seriesLabel = stringResource(R.string.translation_share_elevTooltipLabel)
    val color = MaterialTheme.colorScheme.primary
    val xLabels = remember(points, prefs) { points.map { prefs.chartDistanceLabel(it.distanceM) } }
    val values = remember(points, prefs) { points.map { prefs.elevation(it.elevationM) } }

    ChartContainer(
        title = stringResource(R.string.translation_share_elevation),
        status = if (points.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_share_elevation_aria),
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "elevation",
                        label = seriesLabel,
                        values = values,
                        kind = ChartSeriesKind.Area,
                        color = color,
                        unit = prefs.elevationLabel,
                    ),
                ),
            xLabels = xLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { "${it.roundToInt()} ${prefs.elevationLabel}" },
        )
    }
}

/**
 * The speed-profile panel (web `<ChartContainer title={share.speed}><LineChart>`). Framed by [ChartContainer] over
 * the A3 [LineChartWrapper]; the trace is SI m/s converted to the display speed unit at the boundary. Empty (rather
 * than hidden) when the share carries no speed samples.
 */
@Composable
private fun SharedDriveSpeedPanel(
    points: List<SharedSpeedPoint>,
    prefs: SharedDriveDisplayPrefs,
) {
    val seriesLabel = stringResource(R.string.translation_share_speedTooltipLabel)
    val xLabels = remember(points, prefs) { points.map { prefs.chartDistanceLabel(it.distanceM) } }
    val values = remember(points, prefs) { points.map { prefs.chartSpeed(it.speedMps) } }

    ChartContainer(
        title = stringResource(R.string.translation_share_speed),
        status = if (points.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_share_speed_aria),
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "speed",
                        label = seriesLabel,
                        values = values,
                        kind = ChartSeriesKind.Line,
                        color = SPEED_LINE_COLOR,
                        unit = prefs.speedLabel,
                    ),
                ),
            xLabels = xLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { "${it.roundToInt()} ${prefs.speedLabel}" },
        )
    }
}

/** The no-route fallback (web `<GlassPanel className="p-8"><EmptyState …/></GlassPanel>`) — shown only when nothing is plottable. */
@Composable
private fun SharedDriveNoData() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        EmptyState(
            message = stringResource(R.string.translation_share_noMapData),
            icon = SharedDriveGlyphs.MapPin,
        )
    }
}

/** The footer — the attribution line above the "Learn more" link that opens the project repository (web `<footer>`). */
@Composable
private fun SharedDriveFooter() {
    val uriHandler = LocalUriHandler.current
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(modifier = Modifier.height(Spacing.sm))
        HelperText(stringResource(R.string.translation_share_footer))
        BodyText(
            stringResource(R.string.translation_share_learnMore),
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clickable { uriHandler.openUri(SHARED_DRIVE_REPO_URL) },
        )
    }
}

/** A circular bolt/pin chip used by the unavailable surface + the vehicle badge (web `rounded-full bg-white/[…]`). */
@Composable
private fun IconCircle(
    diameter: androidx.compose.ui.unit.Dp,
    iconSize: IconSize,
    tint: Color,
) {
    Box(
        modifier =
            Modifier
                .size(diameter)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        Icon(SharedDriveGlyphs.MapPin, contentDescription = null, size = iconSize, tint = tint)
    }
}

/** One summary-card row: a localized [label], a formatted [value], and a leading glyph. */
private data class SharedStat(
    val label: String,
    val value: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

/** The "start% → end%" battery string, or the em-dash when either endpoint is absent (web guarded render). */
private fun batteryRange(
    start: Int?,
    end: Int?,
): String = if (start != null && end != null) "$start% \u2192 $end%" else SHARED_DRIVE_EM_DASH

/** The map camera centre: the route midpoint, or the web fallback when the trail is empty (web `center` memo). */
private fun sharedDriveMapCenter(mapPoints: List<GeoPoint>): GeoPoint =
    if (mapPoints.isEmpty()) DEFAULT_MAP_CENTER else mapPoints[mapPoints.size / 2]
