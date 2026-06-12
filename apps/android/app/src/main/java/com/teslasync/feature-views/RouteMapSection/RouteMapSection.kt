// The native Jetpack Compose + Material 3 RouteMapSection feature view — a parity port of
// web/src/features/driving/components/drive-detail/RouteMapSection.tsx. The web component is one section of the
// drive-detail page: a translucent panel titled "Route" carrying a fixed-height Leaflet map of the drive's GPS
// trail — a speed-coloured polyline (four bands), a green start dot, a red end dot, and a base-layer switcher —
// above a legend row (the start time, the four speed-band swatches + the speed unit, and the end time, or the
// localized "In progress" copy while the drive is live). When the recorded GPS is a single stationary cluster
// it instead drops one "last known location" anchor marker and overlays an explanatory banner; when there is no
// route data at all it shows a friendly empty state.
//
// The surface binds NO data hook of its own (web parity): the drive-detail page owns the drive query and
// computes the route source / trail / segments, threading them in as a [RouteMapSnapshot] carried on the shared
// cache-then-network [UiState] (P1/S8) — so this view also renders every lifecycle state that layer can carry
// (a loading skeleton, a hard error + retry, the content map, and a stale/offline "last known" freshness chip)
// without ever fetching, exactly like the sibling DriveStatCards port. Its web hooks map natively as:
// `useTranslation` → the generated i18n catalog (P1/S10); `useUnits` → the live S8 SettingsStore (the SI speed
// unit applied to the legend thresholds at this boundary); `useMap` → the inline FitBounds camera intent,
// reproduced through `rememberMapCameraState` + a bounds fit. Every derivation flows through the pure
// [RouteMapProjection]; the composable is a thin render layer that resolves the i18n labels, maps each
// [SpeedBand] to its `TeslaTokens.status` colour, and draws what the projection returns.
//
// Colour mapping (P1/S9 tokens, no ported Tailwind): the four web hex speed colours are byte-identical to the
// dark `TeslaTokens.status` palette — emerald `#10b981` → `status.success`, neon-cyan `#00f0ff` →
// `status.info`, amber `#f59e0b` → `status.warning`, red `#ef4444` → `status.danger` — so the polyline + legend
// read correctly in light, dark, and high-contrast themes. The start/end dots reuse the shared
// `routeStartColor()` / `routeEndColor()` (success / danger); the stationary anchor uses `status.info`.
//
// Map rendering: the base map is the shared `TeslaMap` wrapper, the start/end/anchor markers are the shared
// `MapDotMarker`, the base-layer control is the shared `MapLayerSwitcher`, and the opaque map is paired with a
// `MapAccessibleSummary` list alternative so a screen-reader user gets the start/end (or stationary) detail. The
// speed-coloured trail is drawn with Google Maps Compose `Polyline` directly inside the `TeslaMap` content slot:
// the maps layer ships no multi-colour polyline wrapper and extending `components/maps` is out of this surface's
// scope (atomic shared components are a separate prompt), so — exactly as the maps layer's own `RoutePlayback`
// does — the trail polylines are composed here. The one-shot PII-safe `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RouteMapSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.routemapsection

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.components.maps.MapDotMarker
import io.teslasync.android.components.maps.MapLayerSwitcher
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.boundsOf
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.routeEndColor
import io.teslasync.android.components.maps.routeStartColor
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.maps.toLatLngBounds
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.time.ZoneId
import java.util.Locale

/** The map body height — the web `h-64 sm:h-80 lg:h-96`, taking the `sm` tier as the phone default. */
private val ROUTE_MAP_HEIGHT: Dp = 320.dp

/** Loading skeleton header-bar height. */
private val SKELETON_HEADER_HEIGHT: Dp = 20.dp

/** Web `weight: 4` Leaflet polyline stroke, in device pixels. */
private const val TRAIL_WIDTH: Float = 8f

/** Web `opacity: 0.8` polyline alpha. */
private const val TRAIL_ALPHA: Float = 0.85f

/** Bounds-fit camera padding in pixels (the web FitBounds `padding: [30, 30]`, scaled for the denser map). */
private const val BOUNDS_PADDING_PX: Int = 64

/** Web legend swatch `w-3` width. */
private val LEGEND_SWATCH_WIDTH: Dp = 12.dp

/** Web legend swatch `h-1` height. */
private val LEGEND_SWATCH_HEIGHT: Dp = 4.dp

/** Default decimal precision before settings load (web `useFormatting` `userPrecision` fallback). */
private const val DEFAULT_PRECISION: Int = 2

/**
 * Stateful entry point — the faithful port of the web `RouteMapSection({ drive, … })`. Records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11) on first composition, resolves the live speed-unit preference from
 * the shared S8 SettingsStore (the native binding of the web `useUnits` hook; metric/2-dp/device-locale defaults
 * apply until settings load), and renders every lifecycle [state] the shared drive feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [RouteMapSnapshot] the drive-detail page computes.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale/offline refresh.
 * @param settings the shared live `/settings` feed backing the speed unit + precision + locale.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RouteMapSection(
    state: UiState<RouteMapSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RouteMapSectionDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val deviceLocale: Locale = LocalConfiguration.current.locales[0]
    val prefs = rememberRouteMapPrefs(settingsResource, deviceLocale)
    RouteMapSectionContent(state = state, prefs = prefs, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity convenience overload for a host that already holds a [RouteMapSnapshot] (the web `{ drive, … }`
 * props): projects it onto a content [UiState] and renders. Useful for embedding without the cache-then-network
 * lifecycle plumbing.
 */
@Composable
fun RouteMapSection(
    snapshot: RouteMapSnapshot,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    RouteMapSection(
        state = RouteMapProjection.projectUiState(snapshot, isLoading = false),
        onRetry = {},
        modifier = modifier,
        settings = settings,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Short-circuits to the
 * loading skeleton or the hard-error retry surface; otherwise renders the "Route" panel with the freshness
 * header over the map (the speed-coloured trail + markers, or the stationary anchor + banner) and the bottom
 * legend row, or the friendly "No route data available for this drive" empty state when the trail is empty.
 */
@Composable
fun RouteMapSectionContent(
    state: UiState<RouteMapSnapshot>,
    prefs: RouteMapDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
) {
    val strings = rememberRouteMapStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(kind = state.toQueryErrorKind(), onRetry = onRetry, modifier = modifier)
        else -> {
            val snapshot = state.data
            val display =
                remember(snapshot, prefs, strings, zone) {
                    snapshot?.let { RouteMapProjection.project(it, prefs, strings, zone) }
                }
            RouteMapPanel(state = state, display = display, strings = strings, onRetry = onRetry, modifier = modifier)
        }
    }
}

@Composable
private fun RouteMapPanel(
    state: UiState<RouteMapSnapshot>,
    display: RouteMapDisplay?,
    strings: RouteMapStrings,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.None) {
        Column(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
            RouteMapHeader(
                title = strings.route,
                fetchedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                onRefresh = onRetry,
            )
        }
        if (display != null && display.hasTrail) {
            RouteMapBody(display = display, strings = strings)
            RouteMapLegendRow(display = display, strings = strings)
            MapAccessibleSummary(
                label = strings.route,
                lines = display.summaryLines,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            )
        } else {
            RouteMapEmpty(message = strings.noRouteData)
        }
    }
}

/**
 * The freshness + refresh header — the native chrome hosting the state-matrix affordances the web panel omits
 * (the web drive-detail page owns refresh). Shows the map-pin icon + the localized "Route" title, the freshness
 * chip (which surfaces the stale / offline state), and the refresh control. `internal` so it is asserted in the
 * UI test without a live base map.
 */
@Composable
internal fun RouteMapHeader(
    title: String,
    fetchedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val formatAge = rememberFreshnessFormatter()
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(TeslaGlyphs.Pin, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = fetchedAtMillis?.takeIf { it > 0 },
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !isFetching,
            size = IconSize.Sm,
        )
    }
}

/**
 * The live base map — the native analogue of the web `<MapContainer>`. Carries the speed-coloured trail
 * polylines + the start/end dots (a meaningful route), or the single "last known location" anchor + the
 * stationary-route banner overlay. The camera fits the trail bounds once the map loads (the web FitBounds). The
 * base-layer switcher overlays a corner. The opaque map node carries the accessible route name. The maps SDK is
 * reached only for the multi-colour polylines (no shared wrapper exists; see the file header).
 */
@Composable
private fun RouteMapBody(
    display: RouteMapDisplay,
    strings: RouteMapStrings,
    modifier: Modifier = Modifier,
) {
    var mapStyle by remember { mutableStateOf(MapStyleId.Dark) }
    val camera = rememberMapCameraState(CameraSnapshot(display.center, display.zoom))
    var mapLoaded by remember { mutableStateOf(false) }
    val palette = rememberSpeedBandPalette()
    val startColor = routeStartColor()
    val endColor = routeEndColor()
    val anchorColor = TeslaTokens.status.info
    val startTitle = "${strings.start} \u2014 ${display.startPopupText}"
    val endTitle = "${strings.end} \u2014 ${display.endPopupText}"

    LaunchedEffect(mapLoaded, display) {
        if (mapLoaded) fitRouteCamera(camera, display)
    }

    Box(modifier = modifier.fillMaxWidth().height(ROUTE_MAP_HEIGHT)) {
        TeslaMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            style = mapStyle,
            contentDescription = strings.route,
            onMapLoaded = { mapLoaded = true },
        ) {
            if (display.hasRoute) {
                display.segments.forEach { segment ->
                    Polyline(
                        points = segment.points.map { it.toLatLng() },
                        color = (palette[segment.band] ?: startColor).copy(alpha = TRAIL_ALPHA),
                        width = TRAIL_WIDTH,
                    )
                }
                display.startPos?.let { MapDotMarker(point = it, color = startColor, title = startTitle) }
                display.endPos?.let { MapDotMarker(point = it, color = endColor, title = endTitle) }
            } else {
                display.anchorPoint?.let { MapDotMarker(point = it, color = anchorColor, title = strings.lastKnown) }
            }
        }
        MapLayerSwitcher(
            current = mapStyle,
            onChange = { mapStyle = it },
            modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.sm),
        )
        if (!display.hasRoute) {
            AlertBanner(
                message = strings.stationaryBody,
                tone = Tone.Info,
                title = strings.stationaryTitle,
                icon = MapsGlyphs.Navigation,
                modifier = Modifier.align(Alignment.TopCenter).padding(Spacing.sm),
            )
        }
    }
}

/**
 * The bottom legend row (web `flex items-center justify-between`): the green-flagged start time, the four
 * speed-band swatches + the speed unit (a meaningful multi-point route only), and the red-flagged end time (or
 * nothing while the drive is in progress). Each endpoint cell is merged into a single localized TalkBack label.
 */
@Composable
private fun RouteMapLegendRow(
    display: RouteMapDisplay,
    strings: RouteMapStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        RouteEndpointLabel(
            label = strings.start,
            time = display.startTimeText,
            tint = TeslaTokens.status.success,
        )
        if (display.showLegend) {
            SpeedLegend(items = display.legend, unit = display.speedUnitLabel)
        }
        if (display.endTimeText != null) {
            RouteEndpointLabel(
                label = strings.end,
                time = display.endTimeText,
                tint = TeslaTokens.status.danger,
            )
        }
    }
}

/**
 * One flagged endpoint (web `<span class="text-green-400|text-red-400"><Flag/>{label}: {time}</span>`): the
 * small flag marker and the "{label}: {time}" text, both [tint]ed. The flag is decorative; the cell collapses
 * into a single localized label ("[label], [time]") for TalkBack.
 */
@Composable
private fun RouteEndpointLabel(
    label: String,
    time: String,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = "$label, $time" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(RouteMapSectionGlyphs.Flag, contentDescription = null, size = IconSize.Xs, tint = tint)
        Text(
            text = "$label: $time",
            style = MaterialTheme.typography.labelMedium,
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The four speed-band swatches + their range labels + the unit (web's coloured spans + `{speedUnit}`). The
 * swatches are decorative bars cleared from the semantics tree; the range labels + unit carry the information.
 */
@Composable
private fun SpeedLegend(
    items: List<SpeedLegendItem>,
    unit: String,
    modifier: Modifier = Modifier,
) {
    val palette = rememberSpeedBandPalette()
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        items.forEach { item ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Box(
                    modifier =
                        Modifier
                            .width(LEGEND_SWATCH_WIDTH)
                            .height(LEGEND_SWATCH_HEIGHT)
                            .clip(CircleShape)
                            .background(palette[item.band] ?: MaterialTheme.colorScheme.primary)
                            .clearAndSetSemantics {},
                )
                Caption(item.range)
            }
        }
        Caption(unit)
    }
}

@Composable
private fun RouteMapEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().height(ROUTE_MAP_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = message, icon = TeslaGlyphs.Pin)
    }
}

@Composable
private fun LoadingChrome(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(height = SKELETON_HEADER_HEIGHT, rounded = true)
        Skeleton(height = ROUTE_MAP_HEIGHT, rounded = true)
    }
}

@Composable
private fun ErrorChrome(
    kind: QueryErrorKind,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        QueryError(kind = kind, onRetry = onRetry, modifier = Modifier.fillMaxWidth())
    }
}

/** Resolves the four [SpeedBand] swatch/line colours from the per-theme `TeslaTokens.status` palette. */
@Composable
private fun rememberSpeedBandPalette(): Map<SpeedBand, Color> {
    val status = TeslaTokens.status
    return remember(status) {
        mapOf(
            SpeedBand.Low to status.success,
            SpeedBand.Moderate to status.info,
            SpeedBand.Fast to status.warning,
            SpeedBand.VeryFast to status.danger,
        )
    }
}

/**
 * Resolves the speed-unit + precision + locale this surface needs from the raw `/settings` document — the
 * native binding of the web `useUnits` read. [deviceLocale] is the cold-start fallback before settings carry a
 * locale.
 */
@Composable
private fun rememberRouteMapPrefs(
    settings: Resource<JsonElement>,
    deviceLocale: Locale,
): RouteMapDisplayPrefs =
    remember(settings, deviceLocale) {
        val units = UnitPreferences.fromSettings(settings.cached)
        RouteMapDisplayPrefs(
            speed = units.speed,
            precision = units.precision ?: DEFAULT_PRECISION,
            locale = localeFor(units.locale, deviceLocale),
        )
    }

/** BCP-47 tag → [Locale], falling back to the device locale for a blank/invalid tag. */
private fun localeFor(
    tag: String?,
    fallback: Locale,
): Locale {
    if (tag.isNullOrBlank()) return fallback
    val parsed = Locale.forLanguageTag(tag)
    return if (parsed.language.isNullOrBlank()) fallback else parsed
}

/**
 * Builds the localized [RouteMapStrings] from the i18n catalog (P1/S10) — the `t('driveDetail.*')` keys the web
 * component uses (route, start, end, inProgress, lastKnown, the stationary-route banner head + body, and the
 * empty-state message).
 */
@Composable
private fun rememberRouteMapStrings(): RouteMapStrings {
    val route = stringResource(R.string.translation_driveDetail_route)
    val start = stringResource(R.string.translation_driveDetail_start)
    val end = stringResource(R.string.translation_driveDetail_end)
    val inProgress = stringResource(R.string.translation_driveDetail_inProgress)
    val lastKnown = stringResource(R.string.translation_driveDetail_lastKnown)
    val stationaryTitle = stringResource(R.string.translation_driveDetail_stationaryRouteTitle)
    val stationaryBody = stringResource(R.string.translation_driveDetail_stationaryRouteBody)
    val noRouteData = stringResource(R.string.translation_driveDetail_noRouteData)
    return remember(route, start, end, inProgress, lastKnown, stationaryTitle, stationaryBody, noRouteData) {
        RouteMapStrings(
            route = route,
            start = start,
            end = end,
            inProgress = inProgress,
            lastKnown = lastKnown,
            stationaryTitle = stationaryTitle,
            stationaryBody = stationaryBody,
            noRouteData = noRouteData,
        )
    }
}

/**
 * The `translation_freshness_*`-backed relative-time formatter shared with the freshness chip's TalkBack
 * description, so the header microcopy stays localized (ADR-014).
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> ROUTE_MAP_EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Fits the camera to the route — the web FitBounds: a multi-point meaningful route frames the whole trail's
 * bounds; otherwise the camera centres on the stationary anchor (or the start) at the close-up zoom, or on the
 * computed centre when nothing renders.
 */
private suspend fun fitRouteCamera(
    camera: CameraPositionState,
    display: RouteMapDisplay,
) {
    if (display.hasRoute && display.trail.size > 1) {
        val bounds = boundsOf(display.trail)
        if (bounds != null) {
            runCatching {
                camera.animate(CameraUpdateFactory.newLatLngBounds(bounds.toLatLngBounds(), BOUNDS_PADDING_PX))
            }
            return
        }
    }
    val focus = display.anchorPoint ?: display.startPos
    camera.position =
        if (focus != null) {
            CameraSnapshot(focus, ROUTE_ANCHOR_ZOOM).toCameraPosition()
        } else {
            CameraSnapshot(display.center, display.zoom).toCameraPosition()
        }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_ROUTE =
    RouteMapSnapshot(
        routePoints =
            listOf(
                RouteMapPoint(47.610, -122.330, 5.0),
                RouteMapPoint(47.612, -122.333, 18.0),
                RouteMapPoint(47.615, -122.338, 30.0),
                RouteMapPoint(47.620, -122.345, 46.0),
            ),
        positions =
            listOf(
                RouteMapLatLng(47.610, -122.330),
                RouteMapLatLng(47.620, -122.345),
            ),
        startTs = "2026-03-14T09:15:00Z",
        endTs = "2026-03-14T09:42:00Z",
        startLat = 47.610,
        startLon = -122.330,
    )

private val PREVIEW_STATIONARY =
    RouteMapSnapshot(
        routePoints = listOf(RouteMapPoint(47.610, -122.330, 0.0), RouteMapPoint(47.610, -122.330, 0.0)),
        positions = listOf(RouteMapLatLng(47.610, -122.330), RouteMapLatLng(47.610001, -122.330001)),
        startTs = "2026-03-14T09:15:00Z",
        endTs = null,
        startLat = 47.610,
        startLon = -122.330,
    )

@Preview(name = "Route — content", showBackground = true, widthDp = 360)
@Composable
private fun RouteMapRoutePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteMapSectionContent(
            state = RouteMapProjection.projectUiState(PREVIEW_ROUTE, isLoading = false),
            prefs = RouteMapDisplayPrefs.DEFAULT,
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Stationary — in progress", showBackground = true, widthDp = 360)
@Composable
private fun RouteMapStationaryPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteMapSectionContent(
            state = RouteMapProjection.projectUiState(PREVIEW_STATIONARY, isLoading = false),
            prefs = RouteMapDisplayPrefs.DEFAULT,
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 360)
@Composable
private fun RouteMapEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteMapSectionContent(
            state = UiState(UiPhase.Empty),
            prefs = RouteMapDisplayPrefs.DEFAULT,
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun RouteMapLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteMapSectionContent(
            state = UiState(UiPhase.Loading),
            prefs = RouteMapDisplayPrefs.DEFAULT,
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 360)
@Composable
private fun RouteMapErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteMapSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = RouteMapDisplayPrefs.DEFAULT,
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}
