// The native Jetpack Compose + Material 3 Charge-Rate-by-Charger-Type chart feature view — a parity port of
// web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title / subtitle / aria fallback table / loading +
// empty states / export) around a Recharts `<ComposedChart>` of two bar series — average power (kW) and
// average energy (kWh) per charger category — followed by a per-category breakdown footer (a colored dot, the
// category label, and "{count} sessions · {avgDuration} min avg").
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog; counts/durations use the localized number
// formatter). The host supplies the sessions through the shared P1/S8 state-holder layer as a [UiState] (the
// cache-then-network projection of the charging feed), so this feature view renders every lifecycle state
// that layer can carry — loading, hard error with retry, empty, content, and stale/offline (cached "last
// known") — without ever fetching. The native [ChartContainer] + [BarChartWrapper] + [ChartLegend] are the
// faithful counterparts of the web `ChartContainer` + `ComposedChart`. A web-parity overload that takes the
// raw `sessions` prop is also provided for hosts that already hold the loaded list.
//
// Colors map to design tokens (never raw hex in render code): the two bar series use the semantic
// `chart.power` (web "Avg Power") and `chart.energy` (web "Avg Energy") tokens; the breakdown dots reproduce
// the web `CHARGER_COLORS[label] ?? CHART_COLORS[3]` resolution exactly — Supercharger → `chart.temperature`
// (the `#EF4444` of the web map) and the others → `paletteColor(3)` (the `#F0E442` Okabe-Ito categorical[3]
// fallback). Per-category bar tinting (web `<Cell>`) is the shared renderer's concern — feature views must
// not import Vico nor alter the shared chart layer (allowed-files) — so the chart carries one color per
// series and the per-category palette is reproduced faithfully in the breakdown footer + legend.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargerTypeChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargertypechart

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
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
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ChartContainer height={280}>` plot height. */
private val CHART_HEIGHT: Dp = 280.dp

/** The breakdown-footer swatch diameter — the web `<span className="h-2 w-2 rounded-full" />` (8 px). */
private val SWATCH_SIZE: Dp = 8.dp

/** Bar series keys — the web `<Bar dataKey="avgKw" />` / `<Bar dataKey="avgKwh" />`. */
private const val AVG_KW_KEY: String = "avgKw"
private const val AVG_KWH_KEY: String = "avgKwh"

/** Fraction digits for the table kW / kWh columns (web `fmtNumber(_, 1)`). */
private const val KW_DECIMALS: Int = 1

/** Fraction digits for the integer columns / axis (web `fmtInt`). */
private const val INT_DECIMALS: Int = 0

/** Fraction digits for the breakdown "min avg" value (web `fmtNumber(_)` at the default precision). */
private const val BREAKDOWN_DECIMALS: Int = 2

/** Okabe-Ito categorical index for the non-Supercharger breakdown dots — the web `CHART_COLORS[3]` fallback. */
private const val CHARGER_FALLBACK_PALETTE_INDEX: Int = 3

/** Em dash shown when a freshness age is unknown — the sibling surfaces' freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the charger-type chart. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `ChargingSession[]` (web `sessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargerTypeChart(
    state: UiState<List<ChargerSession>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordChargerTypeChartOpened(logger) }
    ChargerTypeChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `sessions: ChargingSession[]` prop, for hosts that
 * already hold the loaded list. An empty list renders the empty state (web `chargerTypeStats.length === 0`),
 * a non-empty list renders the bars + breakdown. Records `view.opened` like the stateful entry. There is no
 * fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ChargerTypeChart(
    sessions: List<ChargerSession>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(sessions) {
            val items = sessions ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    ChargerTypeChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and, in the ready state,
 * renders the two-series [BarChartWrapper] + its [ChartLegend] + the per-category breakdown footer,
 * reproducing the web `ChartContainer` + `ComposedChart` + breakdown composition: a localized title/subtitle,
 * the aria fallback description + data table (Charger Type / Sessions / Avg kW / Avg kWh / Avg minutes), and
 * a freshness chip when the cached data is refreshing / stale / offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [locale] formats the counts, kW/kWh, and durations.
 */
@Composable
fun ChargerTypeChartContent(
    state: UiState<List<ChargerSession>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: ChargerTypeChartStrings = rememberChargerTypeChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(strings, locale) {
            ChargerTypeChartFormatters(
                label = { category -> categoryLabel(category, strings) },
                decimal1 = { value -> ChartFormat.number(value, KW_DECIMALS, locale) },
                count = { value -> String.format(locale, "%,d", value) },
                durationInt = { value -> ChartFormat.number(value, INT_DECIMALS, locale) },
                breakdownSummary = { count, avgDurationMin ->
                    val countText = String.format(locale, "%,d", count)
                    val durationText = ChartFormat.number(avgDurationMin, BREAKDOWN_DECIMALS, locale)
                    "$countText ${strings.sessionsUnit} $MIDDOT $durationText ${strings.minAvgUnit}"
                },
            )
        }

    val result = remember(state.data, formatters) { ChargerTypeChartProjection.project(state.data ?: emptyList(), formatters) }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val powerColor = TeslaTokens.chart.power
    val energyColor = TeslaTokens.chart.energy
    val series =
        remember(result.avgKwValues, result.avgKwhValues, strings, powerColor, energyColor) {
            listOf(
                ChartSeries(
                    key = AVG_KW_KEY,
                    label = strings.avgPowerLabel,
                    values = result.avgKwValues,
                    kind = ChartSeriesKind.Bar,
                    color = powerColor,
                    unit = " kW",
                ),
                ChartSeries(
                    key = AVG_KWH_KEY,
                    label = strings.avgEnergyLabel,
                    values = result.avgKwhValues,
                    kind = ChartSeriesKind.Bar,
                    color = energyColor,
                    unit = " kWh",
                ),
            )
        }
    val legend =
        remember(strings, powerColor, energyColor) {
            listOf(
                LegendEntry(key = AVG_KW_KEY, label = strings.avgPowerLabel, color = powerColor),
                LegendEntry(key = AVG_KWH_KEY, label = strings.avgEnergyLabel, color = energyColor),
            )
        }

    val emptyMessage = stringResource(R.string.translation_chart_noData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        subtitle = strings.subtitle,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { ChargerFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        dataTableHeader =
            listOf(
                strings.colCharger,
                strings.colSessions,
                strings.colAvgKw,
                strings.colAvgKwh,
                strings.colAvgMin,
            ),
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = emptyMessage,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            BarChartWrapper(
                series = series,
                xLabels = result.xLabels,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, INT_DECIMALS, locale) },
                emptyMessage = emptyMessage,
            )
            ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
            ChargerTypeBreakdown(rows = result.breakdownRows)
        }
    }
}

/**
 * The per-category breakdown footer — the web `<div className="mt-3 space-y-1 px-2">` list. Each row pairs a
 * colored dot + the category label with the "{count} sessions · {avgDuration} min avg" summary, so the
 * per-charger palette the shared bar renderer can't express per-column is still shown honestly.
 */
@Composable
private fun ChargerTypeBreakdown(rows: List<ChargerBreakdownRow>) {
    if (rows.isEmpty()) return
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        rows.forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "${row.label}, ${row.summary}" },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Box(
                        modifier =
                            Modifier
                                .size(SWATCH_SIZE)
                                .clip(CircleShape)
                                .background(chargerCategoryColor(row.category)),
                    )
                    Caption(row.label)
                }
                Caption(row.summary)
            }
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun ChargerFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberChargerFreshnessFormatter(),
    )
}

/**
 * Resolves a [ChargerCategory] to its localized display label — the render-boundary lookup of the
 * `charging.chargerTypes.*` keys (P1/S10) that keeps grouping logic English-free.
 */
private fun categoryLabel(
    category: ChargerCategory,
    strings: ChargerTypeChartStrings,
): String =
    when (category) {
        ChargerCategory.Supercharger -> strings.superchargerLabel
        ChargerCategory.DcFast -> strings.dcFastLabel
        ChargerCategory.HomeAc -> strings.homeAcLabel
    }

/**
 * Resolves a [ChargerCategory] to its breakdown-dot color via design tokens (P1/S9), reproducing the web
 * `CHARGER_COLORS[label] ?? CHART_COLORS[3]`: Supercharger → `chart.temperature` (the web map's `#EF4444`),
 * the rest → `paletteColor(3)` (the Okabe-Ito `#F0E442` categorical fallback the web reaches for both).
 */
private fun chargerCategoryColor(category: ChargerCategory): Color =
    when (category) {
        ChargerCategory.Supercharger -> TeslaTokens.chart.temperature
        ChargerCategory.DcFast -> paletteColor(CHARGER_FALLBACK_PALETTE_INDEX)
        ChargerCategory.HomeAc -> paletteColor(CHARGER_FALLBACK_PALETTE_INDEX)
    }

/**
 * Builds the localized [ChargerTypeChartStrings] from the i18n catalog (P1/S10): the `charging.curve.*`
 * microcopy the web component reads plus the `charging.chargerTypes.*` category labels. Remembered against
 * the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberChargerTypeChartStrings(): ChargerTypeChartStrings {
    val title = stringResource(R.string.translation_charging_curve_chargerType)
    val subtitle = stringResource(R.string.translation_charging_curve_chargerTypeDesc)
    val ariaLabel = stringResource(R.string.translation_charging_curve_chargerTypeAria)
    val colCharger = stringResource(R.string.translation_charging_curve_col_charger)
    val colSessions = stringResource(R.string.translation_charging_curve_col_sessions)
    val colAvgKw = stringResource(R.string.translation_charging_curve_col_avgKw)
    val colAvgKwh = stringResource(R.string.translation_charging_curve_col_avgKwh)
    val colAvgMin = stringResource(R.string.translation_charging_curve_col_avgMin)
    val avgPower = stringResource(R.string.translation_charging_curve_avgPower)
    val avgEnergy = stringResource(R.string.translation_charging_curve_avgEnergy)
    val sessionsUnit = stringResource(R.string.translation_charging_curve_sessions)
    val minAvgUnit = stringResource(R.string.translation_charging_curve_minAvg)
    val supercharger = stringResource(R.string.translation_charging_chargerTypes_supercharger)
    val dcFast = stringResource(R.string.translation_charging_chargerTypes_dc)
    val homeAc = stringResource(R.string.translation_charging_chargerTypes_home)
    return remember(
        title,
        subtitle,
        ariaLabel,
        colCharger,
        colSessions,
        colAvgKw,
        colAvgKwh,
        colAvgMin,
        avgPower,
        avgEnergy,
        sessionsUnit,
        minAvgUnit,
        supercharger,
        dcFast,
        homeAc,
    ) {
        ChargerTypeChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            colCharger = colCharger,
            colSessions = colSessions,
            colAvgKw = colAvgKw,
            colAvgKwh = colAvgKwh,
            colAvgMin = colAvgMin,
            avgPowerLabel = avgPower,
            avgEnergyLabel = avgEnergy,
            sessionsUnit = sessionsUnit,
            minAvgUnit = minAvgUnit,
            superchargerLabel = supercharger,
            dcFastLabel = dcFast,
            homeAcLabel = homeAc,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChargerFreshnessFormatter(): (FreshnessAge) -> String {
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
    ChargerTypeChartStrings(
        title = "Charge Rate by Charger Type",
        subtitle = "Average kW and kWh per charger category",
        ariaLabel = "Composed bar/line chart of average power and energy per charger type",
        colCharger = "Charger Type",
        colSessions = "Sessions",
        colAvgKw = "Avg kW",
        colAvgKwh = "Avg kWh",
        colAvgMin = "Avg minutes",
        avgPowerLabel = "Avg Power",
        avgEnergyLabel = "Avg Energy",
        sessionsUnit = "sessions",
        minAvgUnit = "min avg",
        superchargerLabel = "Supercharger",
        dcFastLabel = "DC Fast",
        homeAcLabel = "Home / AC",
    )

private val PREVIEW_SESSIONS =
    listOf(
        ChargerSession("Tesla", 150_000.0, 48_000.0, "2026-04-04T10:00:00Z", "2026-04-04T10:35:00Z"),
        ChargerSession("Tesla", 120_000.0, 30_000.0, "2026-04-05T09:00:00Z", "2026-04-05T09:25:00Z"),
        ChargerSession("ChargePoint", 50_000.0, 22_000.0, "2026-04-06T12:00:00Z", "2026-04-06T12:40:00Z"),
        ChargerSession(null, 11_000.0, 18_000.0, "2026-04-07T22:00:00Z", "2026-04-08T05:00:00Z"),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargerTypeChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChargerTypeChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChargerTypeChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChargerTypeChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_SESSIONS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ChargerTypeChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SESSIONS,
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
