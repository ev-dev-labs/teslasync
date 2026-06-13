// The native Jetpack Compose + Material 3 VehicleCharts feature view — a parity port of
// web/src/features/vehicles/components/VehicleCharts.tsx. The web component is purely presentational: a
// responsive grid of up to four GlassPanels driven entirely by its props — a live Leaflet map of the vehicle's
// last position (a base-layer switcher + vehicle marker + a cyan speed-trail polyline + a monospace lat/lng
// caption, shown only when `state.latitude && state.longitude`); a "Vehicle Configuration" panel of eighteen
// MetricCards (shown only when `vehicleConfigData`); a "Car Display Preferences" panel of five MetricCards
// (shown only when `userPrefData`); and an always-present "Speed History" panel that draws a Recharts area of
// the position speeds or, with no samples, the localized "Position data will appear here" empty copy.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` -> the generated i18n catalog (P1/S10, resolved into [VehicleChartsStrings]),
// and `useUnits` -> the live shared [io.teslasync.android.data.UnitFormatter] (the SI speed unit + decimal
// precision + locale). The host owns the feed (P1/S8) and supplies the [VehicleChartsSnapshot] through the
// shared cache-then-network [UiState], so this surface renders every lifecycle state that layer can carry —
// loading skeleton, hard error + retry, the content grid, and a stale/offline "last known" freshness chip with
// a refresh — without ever fetching. A web-parity overload that takes the raw snapshot is also provided. Every
// derivation flows through the pure [VehicleChartsProjection]; this file is a thin render layer that resolves
// the i18n labels, maps colours to `TeslaTokens`, builds the map/marker/polyline + the area series, and draws
// what the projection returns.
//
// Colour mapping (P1/S9 tokens, no ported Tailwind / raw hex): the web panel-title accents (cyan / purple /
// amber / cyan) map to the per-theme `TeslaTokens.status` + brand palette, and the web `#00f0ff` speed area +
// trail map to the CB-safe chart palette slot 0 / `TeslaTokens.status.info` — so the surface reads correctly in
// light, dark, and high-contrast themes. The vehicle position uses the shared `VehicleMarker` (the native
// counterpart of the web `vehicleIcon`); the opaque map is paired with a `MapAccessibleSummary` so a TalkBack
// user gets the coordinate. The one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// One non-key string survives, exactly as the web renders it: the em-dash absent-value fallback. The web's
// single non-`t()` helper paragraph under the preferences title ("These are your vehicle's display settings …")
// has no P1/S10 key and the surface forbids hardcoded English, so it is intentionally omitted rather than
// hardcoded — the only structural divergence from the web composition, called out here so nothing drifts
// silently. The configuration / preference cell labels resolve to existing catalog keys (see the
// VehicleChartsModel header's faithful-parity notes).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleCharts — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecharts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.components.maps.MapLayerSwitcher
import io.teslasync.android.components.maps.MapMarker
import io.teslasync.android.components.maps.MapMarkerSeverity
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.VehicleMarker
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The live-map body height — the web `h-72`. */
private val MAP_HEIGHT: Dp = 288.dp

/** The speed chart plot height — the web `h-64`. */
private val CHART_HEIGHT: Dp = 256.dp

/** Loading skeleton bar heights (header bar, then the map + grid blocks). */
private val SKELETON_HEADER_HEIGHT: Dp = 24.dp
private val SKELETON_MAP_HEIGHT: Dp = 220.dp
private val SKELETON_GRID_HEIGHT: Dp = 160.dp

/** Web `weight: 3` Leaflet polyline stroke, in device pixels. */
private const val TRAIL_WIDTH: Float = 6f

/** Web `opacity: 0.6` polyline alpha. */
private const val TRAIL_ALPHA: Float = 0.6f

/** The web `<Area>` categorical slot — web `#00f0ff` -> CB-safe chart palette slot 0. */
private const val SPEED_COLOR_INDEX: Int = 0

/** The speed area series key — the web `<Area dataKey="speed" />`. */
private const val SPEED_KEY: String = "speed"

/**
 * Stateful entry point — the faithful port of the web `VehicleCharts({ state, positions, … })`. Records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition, resolves the live speed-unit /
 * precision / locale from the shared [io.teslasync.android.data.UnitFormatter] (the native binding of the web
 * `useUnits` hook; metric / 2-dp / device-locale defaults apply until settings load), and renders every
 * lifecycle [state] the shared feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's
 * `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [VehicleChartsSnapshot] the Vehicle-detail page computes.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale/offline refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleCharts(
    state: UiState<VehicleChartsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { VehicleChartsDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs =
        remember(formatter) {
            VehicleChartsDisplayPrefs(
                speed = formatter.prefs.speed,
                precision = formatter.prefs.precision ?: VehicleChartsDisplayPrefs.DEFAULT_PRECISION,
                locale = localeOf(formatter.prefs.locale),
            )
        }
    VehicleChartsContent(state = state, onRetry = onRetry, modifier = modifier, prefs = prefs)
}

/**
 * Web-parity convenience overload for a host that already holds a [VehicleChartsSnapshot] (the web `{ state,
 * positions, vehicleConfigData, userPrefData }` props): projects it onto a content [UiState] and renders. With
 * no fetch behind it, it offers no retry affordance.
 */
@Composable
fun VehicleCharts(
    snapshot: VehicleChartsSnapshot,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    VehicleCharts(
        state = VehicleChartsProjection.projectUiState(snapshot, isLoading = false),
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Short-circuits to the
 * loading skeleton, the hard-error retry surface, or the friendly empty state (a null snapshot); otherwise
 * renders the panel grid (the live map, the configuration + preference grids, and the always-present speed
 * panel), with a stale/offline freshness chip + auto-refresh when cached data is being shown.
 * [prefs] are the web `useUnits` outputs; [zone] anchors the chart's `formatTime` labels.
 */
@Composable
fun VehicleChartsContent(
    state: UiState<VehicleChartsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    prefs: VehicleChartsDisplayPrefs = VehicleChartsDisplayPrefs.DEFAULT,
    zone: ZoneId = ZoneId.systemDefault(),
    strings: VehicleChartsStrings = rememberVehicleChartsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(kind = state.toQueryErrorKind(), onRetry = onRetry, modifier = modifier)
        snapshot == null -> EmptyChrome(message = strings.positionDataWillAppear, modifier = modifier)
        else -> {
            val display =
                remember(snapshot, prefs, strings, zone) {
                    VehicleChartsProjection.project(snapshot, prefs, strings, zone)
                }
            VehicleChartsBody(state = state, display = display, strings = strings, onRetry = onRetry, modifier = modifier)
        }
    }
}

@Composable
private fun VehicleChartsBody(
    state: UiState<VehicleChartsSnapshot>,
    display: VehicleChartsDisplay,
    strings: VehicleChartsStrings,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        if (state.refreshing || state.stale || state.hasError) {
            FreshnessRow(state = state, onRetry = onRetry)
        }
        if (display.hasLocation) {
            LocationPanel(display = display, strings = strings)
        }
        if (display.hasConfig) {
            MetricGridPanel(
                icon = VehicleChartsGlyphs.Car,
                tint = MaterialTheme.colorScheme.primary,
                title = strings.vehicleConfig,
                items = display.configItems,
            )
        }
        if (display.hasPreferences) {
            MetricGridPanel(
                icon = VehicleChartsGlyphs.Settings,
                tint = TeslaTokens.status.warning,
                title = strings.carPreferences,
                items = display.preferenceItems,
            )
        }
        SpeedHistoryPanel(display = display, strings = strings)
    }
}

/**
 * The live-location panel — the web `state.latitude && state.longitude` map: a base map with the vehicle marker
 * + the speed-trail polyline, a base-layer switcher, the monospace lat/lng caption, and a screen-reader summary.
 * The maps SDK needs Google Play Services on the device, so the opaque map body is covered in app; the caption +
 * summary render SDK-free.
 */
@Composable
private fun LocationPanel(
    display: VehicleChartsDisplay,
    strings: VehicleChartsStrings,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
            Column(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
                PanelHeader(icon = MapsGlyphs.Navigation, tint = TeslaTokens.status.info, title = strings.location)
            }
            LocationMapBody(display = display, contentDescription = strings.location)
            display.coordsText?.let { coords ->
                Box(
                    modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
                    contentAlignment = Alignment.Center,
                ) {
                    Caption(coords)
                }
            }
            MapAccessibleSummary(
                label = strings.location,
                lines = display.mapSummaryLines,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            )
        }
    }
}

@Composable
private fun LocationMapBody(
    display: VehicleChartsDisplay,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val center = display.center ?: return
    var mapStyle by remember { mutableStateOf(MapStyleId.Dark) }
    val camera = rememberMapCameraState(CameraSnapshot(center, VEHICLE_CHARTS_MAP_ZOOM))
    val trailColor = TeslaTokens.status.info
    Box(modifier = modifier.fillMaxWidth().height(MAP_HEIGHT)) {
        TeslaMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            style = mapStyle,
            contentDescription = contentDescription,
        ) {
            VehicleMarker(
                marker = MapMarker(id = "vehicle", point = center, title = contentDescription, severity = MapMarkerSeverity.Active),
            )
            if (display.trail.size > 1) {
                Polyline(
                    points = display.trail.map { it.toLatLng() },
                    color = trailColor.copy(alpha = TRAIL_ALPHA),
                    width = TRAIL_WIDTH,
                )
            }
        }
        MapLayerSwitcher(
            current = mapStyle,
            onChange = { mapStyle = it },
            modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.sm),
        )
    }
}

/**
 * A titled GlassPanel hosting a two-column MetricCard grid — the web "Vehicle Configuration" / "Car Display
 * Preferences" panels. Each cell renders its already-localized label + value; an absent value reads the em-dash,
 * so the grid never collapses to a blank box.
 */
@Composable
private fun MetricGridPanel(
    icon: ImageVector,
    tint: Color,
    title: String,
    items: List<VehicleChartMetric>,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            PanelHeader(icon = icon, tint = tint, title = title)
            Spacer(Modifier.height(Spacing.md))
            MetricGrid(items = items)
        }
    }
}

@Composable
private fun MetricGrid(
    items: List<VehicleChartMetric>,
    modifier: Modifier = Modifier,
    columns: Int = 2,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        items.chunked(columns).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowItems.forEach { item ->
                    MetricCard(label = item.label, value = item.value, modifier = Modifier.weight(1f))
                }
                repeat(columns - rowItems.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * The always-present "Speed History" panel — the web `batteryData.length > 0 ? <AreaChart> : <empty>`: the
 * reversed per-sample speed area (in the user's unit) or the localized "Position data will appear here" empty
 * state, so the panel is never hidden.
 */
@Composable
private fun SpeedHistoryPanel(
    display: VehicleChartsDisplay,
    strings: VehicleChartsStrings,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            PanelHeader(icon = VehicleChartsGlyphs.Activity, tint = TeslaTokens.status.info, title = strings.speedHistory)
            Spacer(Modifier.height(Spacing.md))
            if (display.hasSpeedData) {
                AreaChartWrapper(
                    series =
                        listOf(
                            ChartSeries(
                                key = SPEED_KEY,
                                label = display.speedSeriesName,
                                values = display.speedValues,
                                kind = ChartSeriesKind.Area,
                                color = paletteColor(SPEED_COLOR_INDEX),
                                unit = display.speedUnitLabel,
                            ),
                        ),
                    xLabels = display.speedLabels,
                    height = CHART_HEIGHT,
                    emptyMessage = strings.positionDataWillAppear,
                )
            } else {
                Box(
                    modifier = Modifier.fillMaxWidth().height(CHART_HEIGHT),
                    contentAlignment = Alignment.Center,
                ) {
                    EmptyState(message = strings.positionDataWillAppear, icon = VehicleChartsGlyphs.Activity)
                }
            }
        }
    }
}

/** The icon + localized title row shared by every panel header; the title carries the TalkBack heading role. */
@Composable
private fun PanelHeader(
    icon: ImageVector,
    tint: Color,
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = tint)
        SectionTitle(title, modifier = Modifier.semantics { heading() })
    }
}

/**
 * The honest "last known + retry" affordance shown above the grid while cached data is refreshing / stale /
 * offline — a freshness chip (offline reads the localized "Offline" label; a stale-but-reachable value reads its
 * relative age) plus the refresh control. Carries no English literal.
 */
@Composable
private fun FreshnessRow(
    state: UiState<VehicleChartsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberFreshnessFormatter(),
        )
        Spacer(Modifier.weight(1f))
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRetry,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun LoadingChrome(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = SKELETON_HEADER_HEIGHT, rounded = true)
        Skeleton(height = SKELETON_MAP_HEIGHT, rounded = true)
        Skeleton(height = SKELETON_GRID_HEIGHT, rounded = true)
    }
}

@Composable
private fun ErrorChrome(
    kind: QueryErrorKind,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        QueryError(kind = kind, onRetry = onRetry, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun EmptyChrome(
    message: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        EmptyState(message = message, icon = VehicleChartsGlyphs.Activity, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * Builds the localized [VehicleChartsStrings] from the i18n catalog (P1/S10): the four `common.*` panel titles +
 * the empty/series copy the web resolves via `t(...)`, plus the configuration / preference cell labels + boolean
 * value words resolved to existing catalog keys. Remembered against the resolved strings so a locale change
 * re-projects.
 */
@Composable
private fun rememberVehicleChartsStrings(): VehicleChartsStrings {
    val s =
        VehicleChartsStrings(
            location = stringResource(R.string.translation_common_location),
            vehicleConfig = stringResource(R.string.translation_common_vehicleConfig),
            carPreferences = stringResource(R.string.translation_common_carPreferences),
            speedHistory = stringResource(R.string.translation_common_speedHistory),
            positionDataWillAppear = stringResource(R.string.translation_common_positionDataWillAppear),
            speed = stringResource(R.string.translation_common_speed),
            model = stringResource(R.string.translation_vehicles_detail_carType),
            trim = stringResource(R.string.translation_vehicles_detail_trim),
            color = stringResource(R.string.translation_vehicles_detail_color),
            roof = stringResource(R.string.translation_vehicles_detail_roofColor),
            wheels = stringResource(R.string.translation_vehicles_detail_wheels),
            firmware = stringResource(R.string.translation_vehicleHero_stat_firmware),
            name = stringResource(R.string.translation_Name),
            chargePort = stringResource(R.string.translation_vehicles_detail_chargePort),
            rearHeaters = stringResource(R.string.translation_vehicles_detail_rearSeatHeaters),
            efficiency = stringResource(R.string.translation_Efficiency),
            sunroof = stringResource(R.string.translation_vehicles_detail_sunroofInstalled),
            europeVehicle = stringResource(R.string.translation_vehicles_detail_europeVehicle),
            rhd = stringResource(R.string.translation_vehicles_detail_rhd),
            remoteStart = stringResource(R.string.translation_telemetry_remoteStart),
            offroadLightbar = stringResource(R.string.translation_vehicles_detail_offroadLightbar),
            swUpdate = stringResource(R.string.translation_widget_softwareUpdate),
            swDownload = stringResource(R.string.translation_Download),
            swInstall = stringResource(R.string.translation_automations_presets_install),
            prefDistance = stringResource(R.string.translation_common_distance),
            prefTemperature = stringResource(R.string.translation_range_temperature),
            prefChargeUnit = stringResource(R.string.translation_energy_products_charge),
            prefTirePressure = stringResource(R.string.translation_common_tirePressure),
            pref24hTime = stringResource(R.string.translation_app_clock24h),
            yes = stringResource(R.string.translation_common_yes),
            no = stringResource(R.string.translation_common_no),
            active = stringResource(R.string.translation_common_active),
            off = stringResource(R.string.translation_common_off),
            none = stringResource(R.string.translation_None),
        )
    return remember(s) { s }
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
                FreshnessAge.Unknown -> VEHICLE_CHARTS_EM_DASH
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

/** BCP-47 tag -> [Locale], falling back to the device locale for a blank/invalid tag. */
private fun localeOf(tag: String?): Locale {
    if (tag.isNullOrBlank()) return Locale.getDefault()
    val parsed = Locale.forLanguageTag(tag)
    return if (parsed.language.isNullOrBlank()) Locale.getDefault() else parsed
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_SNAPSHOT =
    VehicleChartsSnapshot(
        latitude = 47.6062,
        longitude = -122.3321,
        positions =
            listOf(
                VehicleChartsPosition(ts = "2026-03-14T09:15:00Z", latitude = 47.610, longitude = -122.330, speedMps = 0.0),
                VehicleChartsPosition(ts = "2026-03-14T09:16:00Z", latitude = 47.612, longitude = -122.333, speedMps = 12.0),
                VehicleChartsPosition(ts = "2026-03-14T09:17:00Z", latitude = 47.615, longitude = -122.338, speedMps = 24.0),
            ),
        config =
            VehicleChartsConfig(
                carType = "models2",
                trim = "P100D",
                exteriorColor = "MidnightSilver",
                europeVehicle = false,
                rightHandDrive = false,
                remoteStartEnabled = true,
                offroadLightbarPresent = false,
                softwareUpdateDownloadPct = 100.0,
                softwareUpdateInstallPct = 40.0,
            ),
        preferences =
            VehicleChartsPreferences(
                setting24hrTime = true,
                settingChargeUnit = "ChargeUnitPercent",
                settingDistanceUnit = "DistanceUnitMiles",
                settingTemperatureUnit = "TemperatureUnitFahrenheit",
                settingTirePressureUnit = "PressureUnitPsi",
            ),
    )

@Preview(name = "Content", showBackground = true, widthDp = 360)
@Composable
private fun VehicleChartsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleChartsContent(
            state = VehicleChartsProjection.projectUiState(PREVIEW_SNAPSHOT, isLoading = false),
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Empty speed (no positions)", showBackground = true, widthDp = 360)
@Composable
private fun VehicleChartsEmptySpeedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleChartsContent(
            state = VehicleChartsProjection.projectUiState(VehicleChartsSnapshot(), isLoading = false),
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun VehicleChartsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleChartsContent(state = UiState(UiPhase.Loading), onRetry = {}, zone = ZoneId.of("UTC"))
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 360)
@Composable
private fun VehicleChartsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleChartsContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            zone = ZoneId.of("UTC"),
        )
    }
}
