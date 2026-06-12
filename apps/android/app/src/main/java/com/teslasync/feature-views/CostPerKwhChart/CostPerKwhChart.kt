// The native Jetpack Compose + Material 3 Cost per kWh Trend chart feature view — a parity port of
// web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx. The web component is purely
// presentational: it wraps a `<GlassPanel>` (title + a decorative BarChart3 glyph) around a Recharts
// `<LineChart>` with a single line — the per-session `costPerKwh` over a `date` X axis, a currency-
// formatted Y axis (`formatCurrency(v, 2)`), and a `$/kWh` tooltip name — and falls back to a
// "Not enough data" message when the series is empty (`data.length > 0`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own: its web
// hooks are `useTranslation` (mapped to the i18n catalog, P1/S10), `useChartPalette` (mapped to the
// generated chart palette), and `useFormatting` (mapped to the currency symbol read from the shared
// settings store, P1/S8). The host supplies the `{ date, costPerKwh }[]` series through the shared P1/S8
// state-holder layer as a [UiState], so this feature view renders every lifecycle state that layer can
// carry — loading, hard error with retry, empty, content, and stale/offline (cached "last known") —
// without ever fetching. The native [ChartContainer] + [LineChartWrapper] are the faithful counterparts of
// the web `GlassPanel` + `LineChart`. A web-parity overload that takes the raw `data` prop is also provided.
//
// Color: the single line resolves to the generated chart palette at position 2 — the native analogue of
// the web `stroke={palette[2]}` (the web `useChartPalette` default is the same Okabe-Ito color-blind-safe
// ramp the generated `ChartPalette` carries). Feature views must not import Vico directly nor alter the
// shared chart layer (allowed-files), so the categorical-palette resolution is the shared renderer's
// concern via [paletteColor]. The web title's decorative BarChart3 icon is intentionally not reproduced:
// `ChartContainer`'s `PanelTitle` is the shared text-title slot (no leading-icon parameter), and the
// sibling chart surfaces drop the same decorative glyph rather than introduce ad-hoc header layout.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CostPerKwhChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costperkwhchart

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** The web `<ResponsiveContainer height={260}>` plot height. */
private val CHART_HEIGHT: Dp = 260.dp

/** Line/series key — the web `<Line dataKey="costPerKwh" />`. */
private const val COST_SERIES_KEY: String = "costPerKwh"

/** Categorical palette position for the line — the web `stroke={palette[2]}`. */
private const val PALETTE_INDEX: Int = 2

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Cost per kWh Trend chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the user's currency symbol from the shared settings store (web
 * `useFormatting`, P1/S8), and renders every lifecycle [state] the shared cost feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `{ date, costPerKwh }[]` series (web `data`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the Y axis + table.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CostPerKwhChart(
    state: UiState<List<CostPerKwhPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { CostCurrencyPrefs.fromSettings(settingsResource.cached) }
    LaunchedEffect(Unit) { recordCostPerKwhChartOpened(logger) }
    CostPerKwhChartContent(state = state, onRetry = onRetry, modifier = modifier, currency = currency)
}

/**
 * Web-parity overload mirroring the web component's `{ data }` prop, for hosts that already hold the
 * computed series. An empty (or `null`) list renders the empty state (the web `data.length > 0` false
 * branch), a non-empty list renders the line. Records `view.opened` and resolves the currency symbol like
 * the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun CostPerKwhChart(
    data: List<CostPerKwhPoint>?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { CostPerKwhChartProjection.projectUiState(data) }
    CostPerKwhChart(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Maps the host
 * feed's [UiState] onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders
 * the single [LineChartWrapper] series in the ready state, reproducing the web `GlassPanel` + `LineChart`
 * composition: a localized title, a currency-formatted Y axis (web `formatCurrency(v, 2)`), the `date` X
 * axis, the `$/kWh` series name, an accessible chart description + fallback data table (Date / $/kWh), the
 * "Not enough data" empty message, and a freshness chip when the cached data is refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract. [currency] supplies
 * the symbol and [locale] formats the values.
 */
@Composable
fun CostPerKwhChartContent(
    state: UiState<List<CostPerKwhPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currency: CostCurrencyPrefs = CostCurrencyPrefs.DEFAULT,
    locale: Locale = Locale.getDefault(),
    strings: CostPerKwhChartStrings = rememberCostPerKwhChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, currency, locale) {
            CostPerKwhChartProjection.project(
                points = state.data ?: emptyList(),
                formatValue = { cost ->
                    CostPerKwhChartProjection.formatCurrency(cost, currency.currencySymbol, COST_DECIMALS, locale)
                },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // The single line color resolves to the generated chart palette at position 2 — the native analogue of
    // the web `stroke={palette[2]}`. An explicit color is required: a lone series with a `null` color would
    // otherwise resolve to palette position 0, not 2.
    val lineColor = paletteColor(PALETTE_INDEX)

    val series =
        remember(result.values, strings.rateLabel, lineColor) {
            listOf(
                ChartSeries(
                    key = COST_SERIES_KEY,
                    label = strings.rateLabel,
                    values = result.values,
                    kind = ChartSeriesKind.Line,
                    color = lineColor,
                ),
            )
        }

    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { CostPerKwhFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.accessibleDescription,
        dataTableHeader = listOf(strings.dateColumn, strings.rateLabel),
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = strings.noData,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        LineChartWrapper(
            series = series,
            xLabels = result.dates,
            height = CHART_HEIGHT,
            yValueFormatter = { value ->
                CostPerKwhChartProjection.formatCurrency(value, currency.currencySymbol, COST_DECIMALS, locale)
            },
            emptyMessage = strings.noData,
        )
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun CostPerKwhFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberCostPerKwhFreshnessFormatter(),
    )
}

/**
 * Builds the localized [CostPerKwhChartStrings] from the i18n catalog (P1/S10): the three
 * `costAnalysis.charts.*` keys the web component reads, plus the generic `common.date` table header and the
 * title reused as the chart's accessible description. Remembered against the resolved strings so a locale
 * change re-projects.
 */
@Composable
private fun rememberCostPerKwhChartStrings(): CostPerKwhChartStrings {
    val title = stringResource(R.string.translation_costAnalysis_charts_costPerKwh)
    val rateLabel = stringResource(R.string.translation_costAnalysis_charts_rateLabel)
    val noData = stringResource(R.string.translation_costAnalysis_charts_noData)
    val dateColumn = stringResource(R.string.translation_common_date)
    return remember(title, rateLabel, noData, dateColumn) {
        CostPerKwhChartStrings(
            title = title,
            rateLabel = rateLabel,
            noData = noData,
            accessibleDescription = title,
            dateColumn = dateColumn,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberCostPerKwhFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    CostPerKwhChartStrings(
        title = "Cost per kWh Trend",
        rateLabel = "$/kWh",
        noData = "Not enough data",
        accessibleDescription = "Cost per kWh Trend",
        dateColumn = "Date",
    )

private val PREVIEW_POINTS =
    listOf(
        CostPerKwhPoint(date = "Jan 4", costPerKwh = 0.12),
        CostPerKwhPoint(date = "Feb 19", costPerKwh = 0.18),
        CostPerKwhPoint(date = "Mar 6", costPerKwh = 0.09),
        CostPerKwhPoint(date = "Mar 21", costPerKwh = 0.15),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun CostPerKwhChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostPerKwhChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun CostPerKwhChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostPerKwhChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun CostPerKwhChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostPerKwhChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun CostPerKwhChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostPerKwhChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            currency = CostCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun CostPerKwhChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostPerKwhChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_POINTS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            currency = CostCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
