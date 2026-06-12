// The native Jetpack Compose + Material 3 Monthly Cost Trend chart feature view — a parity port of
// web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title + aria fallback + `dataColumns` table +
// loading/empty states + export) around a Recharts `<AreaChart>` with a single gradient-filled `cost` area
// over a `month` X axis, a currency-formatted Y axis (`formatCurrency(v, 0)`), an X-axis tick reformat
// (`YYYY-MM` → `MM/YY`), and a "Cost ($)" tooltip name — and falls back to a "Not enough data" message when
// the series is empty (`data.length > 0`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own: its web
// hooks are `useTranslation` (mapped to the i18n catalog, P1/S10), `useChartPalette` (mapped to the
// generated chart palette), and `useFormatting` (mapped to the currency symbol read from the shared settings
// store, P1/S8). The host supplies the `{ month, cost }[]` series through the shared P1/S8 state-holder layer
// as a [UiState], so this feature view renders every lifecycle state that layer can carry — loading, hard
// error with retry, empty, content, and stale/offline (cached "last known") — without ever fetching. The
// native [ChartContainer] + [AreaChartWrapper] are the faithful counterparts of the web `ChartContainer` +
// `AreaChart`. A web-parity overload that takes the raw `data` + `vehicleId` props is also provided.
//
// Color: the single area resolves to the generated chart palette at position 0 — the native analogue of the
// web `stroke={palette[0]}` + `fill="url(#costGrad)"` (the gradient the web `areaGradient('costGrad',
// palette[0])` builds from the same color). Feature views must not import Vico directly nor alter the shared
// chart layer (allowed-files), so the gradient fill + palette resolution are the shared renderer's concern
// via [AreaChartWrapper] / [paletteColor].
//
// Annotation overlay: the web `annotations={{ vehicleId, scope, chartId }}` drives a ChartContainer
// reference-line overlay that is a shared-charts-layer capability the native shared ChartContainer does not
// yet expose; editing it is outside this surface's allowed files (the sibling ChartContainer surfaces
// observe the same boundary). The binding is preserved faithfully as the pure [MonthlyCostAnnotationScope]
// (the `vehicleId` prop flows into it) and its `chartId` is applied as the chart's stable test tag, so
// wiring the overlay later is a shared-layer change only — no silent drift.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MonthlyCostChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.monthlycostchart

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
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

/** The web `<ChartContainer height={260}>` plot height. */
private val CHART_HEIGHT: Dp = 260.dp

/** Area/series key — the web `<Area dataKey="cost" />`. */
private const val COST_SERIES_KEY: String = "cost"

/** Categorical palette position for the area — the web `stroke={palette[0]}` + `fill` gradient. */
private const val PALETTE_INDEX: Int = 0

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Monthly Cost Trend chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the user's currency symbol from the shared settings store (web
 * `useFormatting`, P1/S8), reproduces the web `annotations` binding from [vehicleId], and renders every
 * lifecycle [state] the shared cost feed can carry. The host owns the feed (P1/S8) and supplies [onRetry]
 * (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `{ month, cost }[]` series (web `data`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param vehicleId the web `vehicleId` prop — flows into the annotation scope's stable chart identity.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the Y axis.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MonthlyCostChart(
    state: UiState<List<MonthlyCostPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    vehicleId: Int? = null,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { MonthlyCostCurrencyPrefs.fromSettings(settingsResource.cached) }
    val annotationScope = remember(vehicleId) { MonthlyCostAnnotationScope.forVehicle(vehicleId) }
    LaunchedEffect(Unit) { recordMonthlyCostChartOpened(logger) }
    MonthlyCostChartContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        currency = currency,
        annotationScope = annotationScope,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ data, vehicleId }` props, for hosts that already hold
 * the computed series. An empty (or `null`) list renders the empty state (the web `data.length > 0` false
 * branch), a non-empty list renders the area. Records `view.opened` and resolves the currency symbol like
 * the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun MonthlyCostChart(
    data: List<MonthlyCostPoint>?,
    modifier: Modifier = Modifier,
    vehicleId: Int? = null,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { MonthlyCostChartProjection.projectUiState(data) }
    MonthlyCostChart(
        state = state,
        onRetry = {},
        modifier = modifier,
        vehicleId = vehicleId,
        settings = settings,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Maps the host feed's
 * [UiState] onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the
 * single [AreaChartWrapper] series in the ready state, reproducing the web `ChartContainer` + `AreaChart`
 * composition: a localized title, the aria fallback description, a currency-formatted Y axis (web
 * `formatCurrency(v, 0)`), the `YYYY-MM` → `MM/YY` X-axis tick reformat, the `Cost ($)` series name, the
 * `dataColumns` fallback table (Month / Cost ($), raw values like the web), the "Not enough data" empty
 * message, and a freshness chip when the cached data is refreshing / stale / offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [currency] supplies the symbol, [locale] formats the
 * Y axis, and [annotationScope] carries the web `annotations` binding (its `chartId` is the chart's tag).
 */
@Composable
fun MonthlyCostChartContent(
    state: UiState<List<MonthlyCostPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currency: MonthlyCostCurrencyPrefs = MonthlyCostCurrencyPrefs.DEFAULT,
    locale: Locale = Locale.getDefault(),
    annotationScope: MonthlyCostAnnotationScope = MonthlyCostAnnotationScope.forVehicle(null),
    strings: MonthlyCostChartStrings = rememberMonthlyCostChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data) {
            MonthlyCostChartProjection.project(
                points = state.data ?: emptyList(),
                formatCostCell = { cost -> MonthlyCostChartProjection.rawCostCell(cost) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // The single area color resolves to the generated chart palette at position 0 — the native analogue of
    // the web `stroke={palette[0]}` and the `costGrad` gradient fill built from the same color.
    val areaColor = paletteColor(PALETTE_INDEX)

    val series =
        remember(result.values, strings.costLabel, areaColor) {
            listOf(
                ChartSeries(
                    key = COST_SERIES_KEY,
                    label = strings.costLabel,
                    values = result.values,
                    kind = ChartSeriesKind.Area,
                    color = areaColor,
                ),
            )
        }

    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier.testTag(annotationScope.chartId),
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { MonthlyCostFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        dataTableHeader = listOf(strings.monthColumn, strings.costColumn),
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = strings.noData,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        AreaChartWrapper(
            series = series,
            xLabels = result.months,
            height = CHART_HEIGHT,
            yValueFormatter = { value ->
                MonthlyCostChartProjection.formatCurrency(value, currency.currencySymbol, COST_DECIMALS, locale)
            },
            xValueFormatter = { month -> MonthlyCostChartProjection.formatMonthTick(month) },
            emptyMessage = strings.noData,
        )
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces'
 * freshness contract; carries no English literal.
 */
@Composable
private fun MonthlyCostFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberMonthlyCostFreshnessFormatter(),
    )
}

/**
 * Builds the localized [MonthlyCostChartStrings] from the i18n catalog (P1/S10): the four
 * `costAnalysis.charts.*` keys the web component reads directly, while the aria description is resolved by
 * name with the reproduced web default (its key is a catalog-absent inline default, ADR-014). Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberMonthlyCostChartStrings(): MonthlyCostChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_costAnalysis_charts_monthlyCost)
    val costLabel = stringResource(R.string.translation_costAnalysis_charts_cost)
    val noData = stringResource(R.string.translation_costAnalysis_charts_noData)
    val monthColumn = stringResource(R.string.translation_costAnalysis_charts_col_month)
    val costColumn = stringResource(R.string.translation_costAnalysis_charts_col_cost)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val ariaLabel = resolveOptional(lookup, KEY_ARIA_LABEL, MonthlyCostChartDefaults.ARIA_LABEL)
    return remember(title, costLabel, noData, monthColumn, costColumn, ariaLabel) {
        MonthlyCostChartStrings(
            title = title,
            ariaLabel = ariaLabel,
            costLabel = costLabel,
            noData = noData,
            monthColumn = monthColumn,
            costColumn = costColumn,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberMonthlyCostFreshnessFormatter(): (FreshnessAge) -> String {
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
 * By-name string resolution backing [resolveOptional] — reads a catalog key that may be absent from the
 * generated resources (the web `t(key, default)` inline-default seam) and returns `null` when missing so the
 * caller falls back to the reproduced web default.
 */
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    MonthlyCostChartStrings(
        title = "Monthly Cost Trend",
        ariaLabel = "Monthly charging cost trend area chart",
        costLabel = "Cost ($)",
        noData = "Not enough data",
        monthColumn = "Month",
        costColumn = "Cost ($)",
    )

private val PREVIEW_POINTS =
    listOf(
        MonthlyCostPoint(month = "2024-01", cost = 42.0),
        MonthlyCostPoint(month = "2024-02", cost = 58.5),
        MonthlyCostPoint(month = "2024-03", cost = 36.0),
        MonthlyCostPoint(month = "2024-04", cost = 71.25),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun MonthlyCostChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun MonthlyCostChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun MonthlyCostChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun MonthlyCostChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            currency = MonthlyCostCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun MonthlyCostChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_POINTS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            currency = MonthlyCostCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
