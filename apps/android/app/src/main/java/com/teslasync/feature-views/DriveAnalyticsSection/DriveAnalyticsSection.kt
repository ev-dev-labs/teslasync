// The native Jetpack Compose + Material 3 Drive Analytics section feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx. The web component wraps a
// `<FadeIn>` header (`Drive Analytics` + a `RangePicker` date filter) over three always-visible charts:
//   1. Speed Distribution    — a Recharts `<BarChart>` of drive count per average-speed bucket.
//   2. Acceleration Patterns — a `<ScatterChart>` of peak power vs trip distance + an `Avg` `<ReferenceLine>`.
//   3. Power Profile         — an `<AreaChart>` of the last-20 drives' peak (+ flat-zero regen) power + legend.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation` -> the i18n catalog, and `useUnits` -> the resolved [UnitPref]). The host owns
// the drive feed (P1/S8) and supplies it as a UiState<List<DriveAnalyticsDrive>>; this surface is
// self-contained, owning the date-range filter the web renders inside the section (the native
// [DateRangeFilter], the web `RangePicker`) defaulted to the web's last-30-days window. It renders every
// lifecycle state that layer can carry — a loading skeleton, a hard-error retry surface, per-chart empty
// states, content, and stale/offline ("last known") with an auto-refresh — plus the header + filter the web
// always shows.
//
// Charts map to the shared chart layer ([BarChartWrapper], [AreaChartWrapper], [ChartContainer],
// [ChartLegend]) — feature views must not import Vico directly. The shared layer has no scatter primitive, so
// Acceleration Patterns is a small bespoke Compose [Canvas] (allowed: no Vico, no edit to the shared layer)
// driven entirely by the unit-tested [AccelScatterProjection] geometry, including the web `<ReferenceLine>`
// average. Colors map to design tokens (never raw hex in render code): the speed bars + the power "Max" area
// -> the web `#3b82f6` [TeslaTokens.chart.speed]; the scatter points -> the web `#a855f7`
// [TeslaTokens.chart.power]; the regen "Min" area -> the web `#ef4444` [TeslaTokens.status.danger]; the
// average reference line -> [TeslaTokens.status.warning], the token nearest the web `#eab308` avg marker.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DriveAnalyticsSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.driveanalyticssection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The web `height={300}` Speed Distribution / Acceleration Patterns plots. */
private val CHART_HEIGHT: Dp = 300.dp

/** The web `height={320}` Power Profile plot. */
private val POWER_HEIGHT: Dp = 320.dp

/** Scatter point radius + axis rule stroke for the bespoke Acceleration Patterns canvas. */
private val SCATTER_POINT_RADIUS: Dp = 4.dp
private val AXIS_STROKE: Dp = 1.dp

/** Scatter point fill opacity and the dashed-average on/off run (px) — the web `strokeDasharray="4 4"`. */
private const val POINT_ALPHA: Float = 0.85f
private const val DASH_ON: Float = 10f
private const val DASH_OFF: Float = 10f

/** The fixed power display unit suffix — the web `<YAxis unit=" kW" />` (no `useUnits` power preference). */
private const val POWER_UNIT: String = "kW"

/** Integer axis ticks for counts / kW (web integer `<YAxis />`); the scatter axis captions keep one decimal. */
private const val COUNT_DECIMALS: Int = 0
private const val POWER_DECIMALS: Int = 0
private const val SCATTER_DECIMALS: Int = 1

/** One loading skeleton per always-visible chart section. */
private const val LOADING_SKELETON_COUNT: Int = 3

/** Em dash shown for an unknown freshness age / unparseable drive date. */
private const val EM_DASH: String = "\u2014"

/**
 * The localized title/subtitle/aria for one chart panel — the web `t('…')` / `t('….aria')` pair. The aria
 * description resolves by-name with the web `t(key, default)` fallback (the catalog defines no aria key).
 */
data class ChartStrings(
    val title: String,
    val subtitle: String,
    val aria: String,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the section title
 * plus the three per-chart [ChartStrings]. The smaller series/column/axis labels are resolved inline at the
 * Compose boundary, so this holder stays a thin content carrier.
 */
data class DriveAnalyticsSectionStrings(
    val driveAnalytics: String,
    val speedDistribution: ChartStrings,
    val accelPatterns: ChartStrings,
    val powerProfile: ChartStrings,
)

/**
 * Stateful entry point for the Drive Analytics section. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live display [UnitPref] + locale from the shared data container (the
 * native `useUnits`), and renders every lifecycle [state] the drive feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the drive list (web `filteredDrives`' source).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveAnalyticsSection(
    state: UiState<List<DriveAnalyticsDrive>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordDriveAnalyticsSectionOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    DriveAnalyticsSectionContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        units = formatter.prefs,
        locale = localeOf(formatter.prefs.locale),
    )
}

/**
 * Web-parity overload mirroring the web component's `filteredDrives: Drive[]` prop, for hosts that already
 * hold the drive list. A `null` or empty value renders the empty surface; a populated value renders the
 * charts (then re-filtered by the section's own date range). Records `view.opened` and resolves units like
 * the stateful entry, and offers no retry (there is no fetch behind it).
 */
@Composable
fun DriveAnalyticsSection(
    drives: List<DriveAnalyticsDrive>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(drives) {
            val resolved = drives ?: emptyList()
            val phase = if (resolved.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = resolved)
        }
    DriveAnalyticsSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the header
 * ([DriveAnalyticsSectionStrings.driveAnalytics] + a freshness chip) and the [DateRangeFilter], then
 * switches the body: a loading skeleton, a hard-error retry surface, or the three chart panels (each in its
 * own empty/content state from the date-filtered drives). Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [units] applies the display preference at the render boundary; [locale]
 * formats axis values and the short drive-date labels.
 */
@Composable
fun DriveAnalyticsSectionContent(
    state: UiState<List<DriveAnalyticsDrive>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: UnitPref = UnitFormatter.default().prefs,
    locale: Locale = Locale.getDefault(),
    strings: DriveAnalyticsSectionStrings = rememberDriveAnalyticsSectionStrings(),
    todayEpochDay: Long = LocalDate.now().toEpochDay(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    var startEpochDay by remember(todayEpochDay) {
        mutableLongStateOf(DriveAnalyticsProjection.defaultStartEpochDay(todayEpochDay))
    }
    var endEpochDay by remember(todayEpochDay) {
        mutableLongStateOf(DriveAnalyticsProjection.defaultEndEpochDay(todayEpochDay))
    }

    val formatLabel = rememberDateShortFormatter(locale)
    val drives = state.data ?: emptyList()
    val startYmd = remember(startEpochDay) { LocalDate.ofEpochDay(startEpochDay).toString() }
    val endYmd = remember(endEpochDay) { LocalDate.ofEpochDay(endEpochDay).toString() }
    val filtered = remember(drives, startYmd, endYmd) { DriveAnalyticsProjection.filterByDate(drives, startYmd, endYmd) }
    val speedBuckets = remember(filtered, units.speed) { DriveAnalyticsProjection.speedDistribution(filtered, units.speed) }
    val speedEmpty = remember(speedBuckets) { DriveAnalyticsProjection.speedTotal(speedBuckets) == 0L }
    val scatter =
        remember(filtered, units.distance) {
            DriveAnalyticsProjection.accelScatter(DriveAnalyticsProjection.accelPatterns(filtered, units.distance))
        }
    val powerPoints = remember(filtered, formatLabel) { DriveAnalyticsProjection.powerProfile(filtered, formatLabel) }

    FadeIn(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            DriveAnalyticsHeader(title = strings.driveAnalytics, state = state)
            DateRangeFilter(
                startEpochDay = startEpochDay,
                endEpochDay = endEpochDay,
                onRangeChange = { start, end ->
                    start?.let { startEpochDay = it }
                    end?.let { endEpochDay = it }
                },
            )
            when {
                state.isLoading -> DriveAnalyticsLoading()
                state.isError -> DriveAnalyticsError(onRetry = onRetry)
                else -> {
                    SpeedDistributionPanel(
                        buckets = speedBuckets,
                        isEmpty = speedEmpty,
                        strings = strings.speedDistribution,
                        locale = locale,
                    )
                    AccelerationPatternsPanel(scatter = scatter, strings = strings.accelPatterns, units = units, locale = locale)
                    PowerProfilePanel(points = powerPoints, strings = strings.powerProfile, locale = locale)
                }
            }
        }
    }
}

/** The section header: the title plus a freshness chip when cached data is refreshing / stale / offline. */
@Composable
private fun DriveAnalyticsHeader(
    title: String,
    state: UiState<*>,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SectionTitle(title, modifier = Modifier.weight(1f))
        val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
        if (showFreshness) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberDriveAnalyticsFreshnessFormatter(),
            )
        }
    }
}

/** Speed Distribution — a single-series bar chart of drive count per average-speed bucket (web `<BarChart>`). */
@Composable
private fun SpeedDistributionPanel(
    buckets: List<SpeedBucket>,
    isEmpty: Boolean,
    strings: ChartStrings,
    locale: Locale,
) {
    val color = TeslaTokens.chart.speed
    val seriesLabel = stringResource(R.string.translation_dynamics_drives)
    val emptyMessage = stringResource(R.string.translation_common_noData)
    val series =
        remember(buckets, seriesLabel, color) {
            listOf(
                ChartSeries(
                    key = "count",
                    label = seriesLabel,
                    values = buckets.map { it.count + 0.0 },
                    kind = ChartSeriesKind.Bar,
                    color = color,
                ),
            )
        }
    ChartContainer(
        title = strings.title,
        subtitle = strings.subtitle,
        status = if (isEmpty) ChartStatus.Empty else ChartStatus.Ready,
        height = CHART_HEIGHT,
        accessibleDescription = strings.aria,
        emptyMessage = emptyMessage,
    ) {
        BarChartWrapper(
            series = series,
            xLabels = buckets.map { it.range },
            height = CHART_HEIGHT,
            yValueFormatter = { value -> ChartFormat.number(value, COUNT_DECIMALS, locale) },
            emptyMessage = emptyMessage,
        )
    }
}

/** Acceleration Patterns — a bespoke scatter of peak power vs trip distance with an average line (web scatter). */
@Composable
private fun AccelerationPatternsPanel(
    scatter: AccelScatterProjection,
    strings: ChartStrings,
    units: UnitPref,
    locale: Locale,
) {
    val distanceLabel = stringResource(R.string.translation_dynamics_distance)
    val peakPowerLabel = stringResource(R.string.translation_dynamics_peakPower)
    val avgLabel = stringResource(R.string.translation_dynamics_avg)
    val pointColor = TeslaTokens.chart.power
    val avgColor = TeslaTokens.status.warning
    val axisColor = MaterialTheme.colorScheme.outlineVariant
    ChartContainer(
        title = strings.title,
        subtitle = strings.subtitle,
        status = if (scatter.isEmpty) ChartStatus.Empty else ChartStatus.Ready,
        height = CHART_HEIGHT,
        accessibleDescription = strings.aria,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        AccelScatter(
            projection = scatter,
            pointColor = pointColor,
            avgColor = avgColor,
            axisColor = axisColor,
            xAxisLabel = "$distanceLabel (${units.distance.label})",
            yAxisLabel = "$peakPowerLabel ($POWER_UNIT)",
            avgLabel = avgLabel,
            locale = locale,
            height = CHART_HEIGHT,
        )
    }
}

/** The bespoke peak-power-vs-distance scatter Canvas, positioned by the unit-tested [AccelScatterProjection]. */
@Composable
private fun AccelScatter(
    projection: AccelScatterProjection,
    pointColor: Color,
    avgColor: Color,
    axisColor: Color,
    xAxisLabel: String,
    yAxisLabel: String,
    avgLabel: String,
    locale: Locale,
    height: Dp,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(yAxisLabel)
        Canvas(modifier = Modifier.fillMaxWidth().height(height)) {
            val radius = SCATTER_POINT_RADIUS.toPx()
            val left = radius
            val right = (size.width - radius).coerceAtLeast(left + 1f)
            val top = radius
            val bottom = (size.height - radius).coerceAtLeast(top + 1f)
            val spanX = right - left
            val spanY = bottom - top

            drawLine(axisColor, Offset(left, top), Offset(left, bottom), AXIS_STROKE.toPx())
            drawLine(axisColor, Offset(left, bottom), Offset(right, bottom), AXIS_STROKE.toPx())

            projection.avg?.let { avg ->
                val ny = DriveAnalyticsProjection.normalize(avg, projection.yMin, projection.yMax).toFloat()
                val y = bottom - ny * spanY
                drawLine(
                    color = avgColor,
                    start = Offset(left, y),
                    end = Offset(right, y),
                    strokeWidth = AXIS_STROKE.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(DASH_ON, DASH_OFF)),
                )
            }

            projection.points.forEach { point ->
                val nx = DriveAnalyticsProjection.normalize(point.distance, projection.xMin, projection.xMax).toFloat()
                val ny = DriveAnalyticsProjection.normalize(point.powerMax, projection.yMin, projection.yMax).toFloat()
                drawCircle(
                    color = pointColor.copy(alpha = POINT_ALPHA),
                    radius = radius,
                    center = Offset(left + nx * spanX, bottom - ny * spanY),
                )
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Caption(ChartFormat.number(projection.xMin, SCATTER_DECIMALS, locale))
            Caption(xAxisLabel)
            Caption(ChartFormat.number(projection.xMax, SCATTER_DECIMALS, locale))
        }
        projection.avg?.let { avg ->
            Caption("$avgLabel: ${ChartFormat.withUnit(avg, POWER_UNIT, SCATTER_DECIMALS, locale)}")
        }
    }
}

/** Power Profile — a dual-area chart (peak + flat-zero regen) of the last 20 drives, with a legend (web `<AreaChart>`). */
@Composable
private fun PowerProfilePanel(
    points: List<PowerPoint>,
    strings: ChartStrings,
    locale: Locale,
) {
    val maxColor = TeslaTokens.chart.speed
    val regenColor = TeslaTokens.status.danger
    val maxLabel = stringResource(R.string.translation_dynamics_maxPower)
    val regenLabel = stringResource(R.string.translation_dynamics_regenPower)
    val emptyMessage = stringResource(R.string.translation_common_noData)
    val series =
        remember(points, maxLabel, regenLabel, maxColor, regenColor) {
            listOf(
                ChartSeries(
                    key = "powerMax",
                    label = maxLabel,
                    values = points.map { it.powerMax },
                    kind = ChartSeriesKind.Area,
                    color = maxColor,
                    unit = POWER_UNIT,
                ),
                ChartSeries(
                    key = "powerMin",
                    label = regenLabel,
                    values = points.map { it.powerMin },
                    kind = ChartSeriesKind.Area,
                    color = regenColor,
                    unit = POWER_UNIT,
                ),
            )
        }
    val legend =
        remember(maxLabel, regenLabel, maxColor, regenColor) {
            listOf(
                LegendEntry(key = "powerMax", label = maxLabel, color = maxColor),
                LegendEntry(key = "powerMin", label = regenLabel, color = regenColor),
            )
        }
    ChartContainer(
        title = strings.title,
        subtitle = strings.subtitle,
        status = if (points.isEmpty()) ChartStatus.Empty else ChartStatus.Ready,
        height = POWER_HEIGHT,
        accessibleDescription = strings.aria,
        emptyMessage = emptyMessage,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            AreaChartWrapper(
                series = series,
                xLabels = points.map { it.label },
                height = POWER_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, POWER_DECIMALS, locale) },
                emptyMessage = emptyMessage,
            )
            ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** First-load skeleton — one chart-shaped shimmer per section so no panel is ever a blank box. */
@Composable
private fun DriveAnalyticsLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    repeat(LOADING_SKELETON_COUNT) { index ->
        GlassPanel(padding = PanelPadding.Md) {
            val base = Modifier.fillMaxWidth()
            val skeletonModifier = if (index == 0) base.semantics { contentDescription = loadingLabel } else base
            ChartBlockSkeleton(modifier = skeletonModifier, height = CHART_HEIGHT)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DriveAnalyticsError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * Builds the localized [DriveAnalyticsSectionStrings] from the i18n catalog (P1/S10): the visible titles +
 * subtitles resolve through compile-time resources; each chart's aria description resolves by-name with the
 * web `t(key, default)` fallback, since the catalog defines no aria keys. Remembered against the resolved
 * strings so a locale change re-projects.
 */
@Composable
private fun rememberDriveAnalyticsSectionStrings(): DriveAnalyticsSectionStrings {
    val context = LocalContext.current
    val driveAnalytics = stringResource(R.string.translation_dynamics_driveAnalytics)
    val speedDistribution = stringResource(R.string.translation_dynamics_speedDistribution)
    val speedDistDesc = stringResource(R.string.translation_dynamics_speedDistDesc)
    val accelPatterns = stringResource(R.string.translation_dynamics_accelPatterns)
    val accelPatternsDesc = stringResource(R.string.translation_dynamics_accelPatternsDesc)
    val powerProfile = stringResource(R.string.translation_dynamics_powerProfile)
    val powerProfileDesc = stringResource(R.string.translation_dynamics_powerProfileDesc)
    val speedAria =
        resolveOptional({ context.optionalString(it) }, KEY_SPEED_DISTRIBUTION_ARIA, DriveAnalyticsSectionDefaults.SPEED_DISTRIBUTION_ARIA)
    val accelAria =
        resolveOptional({ context.optionalString(it) }, KEY_ACCEL_PATTERNS_ARIA, DriveAnalyticsSectionDefaults.ACCEL_PATTERNS_ARIA)
    val powerAria =
        resolveOptional({ context.optionalString(it) }, KEY_POWER_PROFILE_ARIA, DriveAnalyticsSectionDefaults.POWER_PROFILE_ARIA)
    return remember(
        driveAnalytics,
        speedDistribution,
        speedDistDesc,
        speedAria,
        accelPatterns,
        accelPatternsDesc,
        accelAria,
        powerProfile,
        powerProfileDesc,
        powerAria,
    ) {
        DriveAnalyticsSectionStrings(
            driveAnalytics = driveAnalytics,
            speedDistribution = ChartStrings(speedDistribution, speedDistDesc, speedAria),
            accelPatterns = ChartStrings(accelPatterns, accelPatternsDesc, accelAria),
            powerProfile = ChartStrings(powerProfile, powerProfileDesc, powerAria),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDriveAnalyticsFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
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

/**
 * The render-boundary short-date formatter — the web `formatDateShort(startTs)` (`"Apr 4"`, locale-aware,
 * device-local zone). Injected into [DriveAnalyticsProjection.powerProfile] so the projection stays pure;
 * an unparseable timestamp resolves to the em-dash fallback (web `'—'`).
 */
@Composable
private fun rememberDateShortFormatter(locale: Locale): (String?) -> String {
    val formatter = remember(locale) { DateTimeFormatter.ofPattern("MMM d", locale).withZone(ZoneId.systemDefault()) }
    return remember(formatter) {
        { ts ->
            val instant = parseInstant(ts)
            if (instant == null) EM_DASH else formatter.format(instant)
        }
    }
}

/** Best-effort parse of an ISO drive timestamp to an [Instant]; `null` when blank or unparseable. */
private fun parseInstant(ts: String?): Instant? {
    if (ts.isNullOrBlank()) return null
    return runCatching { Instant.parse(ts) }
        .recoverCatching { OffsetDateTime.parse(ts).toInstant() }
        .recoverCatching { LocalDate.parse(ts.take(DATE_KEY_LENGTH)).atStartOfDay(ZoneOffset.UTC).toInstant() }
        .getOrNull()
}

/** Builds a [Locale] from a BCP-47 [tag]; null/blank ⇒ the device default (web `deriveLocale` fallback). */
private fun localeOf(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    DriveAnalyticsSectionStrings(
        driveAnalytics = "Drive Analytics",
        speedDistribution = ChartStrings("Speed Distribution", "Drives grouped by average speed", "Speed-bucket bar chart"),
        accelPatterns = ChartStrings("Acceleration Patterns", "Peak power vs trip distance", "Peak power scatter chart"),
        powerProfile = ChartStrings("Power Profile", "Peak & regen power for recent drives", "Power dual-area chart"),
    )

private val PREVIEW_DRIVES =
    listOf(
        DriveAnalyticsDrive(startTs = "2026-04-02T08:00:00Z", distanceM = 18_400.0, avgSpeedMps = 12.0, avgPowerW = 16_000.0),
        DriveAnalyticsDrive(startTs = "2026-04-08T17:30:00Z", distanceM = 42_100.0, avgSpeedMps = 27.0, avgPowerW = 38_500.0),
        DriveAnalyticsDrive(startTs = "2026-04-15T07:10:00Z", distanceM = 9_300.0, avgSpeedMps = 8.0, avgPowerW = 11_200.0),
    )

private val PREVIEW_TODAY: Long = LocalDate.parse("2026-04-20").toEpochDay()

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DriveAnalyticsSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveAnalyticsSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
            todayEpochDay = PREVIEW_TODAY,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DriveAnalyticsSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveAnalyticsSectionContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
            todayEpochDay = PREVIEW_TODAY,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun DriveAnalyticsSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveAnalyticsSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DRIVES),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
            todayEpochDay = PREVIEW_TODAY,
        )
    }
}
