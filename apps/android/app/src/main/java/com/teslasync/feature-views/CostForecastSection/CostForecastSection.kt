// The native Jetpack Compose + Material 3 Cost-Forecast feature view — a parity port of
// web/src/features/charging/components/cost-analysis/CostForecastSection.tsx. The web component is purely
// presentational: it wraps two `GlassPanel`s (each in a `FadeIn`) around Recharts charts — a `ComposedChart`
// of the realized `actual` cost area plus the projected line and its `95% Confidence` band, and a
// `LineChart` of the historical cost-per-kWh trend — each falling back to a friendly `EmptyState` when there
// is not enough data. (The sibling `ForecastDetails` block the web component also composes is a SEPARATE
// surface with its own prompt, A-0113, so it is intentionally not rendered here.)
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped here to the i18n catalog, and `useChartPalette`, mapped to the
// generated categorical palette). The host supplies the forecast data through the shared P1/S8 state-holder
// layer as a [UiState], so this feature view renders every lifecycle state that layer can carry — loading,
// hard error with retry, empty, content, and stale/offline (cached "last known") — without ever fetching.
// The native [ChartContainer] + [ComboChart] / [LineChartWrapper] + [ChartLegend] are the faithful
// counterparts of the web `GlassPanel` + `ComposedChart` / `LineChart`. A web-parity overload that takes the
// raw `forecastData` prop is also provided for hosts that already hold the loaded value.
//
// Colors map to the generated categorical palette (never raw hex in render code): the realized `actual` cost
// uses `paletteColor(0)` — the exact `CHART_COLORS[0]` slot the web `useChartPalette()[0]` resolves — while
// the projected line and confidence band use the color-blind-safe reddish-purple `paletteColor(6)` and the
// cost-per-kWh line the sky-blue `paletteColor(4)`. The web `#a855f7` / `#06b6d4` literals are stale neon
// values predating the CB-safe palette, so the legend uses the true plotted series color. The shared
// cartesian renderer exposes a single value axis and fills areas from the baseline, so the floating
// `95% Confidence` band is drawn as the upper-bound area while the exact low and high stay available — and
// screen-reader honest — through the forecast fallback table's Low/High columns.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CostForecastSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costforecastsection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
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
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ResponsiveContainer height={300}>` forecast-chart height. */
private val FORECAST_CHART_HEIGHT: Dp = 300.dp

/** The web `<ResponsiveContainer height={200}>` cost-per-kWh-trend height. */
private val TREND_CHART_HEIGHT: Dp = 200.dp

/** Series keys — the web `<Area dataKey="actual" />` / the confidence band / `<Line dataKey="forecast" />`. */
private const val ACTUAL_KEY: String = "actual"
private const val CONFIDENCE_KEY: String = "confidence"
private const val PROJECTED_KEY: String = "forecast"
private const val COST_PER_KWH_KEY: String = "cost_per_kwh"

/** Categorical palette slots — the realized cost (`CHART_COLORS[0]`), the purple forecast, the cyan trend. */
private const val ACTUAL_COLOR_INDEX: Int = 0
private const val CONFIDENCE_COLOR_INDEX: Int = 6
private const val PROJECTED_COLOR_INDEX: Int = 6
private const val COST_PER_KWH_COLOR_INDEX: Int = 4

/** Fraction digits for the shared cost value axis (whole currency units). */
private const val COST_AXIS_DECIMALS: Int = 0

/** Fraction digits for the cost cells in the forecast fallback table. */
private const val COST_TABLE_DECIMALS: Int = 2

/** Fraction digits for the cost-per-kWh axis + cells (the web renders this price to three places). */
private const val COST_PER_KWH_DECIMALS: Int = 3

/** The display currency marker — the web `<YAxis unit="$">`. Replaced by `useFormatting` at the host later. */
private const val CURRENCY_PREFIX: String = "$"

/**
 * Stateful entry point for the cost-forecast surface. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared charging-cost feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the forecast data (web `forecastData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CostForecastSection(
    state: UiState<CostForecastSectionData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordCostForecastSectionOpened(logger) }
    CostForecastSectionContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `forecastData` prop, for hosts that already hold the
 * loaded value. A `null` or all-empty value renders both panels' friendly empty states (the web
 * `hasForecast` / `hasCostPerKwhTrend` ternaries), a populated value renders the charts. Records
 * `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun CostForecastSection(
    forecastData: CostForecastSectionData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(forecastData) {
            val data = forecastData ?: CostForecastSectionData.EMPTY
            val hasAny = data.historical.isNotEmpty() || data.forecast.isNotEmpty()
            UiState(phase = if (hasAny) UiPhase.Content else UiPhase.Empty, data = data)
        }
    CostForecastSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto two [ChartContainer]s (loading / error+retry / empty / ready). When ready, the first renders the
 * [ComboChart] (the realized `actual` cost area, the `95% Confidence` upper-bound area, and the projected
 * line) plus its three-swatch [ChartLegend] and the Month / Actual / Projected / Low / High fallback table;
 * the second renders the cost-per-kWh [LineChartWrapper], its single-swatch legend, and the Month / $-per-kWh
 * table. Each panel independently shows its friendly empty state — the web `needData` / `needTrendData`
 * messages — when its data gate is unmet, so a section is never blank. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the currency amounts and axis ticks.
 */
@Composable
fun CostForecastSectionContent(
    state: UiState<CostForecastSectionData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: CostForecastSectionStrings = rememberCostForecastSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(locale) {
            CostForecastChartFormatters(
                cost = { value -> formatCurrency(value, COST_TABLE_DECIMALS, locale) },
                costPerKwh = { value -> formatCurrency(value, COST_PER_KWH_DECIMALS, locale) },
            )
        }
    val result =
        remember(state.data, formatters) {
            CostForecastSectionProjection.project(state.data ?: CostForecastSectionData.EMPTY, formatters)
        }

    val actualColor = paletteColor(ACTUAL_COLOR_INDEX)
    val confidenceColor = paletteColor(CONFIDENCE_COLOR_INDEX)
    val projectedColor = paletteColor(PROJECTED_COLOR_INDEX)
    val costPerKwhColor = paletteColor(COST_PER_KWH_COLOR_INDEX)

    val forecastSeries =
        remember(result, strings, actualColor, confidenceColor, projectedColor) {
            listOf(
                ChartSeries(ACTUAL_KEY, strings.actualLabel, result.actualValues, ChartSeriesKind.Area, actualColor),
                ChartSeries(
                    key = CONFIDENCE_KEY,
                    label = strings.confidenceLabel,
                    values = result.confidenceHighValues,
                    kind = ChartSeriesKind.Area,
                    color = confidenceColor,
                ),
                ChartSeries(PROJECTED_KEY, strings.projectedLabel, result.projectedValues, ChartSeriesKind.Line, projectedColor),
            )
        }
    val forecastLegend =
        remember(strings, actualColor, confidenceColor, projectedColor) {
            listOf(
                LegendEntry(ACTUAL_KEY, strings.actualLabel, actualColor),
                LegendEntry(CONFIDENCE_KEY, strings.confidenceLabel, confidenceColor),
                LegendEntry(PROJECTED_KEY, strings.projectedLabel, projectedColor),
            )
        }
    val trendSeries =
        remember(result, strings, costPerKwhColor) {
            listOf(
                ChartSeries(COST_PER_KWH_KEY, strings.costPerKwhLabel, result.costPerKwhValues, ChartSeriesKind.Line, costPerKwhColor),
            )
        }
    val trendLegend =
        remember(strings, costPerKwhColor) {
            listOf(LegendEntry(COST_PER_KWH_KEY, strings.costPerKwhLabel, costPerKwhColor))
        }

    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
    val forecastStatus = panelStatus(state, result.hasForecast)
    val trendStatus = panelStatus(state, result.hasCostPerKwhTrend)

    val costAxisFormatter: (Double) -> String = { formatCurrency(it, COST_AXIS_DECIMALS, locale) }
    val costPerKwhAxisFormatter: (Double) -> String = { formatCurrency(it, COST_PER_KWH_DECIMALS, locale) }

    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retryLabel = stringResource(R.string.translation_common_retry)
    val detailsLabel = stringResource(R.string.translation_Details)

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        FadeIn {
            ChartContainer(
                title = strings.forecastTitle,
                status = forecastStatus,
                height = FORECAST_CHART_HEIGHT,
                action =
                    if (showFreshness) {
                        { CostForecastFreshnessChip(state) }
                    } else {
                        null
                    },
                dataTableHeader =
                    listOf(
                        strings.monthHeader,
                        strings.actualLabel,
                        strings.projectedLabel,
                        strings.lowHeader,
                        strings.highHeader,
                    ),
                dataTableRows = result.forecastTableRows,
                dataTableLabel = detailsLabel,
                emptyMessage = strings.needDataMessage,
                errorMessage = errorMessage,
                retryLabel = retryLabel,
                onRetry = onRetry,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    ComboChart(
                        series = forecastSeries,
                        xLabels = result.forecastXLabels,
                        height = FORECAST_CHART_HEIGHT,
                        yValueFormatter = costAxisFormatter,
                        emptyMessage = strings.needDataMessage,
                    )
                    ChartLegend(entries = forecastLegend, modifier = Modifier.fillMaxWidth())
                }
            }
        }
        FadeIn {
            ChartContainer(
                title = strings.trendTitle,
                status = trendStatus,
                height = TREND_CHART_HEIGHT,
                action =
                    if (showFreshness) {
                        { CostForecastFreshnessChip(state) }
                    } else {
                        null
                    },
                dataTableHeader = listOf(strings.monthHeader, strings.costPerKwhLabel),
                dataTableRows = result.trendTableRows,
                dataTableLabel = detailsLabel,
                emptyMessage = strings.needTrendDataMessage,
                errorMessage = errorMessage,
                retryLabel = retryLabel,
                onRetry = onRetry,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    LineChartWrapper(
                        series = trendSeries,
                        xLabels = result.trendXLabels,
                        height = TREND_CHART_HEIGHT,
                        yValueFormatter = costPerKwhAxisFormatter,
                        emptyMessage = strings.needTrendDataMessage,
                    )
                    ChartLegend(entries = trendLegend, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

/**
 * Maps the shared [state] + a panel's own data gate ([hasData]) onto the [ChartContainer] lifecycle: a first
 * load is [ChartStatus.Loading], a hard error is [ChartStatus.Error] (with retry), an unmet data gate is the
 * friendly [ChartStatus.Empty], and otherwise the chart is [ChartStatus.Ready]. The empty branch covers both
 * a truly empty feed and a present-but-insufficient one (the web `hasForecast` / `hasCostPerKwhTrend` gates).
 */
private fun panelStatus(
    state: UiState<*>,
    hasData: Boolean,
): ChartStatus =
    when {
        state.isLoading -> ChartStatus.Loading
        state.isError -> ChartStatus.Error
        hasData -> ChartStatus.Ready
        else -> ChartStatus.Empty
    }

/** Currency-marked, locale-grouped amount; a non-finite value renders as the em dash, never `$NaN`. */
private fun formatCurrency(
    value: Double,
    decimals: Int,
    locale: Locale,
): String = if (!value.isFinite()) CELL_EMPTY else CURRENCY_PREFIX + ChartFormat.number(value, decimals, locale)

/**
 * The freshness chip rendered in a container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun CostForecastFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberCostForecastFreshnessFormatter(),
    )
}

/**
 * Builds the localized [CostForecastSectionStrings] from the i18n catalog (P1/S10): every
 * `costAnalysis.forecast.*` key the web component resolves via `t(...)`, plus the generic Month / Low / High
 * headers the native fallback tables need. Remembered against the resolved strings so a locale change
 * re-projects.
 */
@Composable
private fun rememberCostForecastSectionStrings(): CostForecastSectionStrings {
    val forecastTitle = stringResource(R.string.translation_costAnalysis_forecast_title)
    val trendTitle = stringResource(R.string.translation_costAnalysis_forecast_costPerKwhTrend)
    val actualLabel = stringResource(R.string.translation_costAnalysis_forecast_actual)
    val confidenceLabel = stringResource(R.string.translation_costAnalysis_forecast_confidence)
    val projectedLabel = stringResource(R.string.translation_costAnalysis_forecast_projected)
    val costPerKwhLabel = stringResource(R.string.translation_costAnalysis_forecast_costPerKwh)
    val needDataMessage = stringResource(R.string.translation_costAnalysis_forecast_needData)
    val needTrendDataMessage = stringResource(R.string.translation_costAnalysis_forecast_needTrendData)
    val monthHeader = stringResource(R.string.translation_Month)
    val lowHeader = stringResource(R.string.translation_common_low)
    val highHeader = stringResource(R.string.translation_High)
    return remember(
        forecastTitle,
        trendTitle,
        actualLabel,
        confidenceLabel,
        projectedLabel,
        costPerKwhLabel,
        needDataMessage,
        needTrendDataMessage,
        monthHeader,
        lowHeader,
        highHeader,
    ) {
        CostForecastSectionStrings(
            forecastTitle = forecastTitle,
            trendTitle = trendTitle,
            actualLabel = actualLabel,
            confidenceLabel = confidenceLabel,
            projectedLabel = projectedLabel,
            costPerKwhLabel = costPerKwhLabel,
            needDataMessage = needDataMessage,
            needTrendDataMessage = needTrendDataMessage,
            monthHeader = monthHeader,
            lowHeader = lowHeader,
            highHeader = highHeader,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberCostForecastFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> CELL_EMPTY
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    CostForecastSectionStrings(
        forecastTitle = "Cost Forecast",
        trendTitle = "Cost per kWh Trend",
        actualLabel = "Actual Cost",
        confidenceLabel = "95% Confidence",
        projectedLabel = "Projected Cost",
        costPerKwhLabel = "\$/kWh",
        needDataMessage = "Need at least 3 months of charging data for cost forecasting.",
        needTrendDataMessage = "Need at least 2 months of charging data to show the cost per kWh trend.",
        monthHeader = "Month",
        lowHeader = "Low",
        highHeader = "High",
    )

private val PREVIEW_DATA =
    CostForecastSectionData(
        historical =
            listOf(
                CostForecastHistoricalPoint(month = "Jan", cost = 52.0, costPerKwh = 0.130),
                CostForecastHistoricalPoint(month = "Feb", cost = 48.5, costPerKwh = 0.128),
                CostForecastHistoricalPoint(month = "Mar", cost = 60.25, costPerKwh = 0.142),
            ),
        forecast =
            listOf(
                CostForecastProjectedPoint(month = "Apr", cost = 58.0, costLow = 50.0, costHigh = 66.0),
                CostForecastProjectedPoint(month = "May", cost = 61.0, costLow = 52.0, costHigh = 70.0),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun CostForecastSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostForecastSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun CostForecastSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostForecastSectionContent(
            state = UiState(UiPhase.Empty, data = CostForecastSectionData.EMPTY),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun CostForecastSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostForecastSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun CostForecastSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostForecastSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun CostForecastSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostForecastSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
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
