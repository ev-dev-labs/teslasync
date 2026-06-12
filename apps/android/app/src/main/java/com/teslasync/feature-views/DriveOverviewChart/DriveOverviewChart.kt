// The native Jetpack Compose + Material 3 Drive Overview chart feature view — a parity port of
// web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx. The web component is purely
// presentational: inside a `<FadeIn>` it wraps the shared `<ChartContainer title="Drive Overview"
// height={360}>` around a Recharts `<ComposedChart>` of a speed area plus the (conditional) ideal-range,
// est/rated-range, SOC, usable-SOC and power lines, then renders a rich Mean/Max/Min legend beneath it.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog, `useUnits` → the live [UnitFormatter] (P1/S8) for the
// speed/distance unit labels + locale + precision, and `useSyncedCursor`/`useSyncedReferenceLineX` →
// [cursorSyncPosition] over the shared [CursorSyncStore], surfaced as a marker rail (the Vico counterpart
// of the web `<ReferenceLine x={syncedX}>`; the shared cartesian renderer draws no overlay reference line).
// The host supplies the per-sample trace through the shared P1/S8 state-holder layer as a [UiState] (the
// cache-then-network projection of the selected drive's `chartData`), so this feature view renders every
// lifecycle state that layer can carry — loading, hard error with retry, empty, content, and stale/offline
// (cached "last known") — without ever fetching. The native [ChartContainer] + [ComboChart] + the rich
// legend are the faithful counterparts of the web `ChartContainer` + `ComposedChart` + `ChartLegend`. A
// web-parity overload that takes the raw `chartData` prop is also provided.
//
// Colors map to the generated CB-safe categorical palette (never raw hex in render code): speed →
// `paletteColor(0)`, ideal-range → `1`, est-range → `2`, SOC → `3`, usable-SOC → `4`, power → `5`. The web
// component picks its own per-series hex literals (`#3b82f6` … `#f59e0b`); reproducing those verbatim would
// reintroduce raw hex into component code (forbidden) and bypass light/dark theming, so — as the sibling
// surfaces do — each series takes a distinct, color-blind-safe categorical slot and the legend swatch reuses
// the same slot so swatch and plotted line always agree. The web draws two Y axes (a hidden auto-scaled
// "speed" axis shared by speed/range/SOC and a right "power" axis); the shared cartesian renderer exposes a
// single value axis and must not be altered (allowed-files), so all series share one axis and the exact
// per-series figures stay screen-reader honest through the Mean/Max/Min legend (the web also deliberately
// omits the chart's data table — `chart-a11y:no-table` — in favour of that legend).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DriveOverviewChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.driveoverviewchart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.cursorSyncPosition
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import java.util.Locale

/** The web `<ChartContainer height={360}>` plot height. */
private val CHART_HEIGHT: Dp = 360.dp

/** Series keys — the web `<Area dataKey="speed" />` / `<Line dataKey="…" />` keys (SOC plots `battery`). */
private const val SPEED_KEY: String = "speed"
private const val IDEAL_RANGE_KEY: String = "idealRange"
private const val EST_RANGE_KEY: String = "estRange"
private const val SOC_KEY: String = "battery"
private const val USABLE_SOC_KEY: String = "usableSoc"
private const val POWER_KEY: String = "power"

/** The web `<Line dataKey="power" name="… kW">` series-name unit suffix. */
private const val POWER_UNIT: String = "kW"

/** The SOC / usable-SOC series-name unit suffix (web `name={... + ' %'}`). */
private const val PERCENT_UNIT: String = "%"

/** Axis tick precision — the web right "power" axis renders whole `kW`; one shared axis here. */
private const val AXIS_DECIMALS: Int = 0

/**
 * The page-scoped cursor `syncId` — the web `<ChartTimeRangeProvider syncId="drive-detail">` that
 * `useSyncedCursor`/`useSyncedReferenceLineX` read. When this chart is hosted next to the other drive
 * detail charts under the same id, the shared [CursorSyncStore] mirrors the hovered sample here as a marker.
 */
private const val DEFAULT_SYNC_ID: String = "drive-detail"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/** Rich-legend line swatch geometry (the web `w-4 border-t-2`). */
private val SWATCH_WIDTH: Dp = 16.dp
private val SWATCH_HEIGHT: Dp = 3.dp
private const val SWATCH_DASH_ON: Float = 6f
private const val SWATCH_DASH_OFF: Float = 4f

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the keys the
 * web component resolves via `t(...)`: the panel [title] (`driveDetail.driveChart`), the six series labels
 * ([speed]/[rangeIdeal]/[rangeEst]/[soc]/[usableSoc]/[power]), and the accessible chart description
 * ([ariaLabel], catalog-absent ⇒ the web English fallback). Lifecycle-chrome strings (empty / error / retry
 * / offline / freshness) and the legend stat labels are resolved inline at the Compose boundary.
 */
data class DriveOverviewChartStrings(
    val title: String,
    val speed: String,
    val rangeIdeal: String,
    val rangeEst: String,
    val soc: String,
    val usableSoc: String,
    val power: String,
    val ariaLabel: String,
)

/**
 * Stateful entry point for the Drive Overview chart. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the live display units (web `useUnits`) from the shared [UnitFormatter], and renders
 * every lifecycle [state] the shared drive-trace feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `ChartDataPoint[]` (web `chartData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param syncId the page cursor-sync id (web `useSyncedCursor`); `null` disables the synced marker.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveOverviewChart(
    state: UiState<List<DriveChartPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordDriveOverviewChartOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    DriveOverviewChartContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        syncId = syncId,
        speedUnit = formatter.prefs.speed.label,
        distanceUnit = formatter.prefs.distance.label,
        locale = localeOf(formatter.prefs.locale),
        precision = formatter.prefs.precision ?: DriveChartFormat.DEFAULT_PRECISION,
    )
}

/**
 * Web-parity overload mirroring the web component's `chartData: ChartDataPoint[]` prop, for hosts that
 * already hold the loaded trace. The web `chartData.length > 1` boundary is reproduced: 0 or 1 samples
 * render the empty state, 2+ render the composed chart. Records `view.opened` like the stateful entry; with
 * no fetch behind it, it offers no retry affordance.
 */
@Composable
fun DriveOverviewChart(
    chartData: List<DriveChartPoint>?,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(chartData) {
            val items = chartData ?: emptyList()
            val phase = if (items.size > 1) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = items)
        }
    DriveOverviewChart(state = state, onRetry = {}, modifier = modifier, syncId = syncId, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready), and in the ready state
 * renders the [ComboChart] (speed area + the conditional range / SOC / usable-SOC / power lines) inside a
 * [FadeIn], followed by the rich Mean/Max/Min legend — reproducing the web `FadeIn` + `ChartContainer` +
 * `ComposedChart` + `ChartLegend` composition. A freshness chip appears when cached data is refreshing /
 * stale / offline, and stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [speedUnit]/[distanceUnit]/[locale]/[precision] are the web `useUnits` outputs the legend formats with.
 */
@Composable
fun DriveOverviewChartContent(
    state: UiState<List<DriveChartPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    speedUnit: String = SpeedUnitPref.KMH.label,
    distanceUnit: String = DistanceUnitPref.KM.label,
    locale: Locale = Locale.getDefault(),
    precision: Int = DriveChartFormat.DEFAULT_PRECISION,
    strings: DriveOverviewChartStrings = rememberDriveOverviewChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(speedUnit, distanceUnit, locale, precision) {
            DriveChartFormatters(
                number = { DriveChartFormat.number(it, precision, locale) },
                integer = { DriveChartFormat.integer(it, locale) },
                percent = { DriveChartFormat.percent(it, precision, locale) },
                powerKw = { DriveChartFormat.withUnit(it, POWER_UNIT, precision, locale) },
                speedUnit = speedUnit,
                distanceUnit = distanceUnit,
            )
        }

    val result =
        remember(state.data, formatters) {
            DriveOverviewChartProjection.project(state.data ?: emptyList(), formatters)
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val series =
        remember(result, strings, speedUnit, distanceUnit) {
            buildDriveSeries(result, strings, speedUnit, distanceUnit)
        }

    val syncedIndex = cursorSyncPosition(syncId)
    val markers =
        remember(syncedIndex, result.xLabels) {
            val index = syncedIndex
            if (index != null && index in result.xLabels.indices) {
                listOf(
                    ChartVerticalMarker(
                        index = index,
                        label = result.xLabels[index],
                        severity = MarkerSeverity.Info,
                    ),
                )
            } else {
                emptyList()
            }
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noChartData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ChartContainer(
                title = strings.title,
                status = status,
                height = CHART_HEIGHT,
                action =
                    if (showFreshness) {
                        { DriveOverviewFreshnessChip(state) }
                    } else {
                        null
                    },
                accessibleDescription = strings.ariaLabel,
                emptyMessage = emptyMessage,
                errorMessage = stringResource(R.string.translation_error_serverError_message),
                retryLabel = stringResource(R.string.translation_common_retry),
                onRetry = onRetry,
            ) {
                ComboChart(
                    series = series,
                    xLabels = result.xLabels,
                    height = CHART_HEIGHT,
                    markers = markers,
                    yValueFormatter = { value -> DriveChartFormat.number(value, AXIS_DECIMALS, locale) },
                    emptyMessage = emptyMessage,
                )
            }
            if (status == ChartStatus.Ready) {
                DriveOverviewLegend(entries = result.legend, strings = strings, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * Builds the present [ChartSeries] from the projection — the native analogue of the web `<Area>` + the
 * conditional `<Line>`s. Speed is the gradient-filled area (web `<Area dataKey="speed">`); the rest are
 * lines, each present only when its value column survived the projection guards. Series names carry the
 * web unit-in-parens suffix shown in the hover marker, and colors take the per-series categorical slot.
 */
private fun buildDriveSeries(
    result: DriveOverviewChartProjectionResult,
    strings: DriveOverviewChartStrings,
    speedUnit: String,
    distanceUnit: String,
): List<ChartSeries> =
    buildList {
        add(areaSeries(SPEED_KEY, "${strings.speed} ($speedUnit)", result.speedValues, DriveSeriesId.Speed, speedUnit))
        result.idealRangeValues?.let {
            add(lineSeries(IDEAL_RANGE_KEY, "${strings.rangeIdeal} ($distanceUnit)", it, DriveSeriesId.IdealRange, distanceUnit))
        }
        result.estRangeValues?.let {
            add(lineSeries(EST_RANGE_KEY, "${strings.rangeEst} ($distanceUnit)", it, DriveSeriesId.EstRange, distanceUnit))
        }
        add(lineSeries(SOC_KEY, "${strings.soc} $PERCENT_UNIT", result.socValues, DriveSeriesId.Soc, PERCENT_UNIT))
        result.usableSocValues?.let {
            add(lineSeries(USABLE_SOC_KEY, "${strings.usableSoc} $PERCENT_UNIT", it, DriveSeriesId.UsableSoc, PERCENT_UNIT))
        }
        add(lineSeries(POWER_KEY, "${strings.power} $POWER_UNIT", result.powerValues, DriveSeriesId.Power, POWER_UNIT))
    }

/** Builds a gradient-filled area [ChartSeries] (web `<Area>`) with the per-series categorical color. */
private fun areaSeries(
    key: String,
    label: String,
    values: List<Double?>,
    id: DriveSeriesId,
    unit: String,
): ChartSeries =
    ChartSeries(key = key, label = label, values = values, kind = ChartSeriesKind.Area, color = driveSeriesColor(id), unit = unit)

/** Builds a line [ChartSeries] (web `<Line>`) with the per-series categorical color. */
private fun lineSeries(
    key: String,
    label: String,
    values: List<Double?>,
    id: DriveSeriesId,
    unit: String,
): ChartSeries =
    ChartSeries(key = key, label = label, values = values, kind = ChartSeriesKind.Line, color = driveSeriesColor(id), unit = unit)

/** The categorical-palette slot for each series — the native stand-in for the web per-series hex literals. */
private fun driveSeriesColorIndex(id: DriveSeriesId): Int =
    when (id) {
        DriveSeriesId.Speed -> 0
        DriveSeriesId.IdealRange -> 1
        DriveSeriesId.EstRange -> 2
        DriveSeriesId.Soc -> 3
        DriveSeriesId.UsableSoc -> 4
        DriveSeriesId.Power -> 5
    }

/** Resolves the generated CB-safe categorical color for [id]; shared by the plot and the legend swatch. */
private fun driveSeriesColor(id: DriveSeriesId): Color = paletteColor(driveSeriesColorIndex(id))

/**
 * The rich Mean/Max/Min legend rendered below the chart — the native counterpart of the web `ChartLegend`.
 * Each present series contributes a row: a solid/dashed color swatch (web `border-t-2` / dashed for the
 * ranges), the series label in its color, and the three localized stat figures. Wraps like the web
 * `flex-wrap` row. Renders nothing when no series carried a finite sample (web `items.length === 0`).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DriveOverviewLegend(
    entries: List<DriveLegendEntryData>,
    strings: DriveOverviewChartStrings,
    modifier: Modifier = Modifier,
) {
    if (entries.isEmpty()) return
    val context = LocalContext.current
    val meanLabel = resolveOptional({ context.optionalString(it) }, KEY_STAT_MEAN, DriveOverviewChartDefaults.STAT_MEAN)
    val maxLabel = stringResource(R.string.translation_Max)
    val minLabel = stringResource(R.string.translation_Min)
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        entries.forEach { entry ->
            DriveLegendChip(
                entry = entry,
                label = seriesLabel(entry.id, strings),
                color = driveSeriesColor(entry.id),
                meanLabel = meanLabel,
                maxLabel = maxLabel,
                minLabel = minLabel,
            )
        }
    }
}

/**
 * A single legend row — swatch + colored label + the three stat figures — exposed to TalkBack as one
 * grouped, self-describing node so the dense per-series summary reads as a unit.
 */
@Composable
private fun DriveLegendChip(
    entry: DriveLegendEntryData,
    label: String,
    color: Color,
    meanLabel: String,
    maxLabel: String,
    minLabel: String,
) {
    val mean = "$meanLabel: ${entry.mean}"
    val max = "$maxLabel: ${entry.max}"
    val min = "$minLabel: ${entry.min}"
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$label. $mean. $max. $min" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        LegendSwatch(color = color, dashed = entry.dashed)
        Heading(text = label, level = HeadingLevel.Sub, color = color)
        Caption(mean)
        Caption(max)
        Caption(min)
    }
}

/** The horizontal line swatch — solid, or dashed for the range series (web inline `borderStyle`). */
@Composable
private fun LegendSwatch(
    color: Color,
    dashed: Boolean,
) {
    Canvas(modifier = Modifier.size(width = SWATCH_WIDTH, height = SWATCH_HEIGHT)) {
        val centerY = size.height / 2f
        drawLine(
            color = color,
            start = Offset(0f, centerY),
            end = Offset(size.width, centerY),
            strokeWidth = size.height,
            cap = StrokeCap.Round,
            pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(SWATCH_DASH_ON, SWATCH_DASH_OFF), 0f) else null,
        )
    }
}

/** Maps a series id to its localized short label — the web legend `label` (and the chart name base). */
private fun seriesLabel(
    id: DriveSeriesId,
    strings: DriveOverviewChartStrings,
): String =
    when (id) {
        DriveSeriesId.Speed -> strings.speed
        DriveSeriesId.IdealRange -> strings.rangeIdeal
        DriveSeriesId.EstRange -> strings.rangeEst
        DriveSeriesId.Soc -> strings.soc
        DriveSeriesId.UsableSoc -> strings.usableSoc
        DriveSeriesId.Power -> strings.power
    }

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun DriveOverviewFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberDriveOverviewFreshnessFormatter(),
    )
}

/**
 * Builds the localized [DriveOverviewChartStrings] from the i18n catalog (P1/S10): the title + six series
 * labels resolve through compile-time resources; the aria description resolves by-name with the web
 * `t(key, default)` fallback, since the catalog defines no key for it. Remembered against the resolved
 * strings so a locale change re-projects.
 */
@Composable
private fun rememberDriveOverviewChartStrings(): DriveOverviewChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_driveDetail_driveChart)
    val speed = stringResource(R.string.translation_driveDetail_speed)
    val rangeIdeal = stringResource(R.string.translation_driveDetail_rangeIdeal)
    val rangeEst = stringResource(R.string.translation_driveDetail_rangeEst)
    val soc = stringResource(R.string.translation_driveDetail_soc)
    val usableSoc = stringResource(R.string.translation_driveDetail_usableSoc)
    val power = stringResource(R.string.translation_driveDetail_power)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, DriveOverviewChartDefaults.ARIA_LABEL)
    return remember(title, speed, rangeIdeal, rangeEst, soc, usableSoc, power, ariaLabel) {
        DriveOverviewChartStrings(
            title = title,
            speed = speed,
            rangeIdeal = rangeIdeal,
            rangeEst = rangeEst,
            soc = soc,
            usableSoc = usableSoc,
            power = power,
            ariaLabel = ariaLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDriveOverviewFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Builds a [Locale] from a BCP-47 [tag]; null/blank ⇒ the device default (web `deriveLocale` fallback). */
private fun localeOf(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    DriveOverviewChartStrings(
        title = "Drive Overview",
        speed = "Speed",
        rangeIdeal = "Range ideal",
        rangeEst = "Range est.",
        soc = "SOC",
        usableSoc = "Usable SOC",
        power = "Power",
        ariaLabel = "Drive overview composed chart of speed, range, SOC and power over time",
    )

private val PREVIEW_POINTS =
    listOf(
        DriveChartPoint("09:00", speed = 0.0, battery = 88.0, power = 0.0, idealRange = 320.0, estRange = 300.0, usableSoc = 86.0),
        DriveChartPoint("09:05", speed = 45.0, battery = 86.0, power = 38.0, idealRange = 312.0, estRange = 292.0, usableSoc = 84.0),
        DriveChartPoint("09:10", speed = 72.0, battery = 83.0, power = 64.0, idealRange = 300.0, estRange = 280.0, usableSoc = 81.0),
        DriveChartPoint("09:15", speed = 30.0, battery = 82.0, power = -12.0, idealRange = 296.0, estRange = 276.0, usableSoc = 80.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DriveOverviewChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveOverviewChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DriveOverviewChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveOverviewChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DriveOverviewChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveOverviewChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun DriveOverviewChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveOverviewChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            syncId = null,
            speedUnit = "mph",
            distanceUnit = "mi",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun DriveOverviewChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveOverviewChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_POINTS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
