// The native Jetpack Compose + Material 3 Charging Speed Trend chart feature view — a parity port of
// web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title / subtitle / aria fallback table /
// loading + empty states + CSV export) around a Recharts `<LineChart>` with two lines — the monthly
// average DC and AC charge rate in kW — plus a small legend (`DC Fast` / `AC / Home`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its
// only web hooks are `useTranslation` + `useChartPalette`, mapped here to the i18n catalog and the
// generated chart palette). The host supplies the sessions through the shared P1/S8 state-holder layer as
// a [UiState] (the cache-then-network projection of the charging feed), so this feature view renders every
// lifecycle state that layer can carry — loading, hard error with retry, empty, content, and stale/offline
// (cached "last known") — without ever fetching. The native [ChartContainer] + [LineChartWrapper] +
// [ChartLegend] are the faithful counterparts of the web `ChartContainer` + `LineChart` + legend. A
// web-parity overload that takes the raw `sessions` prop is also provided.
//
// Colors: the two lines resolve to the generated chart palette by position — `categorical[0]` (DC) and
// `categorical[1]` (AC) — exactly mirroring the web `stroke={palette[0]}` / `stroke={palette[1]}` (the web
// `useChartPalette` default is the same Okabe-Ito color-blind-safe ramp the generated `ChartPalette`
// carries). The legend swatches reuse those same two series colors so each swatch correctly identifies its
// line; the web's separate hard-coded swatch hexes (cyan / emerald, which did not match its own palette
// lines) are intentionally not reproduced, as that was a latent web inconsistency. Feature views must not
// import Vico directly nor alter the shared chart layer (allowed-files), so the categorical-palette
// resolution is the shared renderer's concern.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SpeedTrendChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.speedtrendchart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
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
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.LineChartWrapper
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

/** Line/legend series keys — the web `<Line dataKey="dcAvgKw" />` / `<Line dataKey="acAvgKw" />`. */
private const val DC_SERIES_KEY: String = "dcAvgKw"
private const val AC_SERIES_KEY: String = "acAvgKw"

/** The web `<Line unit=" kW" />` tooltip unit suffix. */
private const val KW_UNIT_SUFFIX: String = " kW"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Charging Speed Trend chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `ChargingSession[]` (web `sessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SpeedTrendChart(
    state: UiState<List<ChargingSpeedSession>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSpeedTrendChartOpened(logger) }
    SpeedTrendChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `sessions: ChargingSession[]` prop, for hosts that
 * already hold the loaded list. An empty list renders the empty state (the web `monthlyTrend` is empty when
 * there are no sessions), a non-empty list renders the two lines. Records `view.opened` like the stateful
 * entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SpeedTrendChart(
    sessions: List<ChargingSpeedSession>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(sessions) {
            val items = sessions ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    SpeedTrendChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's
 * [UiState] onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the two
 * [LineChartWrapper] series in the ready state, reproducing the web `ChartContainer` + `LineChart`
 * composition: a localized title/subtitle, the aria fallback description + data table (Month / DC Avg kW /
 * AC Avg kW), an "Avg kW" axis label, a `DC Fast` / `AC / Home` legend, and a freshness chip when the
 * cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [locale] formats the kW values.
 */
@Composable
fun SpeedTrendChartContent(
    state: UiState<List<ChargingSpeedSession>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: SpeedTrendChartStrings = rememberSpeedTrendChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale) {
            SpeedTrendChartProjection.project(
                sessions = state.data ?: emptyList(),
                formatValue = { kw -> SpeedTrendChartProjection.formatKw(kw, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // The two line colors resolve to the generated chart palette by position — the native analogue of the
    // web `palette[0]` / `palette[1]`. Defensive fallbacks keep the surface rendering if the palette is short.
    val palette = TeslaTokens.chart.categorical
    val dcColor = palette.getOrElse(0) { MaterialTheme.colorScheme.primary }
    val acColor = palette.getOrElse(1) { MaterialTheme.colorScheme.secondary }

    val series =
        remember(result.dcValues, result.acValues, strings.dcSeriesLabel, strings.acSeriesLabel, dcColor, acColor) {
            listOf(
                ChartSeries(
                    key = DC_SERIES_KEY,
                    label = strings.dcSeriesLabel,
                    values = result.dcValues,
                    kind = ChartSeriesKind.Line,
                    color = dcColor,
                    unit = KW_UNIT_SUFFIX,
                ),
                ChartSeries(
                    key = AC_SERIES_KEY,
                    label = strings.acSeriesLabel,
                    values = result.acValues,
                    kind = ChartSeriesKind.Line,
                    color = acColor,
                    unit = KW_UNIT_SUFFIX,
                ),
            )
        }

    val legend =
        remember(strings.dcLegendLabel, strings.acLegendLabel, dcColor, acColor) {
            listOf(
                LegendEntry(key = DC_SERIES_KEY, label = strings.dcLegendLabel, color = dcColor),
                LegendEntry(key = AC_SERIES_KEY, label = strings.acLegendLabel, color = acColor),
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
                { SpeedTrendFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        dataTableHeader = listOf(strings.monthColumn, strings.dcColumn, strings.acColumn),
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = emptyMessage,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            // The web rotated `<YAxis label="Avg kW" />`; Vico has no axis-title slot, so the unit is
            // surfaced as a caption above the plot — keeping the `charging.curve.avgKw` key on screen.
            Caption(strings.avgKwLabel)
            LineChartWrapper(
                series = series,
                xLabels = result.months,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> SpeedTrendChartProjection.formatKw(value, locale) },
                emptyMessage = emptyMessage,
            )
            ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun SpeedTrendFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSpeedTrendFreshnessFormatter(),
    )
}

/**
 * Builds the localized [SpeedTrendChartStrings] from the i18n catalog (P1/S10): the `charging.curve.*` keys
 * the web component reads. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberSpeedTrendChartStrings(): SpeedTrendChartStrings {
    val title = stringResource(R.string.translation_charging_curve_speedTrend)
    val subtitle = stringResource(R.string.translation_charging_curve_speedTrendDesc)
    val ariaLabel = stringResource(R.string.translation_charging_curve_speedTrendAria)
    val avgKwLabel = stringResource(R.string.translation_charging_curve_avgKw)
    val monthColumn = stringResource(R.string.translation_charging_curve_col_month)
    val dcColumn = stringResource(R.string.translation_charging_curve_col_dcAvgKw)
    val acColumn = stringResource(R.string.translation_charging_curve_col_acAvgKw)
    val dcSeriesLabel = stringResource(R.string.translation_charging_curve_dcAvg)
    val acSeriesLabel = stringResource(R.string.translation_charging_curve_acAvg)
    val dcLegendLabel = stringResource(R.string.translation_charging_curve_dcFast)
    val acLegendLabel = stringResource(R.string.translation_charging_curve_acHome)
    return remember(
        title,
        subtitle,
        ariaLabel,
        avgKwLabel,
        monthColumn,
        dcColumn,
        acColumn,
        dcSeriesLabel,
        acSeriesLabel,
        dcLegendLabel,
        acLegendLabel,
    ) {
        SpeedTrendChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            avgKwLabel = avgKwLabel,
            monthColumn = monthColumn,
            dcColumn = dcColumn,
            acColumn = acColumn,
            dcSeriesLabel = dcSeriesLabel,
            acSeriesLabel = acSeriesLabel,
            dcLegendLabel = dcLegendLabel,
            acLegendLabel = acLegendLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSpeedTrendFreshnessFormatter(): (FreshnessAge) -> String {
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
    SpeedTrendChartStrings(
        title = "Charging Speed Trend",
        subtitle = "Monthly average DC vs AC charge rate",
        ariaLabel = "Monthly average DC and AC charging speed line chart",
        avgKwLabel = "Avg kW",
        monthColumn = "Month",
        dcColumn = "DC Avg kW",
        acColumn = "AC Avg kW",
        dcSeriesLabel = "DC Avg",
        acSeriesLabel = "AC Avg",
        dcLegendLabel = "DC Fast",
        acLegendLabel = "AC / Home",
    )

private val PREVIEW_SESSIONS =
    listOf(
        ChargingSpeedSession(startedAt = "2026-02-04T08:00:00Z", peakPowerW = 120_000.0, chargerType = "Tesla"),
        ChargingSpeedSession(startedAt = "2026-02-19T22:00:00Z", peakPowerW = 7_400.0, chargerType = null),
        ChargingSpeedSession(startedAt = "2026-03-06T09:30:00Z", peakPowerW = 90_000.0, chargerType = "CCS"),
        ChargingSpeedSession(startedAt = "2026-03-21T23:10:00Z", peakPowerW = 11_000.0, chargerType = null),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SpeedTrendChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedTrendChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SpeedTrendChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedTrendChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SpeedTrendChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedTrendChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SpeedTrendChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedTrendChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_SESSIONS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SpeedTrendChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedTrendChartContent(
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
