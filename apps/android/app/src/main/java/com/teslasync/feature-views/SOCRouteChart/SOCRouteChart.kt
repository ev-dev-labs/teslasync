// The native Jetpack Compose + Material 3 "Battery Along Route" chart feature view — a parity port of
// web/src/features/driving/components/SOCRouteChart.tsx. The web component is purely presentational: it wraps
// the shared `<ChartContainer title="Battery Along Route" height={300}>` (title / aria fallback table / empty
// state) around a Recharts `<AreaChart>` of the planned-route `soc` (state-of-charge %, Y) over `distance`
// (the raw `distance_m`, X, captioned `km`). It overlays a green→amber→red gradient on the area, a horizontal
// `<ReferenceLine y={minArrivalSOC}>` labelled `Min N%`, and one vertical `<ReferenceLine x>` per matched
// charge stop labelled `⚡ Stop N`. An empty `socCurve` renders the friendly empty state instead.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the planned route through
// the shared P1/S8 state-holder layer as a [UiState] of [SOCRouteData] (the cache-then-network projection of
// the computed `TripPlan`), so this feature view renders every lifecycle state that layer can carry —
// loading, hard error with retry, empty, content, and stale/offline (cached "last known") — without ever
// fetching. A web-parity overload that takes the raw `socCurve` / `chargeStops` / `minArrivalSOC` props is
// also provided.
//
// Two documented platform deviations from the web, both forced by the shared chart layer (which feature views
// must consume as-is — never modify nor bypass with a direct Vico import):
//   1. Reference lines → combo line + marker rail. Vico 2.0 exposes neither a horizontal nor a vertical
//      reference-line decoration (SURVEY.md / ChartModels.ChartVerticalMarker). The horizontal
//      `<ReferenceLine y={minArrivalSOC}>` is reproduced as a flat constant [ChartSeriesKind.Line] series in
//      the shared [ComboChart] (its value never changes across x, so it draws as a horizontal threshold), and
//      the per-stop vertical `<ReferenceLine x>` lines become labelled marker-rail pins. Both carry their
//      web labels (`Min N%`, `⚡ Stop N`); the threshold is also named in the legend so its meaning is
//      explicit and screen-reader reachable.
//   2. Single-color area gradient. The shared area renderer fills with one themed gradient, not the web's
//      green→amber→red ramp. The SOC area takes the generated `chart.battery` token (the analogue of the web
//      area's primary `#22c55e` green) and the threshold takes `status.danger` (the web `#ef4444`); both are
//      theme-aware tokens, never raw hex in render code, so light / dark / high-contrast stay correct. No
//      value is ever rescaled — SOC is a 0-100 percentage and the shared start axis auto-scales within it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SOCRouteChart — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.socroutechart

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
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.MarkerSeverity
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

/** The web `<ChartContainer height={300}>` plot height. */
private val CHART_HEIGHT: Dp = 300.dp

/** The SOC area series key — the web `<Area dataKey="soc" />`. */
private const val SOC_SERIES_KEY: String = "soc"

/** The flat min-arrival threshold series key — the web horizontal `<ReferenceLine y={minArrivalSOC}>`. */
private const val THRESHOLD_SERIES_KEY: String = "minArrival"

/** The percent unit suffix shown in the hover marker — the web tooltip `${v}%`. */
private const val PERCENT_UNIT: String = "%"

/**
 * Stateful entry point for the "Battery Along Route" chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared trip-plan feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the planned route (web `socCurve` / `chargeStops` /
 *   `minArrivalSOC`, bundled as [SOCRouteData]).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SOCRouteChart(
    state: UiState<SOCRouteData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSOCRouteChartOpened(logger) }
    SOCRouteChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `socCurve` / `chargeStops` / `minArrivalSOC` props, for
 * hosts that already hold the computed plan. An empty [socCurve] renders the empty state (the web
 * `chartData.length === 0` branch), a non-empty curve renders the chart. Records `view.opened` like the
 * stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SOCRouteChart(
    socCurve: List<TripSOCPoint>?,
    chargeStops: List<RouteChargeStop>?,
    minArrivalSoc: Double,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(socCurve, chargeStops, minArrivalSoc) {
            val curve = socCurve ?: emptyList()
            val data = SOCRouteData(socCurve = curve, chargeStops = chargeStops ?: emptyList(), minArrivalSoc = minArrivalSoc)
            val phase = if (curve.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = data)
        }
    SOCRouteChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and, in the ready state,
 * renders the SOC area + flat min-arrival threshold [ComboChart] with the charge-stop marker rail, the axis
 * captions, and the two-series legend, reproducing the web `ChartContainer` + `AreaChart` + reference-line
 * composition: the localized title, the aria description + accessible fallback table (Distance / SOC %), and
 * a freshness chip when cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the distance + SOC figures.
 */
@Composable
fun SOCRouteChartContent(
    state: UiState<SOCRouteData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: SOCRouteChartStrings = rememberSOCRouteChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val data = state.data ?: EMPTY_ROUTE
    val result =
        remember(data, locale) {
            SOCRouteChartProjection.project(
                data = data,
                formatDistance = { SOCRouteChartProjection.formatValue(it, locale) },
                formatSoc = { SOCRouteChartProjection.formatValue(it, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val socColor = TeslaTokens.chart.battery
    val thresholdColor = TeslaTokens.status.danger
    val minLineLabel =
        remember(strings.minLineTemplate, data.minArrivalSoc, locale) {
            SOCRouteChartProjection.formatMinLineLabel(strings.minLineTemplate, data.minArrivalSoc, locale)
        }

    val series =
        remember(result.socValues, result.thresholdValues, strings.socColumn, minLineLabel, socColor, thresholdColor) {
            listOf(
                ChartSeries(
                    key = SOC_SERIES_KEY,
                    label = strings.socColumn,
                    values = result.socValues,
                    kind = ChartSeriesKind.Area,
                    color = socColor,
                    unit = PERCENT_UNIT,
                ),
                ChartSeries(
                    key = THRESHOLD_SERIES_KEY,
                    label = minLineLabel,
                    values = result.thresholdValues,
                    kind = ChartSeriesKind.Line,
                    color = thresholdColor,
                    unit = PERCENT_UNIT,
                ),
            )
        }
    val legend =
        remember(strings.socColumn, minLineLabel, socColor, thresholdColor) {
            listOf(
                LegendEntry(key = SOC_SERIES_KEY, label = strings.socColumn, color = socColor),
                LegendEntry(key = THRESHOLD_SERIES_KEY, label = minLineLabel, color = thresholdColor),
            )
        }
    val markers =
        remember(result.stops, strings.chargeStopTemplate, locale) {
            result.stops.map { stop ->
                ChartVerticalMarker(
                    index = stop.index,
                    label = SOCRouteChartProjection.formatStopLabel(strings.chargeStopTemplate, stop.ordinal, locale),
                    severity = MarkerSeverity.Info,
                    id = "stop-${stop.ordinal}",
                )
            }
        }

    val emptyMessage = stringResource(R.string.translation_tripPlanner_socChart_empty)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { SOCRouteFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        dataTableHeader = listOf(strings.distanceColumn, strings.socColumn),
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = emptyMessage,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        SOCRoutePlot(
            series = series,
            xLabels = result.xLabels,
            markers = markers,
            legend = legend,
            strings = strings,
            locale = locale,
            emptyMessage = emptyMessage,
        )
    }
}

/**
 * The populated plot — the SOC area + flat min-arrival threshold line fed to the shared [ComboChart], framed
 * by the two axis-title captions the web renders as `YAxis`/`XAxis` `label`s ("SOC %" above the plot, "km"
 * aligned to the bottom-right), with the charge-stop marker rail above and the two-series legend below. The
 * value-axis tick formatter shows one decimal, the web data precision; SOC is a 0-100 percentage so the
 * auto-scaled axis stays within the web's fixed `domain={[0, 100]}`.
 */
@Composable
private fun SOCRoutePlot(
    series: List<ChartSeries>,
    xLabels: List<String>,
    markers: List<ChartVerticalMarker>,
    legend: List<LegendEntry>,
    strings: SOCRouteChartStrings,
    locale: Locale,
    emptyMessage: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(strings.socColumn)
        ComboChart(
            series = series,
            xLabels = xLabels,
            height = CHART_HEIGHT,
            markers = markers,
            yValueFormatter = { value -> SOCRouteChartProjection.formatValue(value, locale) },
            emptyMessage = emptyMessage,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Caption(strings.distanceAxisLabel)
        }
        ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces'
 * freshness contract; carries no English literal.
 */
@Composable
private fun SOCRouteFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSOCRouteFreshnessFormatter(),
    )
}

/**
 * Builds the localized [SOCRouteChartStrings] from the i18n catalog (P1/S10): the five visible web keys
 * (`tripPlanner.socChart.title`, `.aria`, `.col.distance`, `.col.soc`) plus the `units.km` axis caption
 * resolve through compile-time resources; the two reference-line label templates resolve by-name with the web
 * `t(key, default)` fallback, since the catalog defines no key for the inline `Min N%` / `⚡ Stop N` literals.
 * Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberSOCRouteChartStrings(): SOCRouteChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_tripPlanner_socChart_title)
    val ariaLabel = stringResource(R.string.translation_tripPlanner_socChart_aria)
    val distanceColumn = stringResource(R.string.translation_tripPlanner_socChart_col_distance)
    val socColumn = stringResource(R.string.translation_tripPlanner_socChart_col_soc)
    val distanceAxisLabel = stringResource(R.string.translation_units_km)
    val minLineTemplate = resolveOptional({ context.optionalString(it) }, KEY_MIN_LINE, SOCRouteChartDefaults.MIN_LINE)
    val chargeStopTemplate = resolveOptional({ context.optionalString(it) }, KEY_CHARGE_STOP, SOCRouteChartDefaults.CHARGE_STOP)
    return remember(title, ariaLabel, distanceColumn, socColumn, distanceAxisLabel, minLineTemplate, chargeStopTemplate) {
        SOCRouteChartStrings(
            title = title,
            ariaLabel = ariaLabel,
            distanceColumn = distanceColumn,
            socColumn = socColumn,
            distanceAxisLabel = distanceAxisLabel,
            minLineTemplate = minLineTemplate,
            chargeStopTemplate = chargeStopTemplate,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSOCRouteFreshnessFormatter(): (FreshnessAge) -> String {
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

/** The empty payload used while loading / on a hard error, so the projection stays total. */
private val EMPTY_ROUTE = SOCRouteData(socCurve = emptyList(), chargeStops = emptyList(), minArrivalSoc = 0.0)

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SOCRouteChartStrings(
        title = "Battery Along Route",
        ariaLabel = "Planned route battery state-of-charge area chart",
        distanceColumn = "Distance",
        socColumn = "SOC %",
        distanceAxisLabel = "km",
        minLineTemplate = SOCRouteChartDefaults.MIN_LINE,
        chargeStopTemplate = SOCRouteChartDefaults.CHARGE_STOP,
    )

private val PREVIEW_ROUTE =
    SOCRouteData(
        socCurve =
            listOf(
                TripSOCPoint(distanceM = 0.0, soc = 82.0),
                TripSOCPoint(distanceM = 40_000.0, soc = 58.0),
                TripSOCPoint(distanceM = 80_000.0, soc = 34.0),
                TripSOCPoint(distanceM = 120_000.0, soc = 12.0),
                TripSOCPoint(distanceM = 160_000.0, soc = 64.0),
                TripSOCPoint(distanceM = 200_000.0, soc = 30.0),
            ),
        chargeStops =
            listOf(
                RouteChargeStop(chargeFromSoc = 12.0),
                RouteChargeStop(chargeFromSoc = 30.0),
            ),
        minArrivalSoc = 10.0,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SOCRouteChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SOCRouteChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SOCRouteChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SOCRouteChartContent(
            state = UiState(UiPhase.Empty, data = EMPTY_ROUTE),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SOCRouteChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SOCRouteChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SOCRouteChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SOCRouteChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_ROUTE),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SOCRouteChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SOCRouteChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_ROUTE,
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
