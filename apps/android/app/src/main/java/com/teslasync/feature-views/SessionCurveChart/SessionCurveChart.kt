// The native Jetpack Compose + Material 3 Session Curve chart feature view — a parity port of
// web/src/features/charging/components/charging-curve/SessionCurveChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title / subtitle / aria fallback table / loading +
// empty states / export) around a Recharts `<AreaChart>` of charging `power` (kW) versus `soc` (%), a single
// gradient-filled area series in the brand `CHART_COLORS[0]`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the curve through the
// shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the selected charging
// session's curve), so this feature view renders every lifecycle state that layer can carry — loading, hard
// error with retry, empty, content, and stale/offline (cached "last known") — without ever fetching. The
// native [ChartContainer] + [AreaChartWrapper] are the faithful counterparts of the web `ChartContainer` +
// `AreaChart`; the `paletteColor(0)` brand colour is the token analogue of the web `CHART_COLORS[0]`. The web
// `XAxis`/`YAxis` axis-title labels ("SOC (%)" / "Power (kW)") are surfaced as captions around the plot,
// since the shared chart wrapper exposes no axis-title slot and the shared layer must not be altered. A
// web-parity overload that takes the raw `curveData` prop is also provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SessionCurveChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessioncurvechart

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
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
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

/** The web `<ChartContainer height={320}>` plot height. */
private val CHART_HEIGHT: Dp = 320.dp

/** The single area series key — the web `<Area dataKey="power" />`. */
private const val POWER_SERIES_KEY: String = "power"

/** The power unit suffix shown in the hover marker — the web `<Area unit=" kW" />`. */
private const val KW_UNIT: String = "kW"

/**
 * Stateful entry point for the session power-vs-soc curve. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared charging-curve feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `CurvePoint[]` (web `curveData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SessionCurveChart(
    state: UiState<List<CurvePoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSessionCurveChartOpened(logger) }
    SessionCurveChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `curveData: CurvePoint[]` prop, for hosts that already
 * hold the loaded curve. An empty list renders the empty state (the web `ChartContainer` shows its own empty
 * surface when `data` is empty), a non-empty list renders the area. Records `view.opened` like the stateful
 * entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SessionCurveChart(
    curveData: List<CurvePoint>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(curveData) {
            val items = curveData ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    SessionCurveChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the
 * [AreaChartWrapper] in the ready state, reproducing the web `ChartContainer` + `AreaChart` composition: a
 * localized title/subtitle, the aria fallback description + data table (SOC % / Power (kW)), the X/Y axis
 * titles as captions, and a freshness chip when the cached data is refreshing / stale / offline. Stale
 * (non-error) data auto-refreshes, mirroring the web freshness contract. [locale] formats the soc labels and
 * power values.
 */
@Composable
fun SessionCurveChartContent(
    state: UiState<List<CurvePoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: SessionCurveChartStrings = rememberSessionCurveChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale) {
            SessionCurveChartProjection.project(
                points = state.data ?: emptyList(),
                formatSoc = { SessionCurveChartProjection.formatSoc(it, locale) },
                formatPower = { SessionCurveChartProjection.formatPower(it, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val areaColor = paletteColor(0)
    val series =
        remember(result.powerValues, strings.seriesLabel, areaColor) {
            listOf(
                ChartSeries(
                    key = POWER_SERIES_KEY,
                    label = strings.seriesLabel,
                    values = result.powerValues,
                    kind = ChartSeriesKind.Area,
                    color = areaColor,
                    unit = KW_UNIT,
                ),
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
                { SessionCurveFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        dataTableHeader = listOf(strings.socColumn, strings.powerColumn),
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = emptyMessage,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        SessionCurvePlot(series = series, xLabels = result.xLabels, strings = strings, locale = locale, emptyMessage = emptyMessage)
    }
}

/**
 * The populated plot — the single power area series fed to the shared [AreaChartWrapper], framed by the two
 * axis-title captions the web renders as `XAxis`/`YAxis` `label`s ("Power (kW)" above the plot, "SOC (%)"
 * aligned to the bottom-right). The Y-axis tick formatter shows power to one decimal, the web data precision.
 */
@Composable
private fun SessionCurvePlot(
    series: List<ChartSeries>,
    xLabels: List<String>,
    strings: SessionCurveChartStrings,
    locale: Locale,
    emptyMessage: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(strings.yAxisLabel)
        AreaChartWrapper(
            series = series,
            xLabels = xLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { value -> ChartFormat.number(value, POWER_DECIMALS, locale) },
            emptyMessage = emptyMessage,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Caption(strings.xAxisLabel)
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' freshness
 * contract; carries no English literal.
 */
@Composable
private fun SessionCurveFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSessionCurveFreshnessFormatter(),
    )
}

/**
 * Builds the localized [SessionCurveChartStrings] from the i18n catalog (P1/S10): the six visible keys resolve
 * through compile-time resources; the subtitle + aria description resolve by-name with the web `t(key, default)`
 * fallback, since the catalog defines no key for them. Remembered against the resolved strings so a locale
 * change re-projects.
 */
@Composable
private fun rememberSessionCurveChartStrings(): SessionCurveChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_charging_curve_powerVsSoc)
    val socColumn = stringResource(R.string.translation_charging_curve_col_soc)
    val powerColumn = stringResource(R.string.translation_charging_curve_col_power)
    val xAxisLabel = stringResource(R.string.translation_charging_curve_socPercent)
    val yAxisLabel = stringResource(R.string.translation_charging_curve_powerKw)
    val seriesLabel = stringResource(R.string.translation_charging_curve_power)
    val subtitle = resolveOptional({ context.optionalString(it) }, KEY_SUBTITLE, SessionCurveChartDefaults.SUBTITLE)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, SessionCurveChartDefaults.ARIA_LABEL)
    return remember(title, subtitle, ariaLabel, socColumn, powerColumn, xAxisLabel, yAxisLabel, seriesLabel) {
        SessionCurveChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            socColumn = socColumn,
            powerColumn = powerColumn,
            xAxisLabel = xAxisLabel,
            yAxisLabel = yAxisLabel,
            seriesLabel = seriesLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSessionCurveFreshnessFormatter(): (FreshnessAge) -> String {
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
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed.
 * Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SessionCurveChartStrings(
        title = "Power vs SOC",
        subtitle = "Charging power curve for selected session",
        ariaLabel = "Charging power versus state-of-charge area chart for the selected session",
        socColumn = "SOC %",
        powerColumn = "Power (kW)",
        xAxisLabel = "SOC (%)",
        yAxisLabel = "Power (kW)",
        seriesLabel = "Power",
    )

private val PREVIEW_POINTS =
    listOf(
        CurvePoint(soc = 20.0, power = 150.0),
        CurvePoint(soc = 40.0, power = 148.5),
        CurvePoint(soc = 55.0, power = 120.0),
        CurvePoint(soc = 70.0, power = 90.0),
        CurvePoint(soc = 85.0, power = 45.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SessionCurveChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionCurveChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SessionCurveChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionCurveChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SessionCurveChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionCurveChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SessionCurveChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionCurveChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SessionCurveChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionCurveChartContent(
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
