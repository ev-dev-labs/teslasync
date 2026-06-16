// The native Jetpack Compose + Material 3 MapOverviewPage maps surface — a parity port of
// web/src/features/maps/pages/MapOverviewPage.tsx, the live-location dashboard. It reproduces the page's interactive
// map (the base-map layer switcher + the vehicle marker with its popup + the GPS trail polyline), the recent
// route-playback widget, the four live metric cards (current speed / heading / lat-lon / last-updated), the GPS
// data warning, the location-detail badges (home / work / HomeLink / odometer), the maps quick-links, the recent
// location-history table, every data state (loading skeleton / empty / error-retry / content, plus the
// cache-then-network stale/offline tier the bound state holder carries), and every visible string (resolved from
// the generated res/values catalog, ADR-014).
//
// Composition: [MapOverviewPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the fleet + positions + location feeds + the display
// prefs + the map style); [MapOverviewPageContent] is the stateless render layer. SI values are converted to the
// user's units only here at the display boundary via the model's [MapOverviewDisplayPrefs] helpers (Phase-48
// SI-canonical; the prompt's Units rule). The opaque base map is paired with a [MapAccessibleSummary] list
// alternative and carries an accessible name (ADR-015); the maps SDK is reached only for the trail `Polyline` (the
// shared maps layer ships no polyline wrapper — the sibling RouteMapSection / TripPlannerMap precedent).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the
// parity-complete panel set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.maps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.components.maps.MapLayerSwitcher
import io.teslasync.android.components.maps.MapMarker
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.RoutePlayback
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.VehicleMarker
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The web `h-[400px]` map height, reproduced 1:1. */
private val MAP_HEIGHT: Dp = 400.dp

/** The web `<RoutePlayback height={360}>` replay-map height. */
private const val PLAYBACK_HEIGHT: Int = 360

/** The web `zoom={15}` map zoom centred on the latest fix. */
private const val MAP_ZOOM: Float = 15f

/** The web `weight: 3` Leaflet trail stroke, in device pixels (scaled for the denser native map). */
private const val TRAIL_WIDTH: Float = 6f

/** The web `opacity: 0.7` trail alpha. */
private const val TRAIL_ALPHA: Float = 0.7f

/** Per-panel entrance-fade stagger (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS: Int = 50

/** The three maps quick-links (web hash navigations), each resolving to its registered destination's deep link. */
enum class MapQuickLink(
    private val destinationId: String,
) {
    NavRoute("navigationRoute"),
    Geofences("geofences"),
    Locations("locations"),
    ;

    /** The app-scheme deep link (`teslasync://app/…`) for the destination, matched in-app by the NavHost. */
    fun deepLink(): String = RouteTable.deepLinkUris(Destinations.require(destinationId)).first()
}

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [MapOverviewPageViewModel] over the supplied [source] (the host wires the shared
 * vehicles repository + settings holder + the app-scoped active-vehicle selection via [mapOverviewPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun MapOverviewPage(
    source: MapOverviewPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: MapOverviewPageViewModel =
        viewModel(
            key = MapOverviewPageRegistration.SLUG,
            factory = viewModelFactory { initializer { MapOverviewPageViewModel(source, logger) } },
        )
    MapOverviewPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + display prefs + map style to the stateless content. */
@Composable
fun MapOverviewPage(
    viewModel: MapOverviewPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val positionsState by viewModel.positionsState.collectAsStateWithLifecycle()
    val locationState by viewModel.locationState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val mapStyle by viewModel.mapStyle.collectAsStateWithLifecycle()
    val vehicleName by viewModel.selectedVehicleName.collectAsStateWithLifecycle()

    val uriHandler = LocalUriHandler.current
    val onQuickLink: (MapQuickLink) -> Unit =
        remember(uriHandler) { { link -> runCatching { uriHandler.openUri(link.deepLink()) } } }

    MapOverviewPageContent(
        vehiclesState = vehiclesState,
        positionsState = positionsState,
        locationState = locationState,
        prefs = prefs,
        mapStyle = mapStyle,
        vehicleName = vehicleName,
        onSetMapStyle = viewModel::setMapStyle,
        onRetry = viewModel::retry,
        onQuickLink = onQuickLink,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading fleet (with nothing cached) renders the full-page skeleton; otherwise
 * the header is drawn, then either the hard-error retry surface (the declared `useVehicles` source failed with no
 * cache) or the full panel set — each panel renders its own loading / empty / error surface inline so no region
 * ever blanks.
 */
@Composable
fun MapOverviewPageContent(
    vehiclesState: UiState<List<*>>,
    positionsState: UiState<MapOverviewData>,
    locationState: UiState<LocationSnapshot?>,
    prefs: MapOverviewDisplayPrefs,
    mapStyle: MapStyleId,
    vehicleName: String?,
    onSetMapStyle: (MapStyleId) -> Unit,
    onRetry: () -> Unit,
    onQuickLink: (MapQuickLink) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (vehiclesState.isLoading) {
        MapOverviewLoading(modifier)
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        MapOverviewHeader(positionsState = positionsState, vehicleName = vehicleName)

        if (vehiclesState.isError) {
            MapOverviewError(onRetry = onRetry)
            return@Column
        }

        if (positionsState.hasError || locationState.hasError) {
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
                icon = MapOverviewGlyphs.Alert,
            )
        }

        FadeIn { MapPanel(positionsState = positionsState, mapStyle = mapStyle, vehicleName = vehicleName, prefs = prefs, onSetMapStyle = onSetMapStyle, onRetry = onRetry) }
        GpsWarning(positionsState = positionsState)
        FadeIn(delayMs = FADE_STEP_MS) { PlaybackPanel(positionsState = positionsState) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { MetricCardsSection(positionsState = positionsState, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { LocationDetailsPanel(positionsState = positionsState, locationState = locationState, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { QuickLinksPanel(onQuickLink = onQuickLink) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { HistoryPanel(positionsState = positionsState, prefs = prefs) }
    }
}

/** Full-page loading shape (header + map + stat grid) — the first-load skeleton (web `PageContainer loading`). */
@Composable
private fun MapOverviewLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        Skeleton(height = MAP_HEIGHT, rounded = true)
        StatGridSkeleton(count = 4)
    }
}

/** The page header — the title + muted subtitle + the positions-feed freshness chip (web `PageContainer`). */
@Composable
private fun MapOverviewHeader(
    positionsState: UiState<MapOverviewData>,
    vehicleName: String?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_mapOverview_title), modifier = Modifier.semantics { heading() })
            BodyText(
                stringResource(R.string.translation_mapOverview_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (vehicleName != null) Caption(vehicleName)
        }
        DataFreshness(
            updatedAtMillis = positionsState.fetchedAt?.takeIf { it > 0L },
            isFetching = positionsState.refreshing,
            isStale = positionsState.stale,
            isError = positionsState.hasError,
            compact = true,
        )
    }
}

/** The hard-error surface for the declared `useVehicles` feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun MapOverviewError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Lg) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_loadFailed),
            onRetry = onRetry,
        )
    }
}

// ── GlassPanel1 — the interactive map ─────────────────────────────────────────────────────────────────────────

/**
 * The live map panel (web `<GlassPanel className="h-[400px]">`): the base-map [TeslaMap] (= MapContainer +
 * MapTileLayer) carrying the GPS-trail [Polyline] and the heading-aware [VehicleMarker] (whose title is the popup),
 * the floating [MapLayerSwitcher], and a [MapAccessibleSummary] list alternative for the opaque map. Falls back to
 * its own loading skeleton, error-retry, or the "no GPS" empty state so the region never blanks.
 */
@Composable
private fun MapPanel(
    positionsState: UiState<MapOverviewData>,
    mapStyle: MapStyleId,
    vehicleName: String?,
    prefs: MapOverviewDisplayPrefs,
    onSetMapStyle: (MapStyleId) -> Unit,
    onRetry: () -> Unit,
) {
    val data = positionsState.data
    val latest = data?.latest
    val mapLabel = stringResource(R.string.translation_mapOverview_pageTitle)
    val markerName = vehicleName ?: stringResource(R.string.translation_mapOverview_vehicle)
    val noLocation = stringResource(R.string.translation_mapOverview_noLocation)

    GlassPanel(padding = PanelPadding.None) {
        Box(modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT)) {
            when {
                positionsState.isLoading -> Skeleton(modifier = Modifier.fillMaxWidth(), height = MAP_HEIGHT, rounded = true)
                positionsState.isError ->
                    Box(modifier = Modifier.fillMaxSize().padding(Spacing.lg), contentAlignment = Alignment.Center) {
                        ErrorDisplay(message = stringResource(R.string.translation_error_loadFailed), onRetry = onRetry)
                    }
                latest != null && data.hasValidLocation -> {
                    val camera = rememberMapCameraState(CameraSnapshot(latest.point(), MAP_ZOOM))
                    LaunchedEffect(latest.id, latest.latitude, latest.longitude) {
                        camera.position = CameraSnapshot(latest.point(), MAP_ZOOM).toCameraPosition()
                    }
                    val trailColor = TeslaTokens.chart.regen
                    TeslaMap(
                        modifier = Modifier.fillMaxSize(),
                        cameraPositionState = camera,
                        style = mapStyle,
                        contentDescription = mapLabel,
                    ) {
                        if (data.trail.size > 1) {
                            Polyline(
                                points = data.trail.map { it.toLatLng() },
                                color = trailColor.copy(alpha = TRAIL_ALPHA),
                                width = TRAIL_WIDTH,
                            )
                        }
                        VehicleMarker(
                            MapMarker(
                                id = "vehicle",
                                point = latest.point(),
                                title = markerName,
                                headingDegrees = latest.headingDeg,
                            ),
                        )
                    }
                    MapLayerSwitcher(
                        current = mapStyle,
                        onChange = onSetMapStyle,
                        modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.sm),
                    )
                }
                else ->
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        EmptyState(message = noLocation, icon = MapOverviewGlyphs.MapPin)
                    }
            }
        }
        if (latest != null && data.hasValidLocation) {
            MapAccessibleSummary(
                label = stringResource(R.string.translation_mapOverview_title),
                lines = listOf("$markerName · ${latLonText(latest, prefs.locale)}"),
                modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            )
        }
    }
}

/** The web GPS-data warning banner (`!hasValidLocation && latest`) — Fleet-Telemetry streaming is required. */
@Composable
private fun GpsWarning(positionsState: UiState<MapOverviewData>) {
    val data = positionsState.data ?: return
    if (data.latest != null && !data.hasValidLocation) {
        AlertBanner(
            message = stringResource(R.string.translation_mapOverview_noGps),
            tone = Tone.Info,
            icon = MapOverviewGlyphs.Alert,
        )
    }
}

// ── GlassPanel2 — recent route playback ───────────────────────────────────────────────────────────────────────

/** The recent route-playback panel (web `<RoutePlayback>`); shows the replay widget when ≥2 samples, else an empty state. */
@Composable
private fun PlaybackPanel(positionsState: UiState<MapOverviewData>) {
    val playback = positionsState.data?.playback.orEmpty()
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_mapOverview_recentPlayback))
        if (playback.size > 1) {
            RoutePlayback(
                samples = playback,
                heightDp = PLAYBACK_HEIGHT,
                emptyMessage = stringResource(R.string.translation_mapOverview_noHistory),
                mapContentDescription = stringResource(R.string.translation_mapOverview_playbackLabel),
                summaryLabel = stringResource(R.string.translation_mapOverview_recentPlayback),
                modifier = Modifier.padding(top = Spacing.sm),
            )
        } else {
            EmptyState(
                message = stringResource(R.string.translation_mapOverview_noHistory),
                icon = MapsGlyphs.Route,
            )
        }
    }
}

// ── GlassPanel 3-6 — live metric cards ────────────────────────────────────────────────────────────────────────

/**
 * The four live metric cards (web grid): Current Speed, Heading, Lat / Lon, Last Updated. Shows a stat-grid
 * skeleton while the positions feed first-loads; otherwise renders the four cards (em dash when no sample) so the
 * panels are always present.
 */
@Composable
private fun MetricCardsSection(
    positionsState: UiState<MapOverviewData>,
    prefs: MapOverviewDisplayPrefs,
) {
    if (positionsState.isLoading) {
        StatGridSkeleton(count = 4)
        return
    }
    val latest = positionsState.data?.latest
    val speedValue =
        if (latest != null) {
            "${prefs.speedNumber(latest.speedMps)} ${stringResource(R.string.translation_mapOverview_speedUnitValue, prefs.speedUnitLabel)}"
        } else {
            MAP_OVERVIEW_EM_DASH
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            MetricCellCard(
                label = stringResource(R.string.translation_mapOverview_currentSpeed),
                value = speedValue,
                icon = MapOverviewGlyphs.Gauge,
                accent = TeslaTokens.chart.regen,
            )
            MetricCellCard(
                label = stringResource(R.string.translation_mapOverview_heading),
                value = headingText(latest?.headingDeg, prefs.locale),
                icon = MapOverviewGlyphs.Compass,
                accent = TeslaTokens.chart.power,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            MetricCellCard(
                label = stringResource(R.string.translation_mapOverview_latLon),
                value = latLonText(latest, prefs.locale),
                icon = MapOverviewGlyphs.MapPin,
                accent = TeslaTokens.chart.battery,
            )
            MetricCellCard(
                label = stringResource(R.string.translation_mapOverview_lastUpdated),
                value = if (latest != null) lastUpdatedText(latest.createdAt, prefs.locale) else MAP_OVERVIEW_EM_DASH,
                icon = MapOverviewGlyphs.Clock,
                accent = MaterialTheme.colorScheme.primary,
                subtitle = stringResource(R.string.translation_mapOverview_autoRefresh),
            )
        }
    }
}

@Composable
private fun RowScope.MetricCellCard(
    label: String,
    value: String,
    icon: ImageVector,
    accent: Color,
    subtitle: String? = null,
) {
    MetricCard(
        label = label,
        value = value,
        icon = icon,
        accent = accent,
        subtitle = subtitle,
        modifier = Modifier.weight(1f),
    )
}

// ── GlassPanel7 — location details ────────────────────────────────────────────────────────────────────────────

/**
 * The location-detail badges (web "Location Details"): At Home / At Work (tri-state yes/no/unknown), HomeLink
 * Nearby (yes/no), and the Odometer (SI metres ▸ display distance). Falls back to the "no location" empty state.
 */
@Composable
private fun LocationDetailsPanel(
    positionsState: UiState<MapOverviewData>,
    locationState: UiState<LocationSnapshot?>,
    prefs: MapOverviewDisplayPrefs,
) {
    val latest = positionsState.data?.latest
    val location = locationState.data
    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_mapOverview_locationDetails))
        if (latest == null && location == null) {
            EmptyState(message = stringResource(R.string.translation_mapOverview_noLocation))
            return@GlassPanel
        }
        Column(modifier = Modifier.padding(top = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            DetailBadgeRow(
                icon = MapOverviewGlyphs.Home,
                label = stringResource(R.string.translation_mapOverview_atHome),
                state = location?.locatedAtHome,
            )
            DetailBadgeRow(
                icon = MapOverviewGlyphs.Briefcase,
                label = stringResource(R.string.translation_mapOverview_atWork),
                state = location?.locatedAtWork,
            )
            DetailBadgeRow(
                icon = MapOverviewGlyphs.Link,
                label = stringResource(R.string.translation_mapOverview_homelinkNearby),
                state = location?.homelinkNearby,
                infoTone = true,
            )
            DetailValueRow(
                icon = MapsGlyphs.Navigation,
                label = stringResource(R.string.translation_mapOverview_odometer),
                value =
                    latest?.odometerM?.let {
                        "${prefs.distanceNumber(it)} ${stringResource(R.string.translation_mapOverview_distanceUnitValue, prefs.distanceUnitLabel)}"
                    } ?: MAP_OVERVIEW_EM_DASH,
            )
        }
    }
}

/** A tri-state location-detail row: an icon, a label, and a yes / no / unknown badge (web Badge logic). */
@Composable
private fun DetailBadgeRow(
    icon: ImageVector,
    label: String,
    state: Boolean?,
    infoTone: Boolean = false,
) {
    val yes = stringResource(R.string.translation_mapOverview_yes)
    val no = stringResource(R.string.translation_mapOverview_no)
    val unknown = stringResource(R.string.translation_mapOverview_unknown)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        BodyText(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        when (state) {
            true -> Badge(text = yes, variant = if (infoTone) BadgeVariant.Info else BadgeVariant.Success, dot = true)
            false -> Badge(text = no, variant = BadgeVariant.Neutral, dot = true)
            null -> Badge(text = if (infoTone) no else unknown, variant = BadgeVariant.Neutral, dot = true)
        }
    }
}

/** A location-detail row showing a formatted value (the odometer). */
@Composable
private fun DetailValueRow(
    icon: ImageVector,
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        BodyText(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        BodyText(value)
    }
}

// ── GlassPanel8 — quick links ────────────────────────────────────────────────────────────────────────────────

/** The maps quick-links (web "Quick Links"): Navigation Route / Geofences / Locations, each navigating its route. */
@Composable
private fun QuickLinksPanel(onQuickLink: (MapQuickLink) -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        Caption(stringResource(R.string.translation_mapOverview_quickLinks))
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Button(
                label = stringResource(R.string.translation_mapOverview_navRoute),
                onClick = { onQuickLink(MapQuickLink.NavRoute) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = MapsGlyphs.Route,
            )
            Button(
                label = stringResource(R.string.translation_mapOverview_geofences),
                onClick = { onQuickLink(MapQuickLink.Geofences) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = MapOverviewGlyphs.Fence,
            )
            Button(
                label = stringResource(R.string.translation_mapOverview_locations),
                onClick = { onQuickLink(MapQuickLink.Locations) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = MapsGlyphs.Crosshair,
            )
        }
    }
}

// ── GlassPanel9 — recent location history ─────────────────────────────────────────────────────────────────────

/** The recent location-history table (web `DataTable`): time / lat / lon / speed / heading. */
@Composable
private fun HistoryPanel(
    positionsState: UiState<MapOverviewData>,
    prefs: MapOverviewDisplayPrefs,
) {
    val history = positionsState.data?.history.orEmpty()
    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_mapOverview_recentHistory))
        when {
            positionsState.isLoading -> SkeletonLines(lines = 6, modifier = Modifier.padding(top = Spacing.md))
            history.isNotEmpty() -> HistoryTable(history = history, prefs = prefs)
            else ->
                EmptyState(
                    message = stringResource(R.string.translation_mapOverview_noHistory),
                    icon = MapOverviewGlyphs.Clock,
                )
        }
    }
}

@Composable
private fun HistoryTable(
    history: List<PositionRecord>,
    prefs: MapOverviewDisplayPrefs,
) {
    Column(modifier = Modifier.padding(top = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            HistoryHeaderCell(stringResource(R.string.translation_mapOverview_colTime), 1.4f)
            HistoryHeaderCell(stringResource(R.string.translation_mapOverview_colLat), 1f)
            HistoryHeaderCell(stringResource(R.string.translation_mapOverview_colLon), 1f)
            HistoryHeaderCell(stringResource(R.string.translation_mapOverview_colSpeed), 1f)
            HistoryHeaderCell(stringResource(R.string.translation_mapOverview_colHeading), 1f)
        }
        val speedUnit = stringResource(R.string.translation_mapOverview_speedUnitValue, prefs.speedUnitLabel)
        history.forEach { record ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                HistoryCell(timeCell(record.createdAt, prefs.locale), 1.4f)
                HistoryCell(coordCell(record, longitude = false, locale = prefs.locale), 1f)
                HistoryCell(coordCell(record, longitude = true, locale = prefs.locale), 1f)
                HistoryCell("${prefs.speedNumber(record.speedMps)} $speedUnit", 1f)
                HistoryCell(headingText(record.headingDeg, prefs.locale), 1f)
            }
        }
    }
}

@Composable
private fun RowScope.HistoryHeaderCell(
    text: String,
    weight: Float,
) {
    Caption(text, modifier = Modifier.weight(weight))
}

@Composable
private fun RowScope.HistoryCell(
    text: String,
    weight: Float,
) {
    BodyText(text, modifier = Modifier.weight(weight), color = MaterialTheme.colorScheme.onSurfaceVariant)
}
