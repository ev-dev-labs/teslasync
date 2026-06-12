// The native Jetpack Compose + Material 3 Temperature Trend chart feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx. The web component is
// purely presentational: inside a `<FadeIn delay={0.25}>` it wraps the shared `<ChartContainer height={300}>`
// (title / subtitle / aria fallback table / loading + empty states) around a Recharts `<LineChart>` with a
// single outside-temperature line (cyan), a `<Legend>`, a Y-axis unit label, and two horizontal
// `<ReferenceLine>` thresholds — Warm Zone (amber, 35 °C) and Freezing (cyan, 0 °C). The web guards
// `if (data.length <= 1) return null`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` -> the i18n catalog (P1/S10), `useUnits` -> the live [UnitFormatter]
// (P1/S8) for the temperature unit + locale + precision. The host supplies the trend points through the
// shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the filtered
// `ChartDataPoint[]`), so this feature view renders every lifecycle state that layer can carry — loading,
// hard error with retry, empty, content, and stale/offline (cached "last known") — without ever fetching.
// A web-parity overload that takes the raw points is also provided.
//
// Three documented native adaptations, each matching a precedent from the sibling chart surfaces:
//   1. Line conversion. The web plots the line in raw Celsius while converting its axis unit + thresholds,
//      so a Fahrenheit user sees a line that disagrees with its own scale. This port converts the line too
//      (in [TemperatureTrendChartProjection]) so every element reads in one display unit — the same "do not
//      reproduce a latent web inconsistency" stance the SpeedTrendChart port documents.
//   2. `data.length <= 1` -> the empty state. The web returns nothing; the P3 no-hidden-surface contract
//      requires a friendly empty surface, so <=1 finite point maps to [ChartStatus.Empty] (the same mapping
//      TemperatureSection uses for its <=1-sample boundary).
//   3. Horizontal `<ReferenceLine>` -> a threshold chip row. Vico 2.0 has no horizontal-reference decoration
//      and feature views must not alter the shared chart layer (allowed-files), so Warm Zone / Freezing
//      render as labeled, color-swatched chips carrying the converted threshold value — preserving the web
//      labels, colors and threshold semantics (PowerProfileChart documents the same y-reference adaptation).
//
// Colors map to design tokens (never raw hex in render code): the line + Freezing threshold ->
// `TeslaTokens.chart.regen` (the exact web `#06b6d4` cyan) and the Warm Zone threshold ->
// `TeslaTokens.chart.energy` (the exact web `#f59e0b` amber). The web cyan/amber intent is preserved while
// light/dark theming keeps working.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TemperatureTrendChart — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturetrendchart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref

/** The web `<ChartContainer height={300}>` plot height. */
private val CHART_HEIGHT: Dp = 300.dp

/** Series key — the web `<Line dataKey="outsideTemp" />`. */
private const val OUTSIDE_KEY: String = "outsideTemp"

/** The web `<FadeIn delay={0.25}>` entry-animation delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 250

/** The middle-dot separator between a threshold label and its value (`Warm Zone · 35.0°C`). */
private const val THRESHOLD_SEPARATOR: String = "\u00B7"

/** Threshold-chip line-swatch geometry (a short horizontal bar, like a reference line). */
private val SWATCH_WIDTH: Dp = 16.dp
private val SWATCH_HEIGHT: Dp = 3.dp

/**
 * Stateful entry point for the Temperature Trend chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live temperature unit + locale + precision (web `useUnits`) from the
 * shared [UnitFormatter], and renders every lifecycle [state] the shared drive feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the filtered `ChartDataPoint[]` (web `tempTrendData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TemperatureTrendChart(
    state: UiState<List<TempTrendPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordTemperatureTrendChartOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    TemperatureTrendChartContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        unitPref = formatter.prefs,
    )
}

/**
 * Web-parity overload mirroring the web component's `data: ChartDataPoint[]` prop, for hosts that already
 * hold the loaded points. The web `data.length <= 1` boundary is reproduced: at most one finite-temperature
 * point renders the empty surface, two or more render the line. Records `view.opened` like the stateful
 * entry; with no fetch behind it, it offers no retry affordance.
 */
@Composable
fun TemperatureTrendChart(
    data: List<TempTrendPoint>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            val items = data ?: emptyList()
            val finiteCount = items.count { it.outsideTempC?.isFinite() == true }
            val phase = if (finiteCount > MIN_TREND_POINTS) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = items)
        }
    TemperatureTrendChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready), and in the ready state
 * renders the single outside-temperature [LineChartWrapper] inside a [FadeIn], beneath the axis-unit
 * caption, followed by the series legend and the Warm Zone / Freezing threshold chips — reproducing the web
 * `FadeIn` + `ChartContainer` + `LineChart` + `Legend` + `ReferenceLine` composition. A freshness chip
 * appears when cached data is refreshing / stale / offline, and stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [unitPref] is the web `useUnits().unitPrefs` the temperatures
 * convert + format with.
 */
@Composable
fun TemperatureTrendChartContent(
    state: UiState<List<TempTrendPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    unitPref: UnitPref = UnitFormatter.default().prefs,
    strings: TemperatureTrendChartStrings = rememberTemperatureTrendChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val tempUnit = unitPref.temperature
    val unitLabel = tempUnit.label
    val locale = remember(unitPref.locale) { resolveDisplayLocale(unitPref.locale) }
    val precision = unitPref.precision ?: DEFAULT_TEMP_PRECISION

    val result =
        remember(state.data, tempUnit, precision, locale) {
            TemperatureTrendChartProjection.project(state.data ?: emptyList(), tempUnit, precision, locale)
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // The line + Freezing threshold are the web cyan `#06b6d4` (chart.regen); Warm Zone is the web amber
    // `#f59e0b` (chart.energy). The web's separate temperature-red semantic token is intentionally not used,
    // since this chart's line is explicitly cyan in the web source.
    val lineColor = TeslaTokens.chart.regen
    val warmZoneColor = TeslaTokens.chart.energy
    val freezingColor = TeslaTokens.chart.regen

    val series =
        remember(result.tempValues, strings.outsideTempLabel, unitLabel, lineColor) {
            listOf(
                ChartSeries(
                    key = OUTSIDE_KEY,
                    label = strings.outsideTempLabel,
                    values = result.tempValues,
                    kind = ChartSeriesKind.Line,
                    color = lineColor,
                    unit = unitLabel,
                ),
            )
        }

    val legend =
        remember(strings.outsideTempLabel, lineColor) {
            listOf(LegendEntry(key = OUTSIDE_KEY, label = strings.outsideTempLabel, color = lineColor))
        }

    val emptyMessage = stringResource(R.string.translation_chart_noData)
    val outsideColumnHeader = "${strings.outsideColumn} ($unitLabel)"
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        ChartContainer(
            title = strings.title,
            subtitle = strings.subtitle,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { TemperatureTrendFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = strings.ariaLabel,
            dataTableHeader = listOf(strings.dateColumn, outsideColumnHeader),
            dataTableRows = result.tableRows,
            dataTableLabel = stringResource(R.string.translation_Details),
            emptyMessage = emptyMessage,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                // The web rotated `<YAxis label={tempUnit}>`; Vico has no axis-title slot, so the unit is
                // surfaced as a caption above the plot — the same adaptation the sibling SpeedTrendChart applies.
                Caption(unitLabel)
                LineChartWrapper(
                    series = series,
                    xLabels = result.dates,
                    height = CHART_HEIGHT,
                    yValueFormatter = { value -> TemperatureTrendChartProjection.formatNumber(value, AXIS_DECIMALS, locale) },
                    emptyMessage = emptyMessage,
                )
                ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
                ReferenceThresholds(
                    warmZoneLabel = strings.warmZoneLabel,
                    warmZoneValue = result.warmZoneDisplay,
                    warmZoneColor = warmZoneColor,
                    freezingLabel = strings.freezingLabel,
                    freezingValue = result.freezingDisplay,
                    freezingColor = freezingColor,
                )
            }
        }
    }
}

/**
 * The Warm Zone / Freezing reference-threshold chip row rendered below the chart — the native counterpart of
 * the web horizontal `<ReferenceLine label>` overlays. Vico 2.0 has no horizontal-reference decoration and
 * feature views may not alter the shared chart layer, so each threshold is surfaced as a labeled,
 * color-swatched chip carrying the converted threshold value (the value the web reference line conveys by
 * its y-position). Wraps like the web flex labels.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReferenceThresholds(
    warmZoneLabel: String,
    warmZoneValue: String,
    warmZoneColor: Color,
    freezingLabel: String,
    freezingValue: String,
    freezingColor: Color,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        ThresholdChip(label = warmZoneLabel, value = warmZoneValue, color = warmZoneColor)
        ThresholdChip(label = freezingLabel, value = freezingValue, color = freezingColor)
    }
}

/**
 * A single reference-threshold chip — a colored line swatch + `"{label} · {value}"` — exposed to TalkBack as
 * one grouped node reading `"{label}, {value}"` so each threshold announces as a self-contained unit.
 */
@Composable
private fun ThresholdChip(
    label: String,
    value: String,
    color: Color,
) {
    val description = "$label, $value"
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        ThresholdSwatch(color = color)
        Caption("$label $THRESHOLD_SEPARATOR $value")
    }
}

/** The short horizontal line swatch shown beside a threshold label (the web dashed reference-line color). */
@Composable
private fun ThresholdSwatch(color: Color) {
    Box(
        modifier =
            Modifier
                .size(width = SWATCH_WIDTH, height = SWATCH_HEIGHT)
                .clip(RoundedCornerShape(Radius.sm))
                .background(color),
    )
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun TemperatureTrendFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberTemperatureTrendFreshnessFormatter(),
    )
}

/**
 * Builds the localized [TemperatureTrendChartStrings] from the i18n catalog (P1/S10): the title / subtitle /
 * column / series / threshold labels resolve through compile-time resources; the aria description resolves
 * by-name with the web `t(key, default)` fallback, since the catalog defines no key for it. Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
fun rememberTemperatureTrendChartStrings(): TemperatureTrendChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_drivetrain_tempHistory)
    val subtitle = stringResource(R.string.translation_drivetrain_tempHistorySub)
    val dateColumn = stringResource(R.string.translation_drivetrain_col_date)
    val outsideColumn = stringResource(R.string.translation_drivetrain_col_outside)
    val outsideTempLabel = stringResource(R.string.translation_drivetrain_outsideTemp)
    val warmZoneLabel = stringResource(R.string.translation_drivetrain_warmZone)
    val freezingLabel = stringResource(R.string.translation_drivetrain_freezing)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, TemperatureTrendChartDefaults.ARIA_LABEL)
    return remember(
        title,
        subtitle,
        dateColumn,
        outsideColumn,
        outsideTempLabel,
        warmZoneLabel,
        freezingLabel,
        ariaLabel,
    ) {
        TemperatureTrendChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            dateColumn = dateColumn,
            outsideColumn = outsideColumn,
            outsideTempLabel = outsideTempLabel,
            warmZoneLabel = warmZoneLabel,
            freezingLabel = freezingLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTemperatureTrendFreshnessFormatter(): (FreshnessAge) -> String {
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
    TemperatureTrendChartStrings(
        title = "Temperature Trend",
        subtitle = "Outside temperature recorded during recent drives",
        ariaLabel = "Outside temperature trend line chart per recent drive",
        dateColumn = "Date",
        outsideColumn = "Outside",
        outsideTempLabel = "Outside Temp",
        warmZoneLabel = "Warm Zone",
        freezingLabel = "Freezing",
    )

private val PREVIEW_POINTS =
    listOf(
        TempTrendPoint(date = "Feb 04", outsideTempC = -2.0),
        TempTrendPoint(date = "Feb 19", outsideTempC = 8.5),
        TempTrendPoint(date = "Mar 06", outsideTempC = 21.0),
        TempTrendPoint(date = "Mar 21", outsideTempC = 37.5),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TemperatureTrendChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureTrendChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TemperatureTrendChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureTrendChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TemperatureTrendChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureTrendChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun TemperatureTrendChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureTrendChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun TemperatureTrendChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureTrendChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_POINTS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
