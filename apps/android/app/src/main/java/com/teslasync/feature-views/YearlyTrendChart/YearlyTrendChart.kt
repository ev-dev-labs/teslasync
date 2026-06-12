// The native Jetpack Compose + Material 3 Yearly-Charging-Speed-Trend chart feature view — a parity port of
// web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title / subtitle / aria fallback + `dataColumns`
// table / loading + empty states / export) around a Recharts `<ComposedChart>` of a DC-session-count bar
// (right "Sessions" axis) and two time-to-charge lines — `avg10to80` / `avg20to80` (left "Minutes" axis) —
// followed by a custom three-swatch legend.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the yearly trend through
// the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the charging
// feed), so this feature view renders every lifecycle state that layer can carry — loading, hard error with
// retry, empty, content, and stale/offline (cached "last known") — without ever fetching. The native
// [ChartContainer] + [ComboChart] + [ChartLegend] are the faithful counterparts of the web `ChartContainer`
// + `ComposedChart`. A web-parity overload that takes the raw `yearlyTrend` prop is also provided for hosts
// that already hold the loaded list.
//
// Colors map to the generated categorical palette (never raw hex in render code): the 10→80% line uses
// `paletteColor(0)`, the 20→80% line `paletteColor(2)`, and the DC-session bar `paletteColor(5)` — the exact
// `CHART_COLORS[0|2|5]` Okabe-Ito slots the web `<Line stroke>` / `<Bar fill>` resolve (the web custom
// legend's `#00f0ff` / purple / red literals are stale neon values predating the CB-safe palette; the native
// legend uses the true series color so the swatch always matches what is plotted). The web draws two
// independent Y axes (Minutes left, Sessions right); the shared cartesian renderer exposes a single value
// axis and is out of this surface's allowed files, so both scales share one axis and the exact per-year
// values for all four columns stay available — and screen-reader honest — through the `dataColumns`
// fallback table. The two axis titles render as captions framing the plot.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/YearlyTrendChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.yearlytrendchart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ChartContainer height={280}>` plot height. */
private val CHART_HEIGHT: Dp = 280.dp

/** Series keys — the web `<Line dataKey="avg10to80" />` / `"avg20to80"` / `<Bar dataKey="count" />`. */
private const val AVG_10_80_KEY: String = "avg10to80"
private const val AVG_20_80_KEY: String = "avg20to80"
private const val COUNT_KEY: String = "count"

/** Categorical palette slots — the web `CHART_COLORS[0|2|5]` the `<Line>` / `<Bar>` resolve. */
private const val LINE_10_80_COLOR_INDEX: Int = 0
private const val LINE_20_80_COLOR_INDEX: Int = 2
private const val BAR_COUNT_COLOR_INDEX: Int = 5

/** Fraction digits for the two time-to-charge table columns (web `avg* min`). */
private const val AVG_DECIMALS: Int = 1

/** Fraction digits for the shared value axis — whole minutes / sessions. */
private const val AXIS_DECIMALS: Int = 0

/** The web `<Line unit=" min">` series unit, surfaced in the chart's accessible summary. */
private const val MINUTES_UNIT: String = " min"

/** Em dash shown when a freshness age is unknown — the sibling surfaces' freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the yearly-trend chart. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the yearly trend (web `yearlyTrend`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun YearlyTrendChart(
    state: UiState<List<YearlyTrendPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordYearlyTrendChartOpened(logger) }
    YearlyTrendChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `yearlyTrend` prop, for hosts that already hold the
 * loaded list. An empty list renders the empty state (web `yearlyTrend.length > 0` ternary), a non-empty
 * list renders the composed chart. Records `view.opened` like the stateful entry. There is no fetch behind
 * it, so it offers no retry affordance.
 */
@Composable
fun YearlyTrendChart(
    yearlyTrend: List<YearlyTrendPoint>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(yearlyTrend) {
            val items = yearlyTrend ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    YearlyTrendChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and, in the ready state,
 * renders the [ComboChart] (the DC-session bar + two time-to-charge lines), its axis-title captions, and the
 * three-swatch [ChartLegend], reproducing the web `ChartContainer` + `ComposedChart` composition: a
 * localized title/subtitle, the aria fallback description + `dataColumns` table (Year / 10→80% avg min /
 * 20→80% avg min / DC Sessions), and a freshness chip when the cached data is refreshing / stale / offline.
 * Stale (non-error) data auto-refreshes, mirroring the web freshness contract. [locale] formats the minutes,
 * counts, and axis ticks.
 */
@Composable
fun YearlyTrendChartContent(
    state: UiState<List<YearlyTrendPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: YearlyTrendChartStrings = rememberYearlyTrendChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(locale) {
            YearlyTrendChartFormatters(
                avgMinutes = { value -> ChartFormat.number(value, AVG_DECIMALS, locale) },
                sessionCount = { value -> String.format(locale, "%,d", value) },
            )
        }

    val result =
        remember(state.data, formatters) {
            YearlyTrendChartProjection.project(state.data ?: emptyList(), formatters)
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val line10to80Color = paletteColor(LINE_10_80_COLOR_INDEX)
    val line20to80Color = paletteColor(LINE_20_80_COLOR_INDEX)
    val barCountColor = paletteColor(BAR_COUNT_COLOR_INDEX)

    val series =
        remember(result, strings, line10to80Color, line20to80Color, barCountColor) {
            listOf(
                ChartSeries(
                    key = COUNT_KEY,
                    label = strings.dcSessionsLabel,
                    values = result.countValues,
                    kind = ChartSeriesKind.Bar,
                    color = barCountColor,
                ),
                ChartSeries(
                    key = AVG_10_80_KEY,
                    label = strings.avg10to80Label,
                    values = result.avg10to80Values,
                    kind = ChartSeriesKind.Line,
                    color = line10to80Color,
                    unit = MINUTES_UNIT,
                ),
                ChartSeries(
                    key = AVG_20_80_KEY,
                    label = strings.avg20to80Label,
                    values = result.avg20to80Values,
                    kind = ChartSeriesKind.Line,
                    color = line20to80Color,
                    unit = MINUTES_UNIT,
                ),
            )
        }
    val legend =
        remember(strings, line10to80Color, line20to80Color, barCountColor) {
            listOf(
                LegendEntry(key = AVG_10_80_KEY, label = strings.avg10to80Label, color = line10to80Color),
                LegendEntry(key = AVG_20_80_KEY, label = strings.avg20to80Label, color = line20to80Color),
                LegendEntry(key = COUNT_KEY, label = strings.dcSessionsLabel, color = barCountColor),
            )
        }

    val emptyMessage = stringResource(R.string.translation_common_noData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        subtitle = strings.subtitle,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { YearlyTrendFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        dataTableHeader =
            listOf(
                strings.colYear,
                strings.colAvg10to80,
                strings.colAvg20to80,
                strings.colDcSessions,
            ),
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = emptyMessage,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Caption(strings.minutesAxisLabel)
                Caption(strings.sessionsAxisLabel)
            }
            ComboChart(
                series = series,
                xLabels = result.xLabels,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, AXIS_DECIMALS, locale) },
                emptyMessage = emptyMessage,
            )
            ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun YearlyTrendFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberYearlyTrendFreshnessFormatter(),
    )
}

/**
 * Builds the localized [YearlyTrendChartStrings] from the i18n catalog (P1/S10): the title, column headers,
 * axis titles, and series labels read directly, while the subtitle + aria are resolved by name with the
 * reproduced web default (their keys are catalog-absent inline defaults). Remembered against the resolved
 * strings so a locale change re-projects.
 */
@Composable
private fun rememberYearlyTrendChartStrings(): YearlyTrendChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_charging_curve_yearlyTrend)
    val colYear = stringResource(R.string.translation_charging_curve_col_year)
    val colAvg10to80 = stringResource(R.string.translation_charging_curve_col_avg10to80)
    val colAvg20to80 = stringResource(R.string.translation_charging_curve_col_avg20to80)
    val colDcSessions = stringResource(R.string.translation_charging_curve_col_dcSessions)
    val minutesAxis = stringResource(R.string.translation_charging_curve_minutes)
    val sessionsAxis = stringResource(R.string.translation_charging_curve_sessionCount)
    val avg10to80Label = stringResource(R.string.translation_charging_curve_avg10to80Line)
    val avg20to80Label = stringResource(R.string.translation_charging_curve_avg20to80Line)
    val dcSessionsLabel = stringResource(R.string.translation_charging_curve_dcSessions)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val subtitle = resolveOptional(lookup, KEY_SUBTITLE, YearlyTrendChartDefaults.SUBTITLE)
    val ariaLabel = resolveOptional(lookup, KEY_ARIA_LABEL, YearlyTrendChartDefaults.ARIA_LABEL)
    return remember(
        title,
        subtitle,
        ariaLabel,
        colYear,
        colAvg10to80,
        colAvg20to80,
        colDcSessions,
        minutesAxis,
        sessionsAxis,
        avg10to80Label,
        avg20to80Label,
        dcSessionsLabel,
    ) {
        YearlyTrendChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            colYear = colYear,
            colAvg10to80 = colAvg10to80,
            colAvg20to80 = colAvg20to80,
            colDcSessions = colDcSessions,
            minutesAxisLabel = minutesAxis,
            sessionsAxisLabel = sessionsAxis,
            avg10to80Label = avg10to80Label,
            avg20to80Label = avg20to80Label,
            dcSessionsLabel = dcSessionsLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberYearlyTrendFreshnessFormatter(): (FreshnessAge) -> String {
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
    YearlyTrendChartStrings(
        title = "Yearly Charging Speed Trend",
        subtitle = "Average time-to-charge and session count by year",
        ariaLabel = "Yearly average charge-time and session-count composed chart",
        colYear = "Year",
        colAvg10to80 = "10→80% avg min",
        colAvg20to80 = "20→80% avg min",
        colDcSessions = "DC Sessions",
        minutesAxisLabel = "Minutes",
        sessionsAxisLabel = "Sessions",
        avg10to80Label = "10→80% avg",
        avg20to80Label = "20→80% avg",
        dcSessionsLabel = "DC Sessions",
    )

private val PREVIEW_POINTS =
    listOf(
        YearlyTrendPoint(year = "2023", avg10to80 = 42.5, avg20to80 = 31.2, count = 84),
        YearlyTrendPoint(year = "2024", avg10to80 = 38.1, avg20to80 = 28.7, count = 132),
        YearlyTrendPoint(year = "2025", avg10to80 = 35.6, avg20to80 = 26.4, count = 167),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun YearlyTrendChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        YearlyTrendChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun YearlyTrendChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        YearlyTrendChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun YearlyTrendChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        YearlyTrendChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun YearlyTrendChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        YearlyTrendChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun YearlyTrendChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        YearlyTrendChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_POINTS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
