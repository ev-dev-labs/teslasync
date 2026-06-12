// The native Jetpack Compose + Material 3 Stator Temperature History chart feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx. The web component is purely
// presentational: inside a `<FadeIn>` it wraps the shared `<ChartContainer title="Stator Temperature
// History" subtitle="Motor stator temperature over recent snapshots" height={280}>` around a Recharts
// `<LineChart>` of three motor stator-temperature lines — front (`stator`, red), rear-left (`statorRel`,
// purple) and rear-right (`statorRer`, cyan) — plus two horizontal `<ReferenceLine>` guides at the 60 °C
// "Normal" and 80 °C "Warm" thresholds and a series `<Legend>`. The web returns `null` when there are one
// or fewer samples (`if (data.length <= 1) return null`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog (every `drivetrain.*` key), `useUnits` → the live
// [UnitFormatter]'s temperature preference (applied at this single render boundary). The host supplies the
// loaded samples through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network
// projection of the `/motor` history the web parent maps into `MotorChartDataPoint[]`), so this feature view
// renders every lifecycle state that layer can carry — loading, hard error with retry, empty, content, and
// stale/offline (cached "last known") — without ever fetching. The web `data.length <= 1` guard maps to the
// empty state (native surfaces never hide). A web-parity overload that takes the raw points prop is also
// provided. The native [ChartContainer] + [LineChartWrapper] + [ChartLegend] are the faithful counterparts
// of the web `ChartContainer` + `LineChart` + `Legend`.
//
// Colors: the three series resolve to the brand chart palette by the web's exact intent — `stator` →
// [TeslaTokens.chart.temperature] (web `#ef4444`), `statorRel` → [TeslaTokens.chart.power] (web `#a855f7`),
// `statorRer` → [TeslaTokens.chart.regen] (web `#06b6d4`). The two thresholds use the semantic status
// palette — Normal → `status.success` (web green `#4ade80`), Warm → `status.warning` (web amber `#fbbf24`) —
// so light/dark theming keeps working while the web's red/purple/cyan + green/amber intent is preserved.
//
// Documented native deviation (web Recharts → Vico, ADR-012; components/charts/SURVEY.md): Vico's cartesian
// renderer has no horizontal `<ReferenceLine>` slot with an inline label, and feature views must not alter
// the shared chart layer (allowed-files). The two thresholds are therefore drawn as constant-value guide
// series across the plot (so the 60 °C / 80 °C lines are still visible against the data) and surfaced in a
// dedicated threshold legend beneath the series legend, each carrying its localized label + converted value
// (e.g. "Normal 60.0°C"). This is the same shared-renderer adaptation the sibling drive-detail charts
// document for their reference lines; no untranslated text is introduced.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/StatorTempChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statortempchart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
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
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/** The web `<ChartContainer height={280}>` plot height. */
private val CHART_HEIGHT: Dp = 280.dp

/** Line/legend series keys — the web `<Line dataKey="stator" />` / `statorRel` / `statorRer`. */
private const val STATOR_KEY: String = "stator"
private const val STATOR_REL_KEY: String = "statorRel"
private const val STATOR_RER_KEY: String = "statorRer"

/** Threshold guide-series keys — the native counterparts of the web `<ReferenceLine>` guides. */
private const val NORMAL_KEY: String = "normal"
private const val WARM_KEY: String = "warm"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH_AGE: String = "\u2014"

/**
 * Stateful entry point for the Stator Temperature History chart. Collects the live [units] formatter (the
 * web `useUnits` temperature preference, applied at this render boundary), records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11), and renders every lifecycle [state] the shared motor feed can carry.
 * The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs
 * HTTP.
 *
 * @param state the cache-then-network projection of the motor samples (web `MotorChartDataPoint[]`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live display-unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StatorTempChart(
    state: UiState<List<MotorTempPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val formatter by units.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { recordStatorTempChartOpened(logger) }
    StatorTempChartContent(
        state = state,
        onRetry = onRetry,
        temperatureUnit = formatter.prefs.temperature,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's `data: MotorChartDataPoint[]` prop, for hosts that
 * already hold the loaded list. One or fewer samples renders the empty state (the web `data.length <= 1`
 * branch that returns `null`); two or more renders the three lines. Records `view.opened` like the stateful
 * entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun StatorTempChart(
    data: List<MotorTempPoint>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val state =
        remember(data) {
            val items = data ?: emptyList()
            val phase = if (items.size < MIN_POINTS) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    StatorTempChart(state = state, onRetry = {}, modifier = modifier, logger = logger, units = units)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's
 * [UiState] onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the
 * three [LineChartWrapper] series plus the two threshold guides in the ready state, reproducing the web
 * `ChartContainer` + `LineChart` composition: a localized title/subtitle, the aria description + data table
 * (Time / Stator / Rear-Left / Rear-Right, each headed with the temperature unit), a series legend, a
 * threshold legend, and a freshness chip when the cached data is refreshing / stale / offline. The
 * `data.length <= 1` web guard maps to the empty state. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [temperatureUnit] is the web `useUnits` preference; [locale] formats values.
 */
@Composable
fun StatorTempChartContent(
    state: UiState<List<MotorTempPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    temperatureUnit: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
    locale: Locale = Locale.getDefault(),
    strings: StatorTempChartStrings = rememberStatorTempChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, temperatureUnit, locale) {
            StatorTempChartProjection.project(
                points = state.data ?: emptyList(),
                tempUnit = temperatureUnit,
                formatValue = { value -> StatorTempChartProjection.formatTemp(value, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isInsufficient -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val unitSuffix = temperatureUnit.label
    val statorColor = TeslaTokens.chart.temperature
    val statorRelColor = TeslaTokens.chart.power
    val statorRerColor = TeslaTokens.chart.regen
    val normalColor = TeslaTokens.status.success
    val warmColor = TeslaTokens.status.warning

    // The web embeds the unit in each `<Line name>` (e.g. "Stator Temp (°C)"); keep that on both the
    // tooltip series name and the legend swatch. The threshold guides carry their converted value too.
    val statorLabel = "${strings.statorSeries} ($unitSuffix)"
    val statorRelLabel = "${strings.statorRelSeries} ($unitSuffix)"
    val statorRerLabel = "${strings.statorRerSeries} ($unitSuffix)"
    val normalValue = StatorTempChartProjection.formatTemp(result.normalThreshold, locale)
    val warmValue = StatorTempChartProjection.formatTemp(result.warmThreshold, locale)
    val normalGuideLabel = "${strings.normalLabel} $normalValue$unitSuffix"
    val warmGuideLabel = "${strings.warmLabel} $warmValue$unitSuffix"
    val pointCount = result.times.size

    val series =
        remember(result, statorLabel, statorRelLabel, statorRerLabel, normalGuideLabel, warmGuideLabel) {
            buildList {
                add(line(STATOR_KEY, statorLabel, result.statorValues, statorColor))
                add(line(STATOR_REL_KEY, statorRelLabel, result.statorRelValues, statorRelColor))
                add(line(STATOR_RER_KEY, statorRerLabel, result.statorRerValues, statorRerColor))
                // Web `<ReferenceLine>` guides → constant-value series (no horizontal-line slot in Vico).
                add(line(NORMAL_KEY, normalGuideLabel, constant(result.normalThreshold, pointCount), normalColor))
                add(line(WARM_KEY, warmGuideLabel, constant(result.warmThreshold, pointCount), warmColor))
            }
        }

    val seriesLegend =
        remember(statorLabel, statorRelLabel, statorRerLabel, statorColor, statorRelColor, statorRerColor) {
            listOf(
                LegendEntry(STATOR_KEY, statorLabel, statorColor),
                LegendEntry(STATOR_REL_KEY, statorRelLabel, statorRelColor),
                LegendEntry(STATOR_RER_KEY, statorRerLabel, statorRerColor),
            )
        }

    val thresholdLegend =
        remember(normalGuideLabel, warmGuideLabel, normalColor, warmColor) {
            listOf(
                LegendEntry(NORMAL_KEY, normalGuideLabel, normalColor),
                LegendEntry(WARM_KEY, warmGuideLabel, warmColor),
            )
        }

    val tableHeader =
        listOf(
            strings.timeColumn,
            "${strings.statorColumn} ($unitSuffix)",
            "${strings.statorRelColumn} ($unitSuffix)",
            "${strings.statorRerColumn} ($unitSuffix)",
        )

    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        subtitle = strings.subtitle,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { StatorTempFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = "${strings.title}. ${strings.subtitle}",
        dataTableHeader = tableHeader,
        dataTableRows = result.tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = stringResource(R.string.translation_chart_noData),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LineChartWrapper(
                series = series,
                xLabels = result.times,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> StatorTempChartProjection.formatTemp(value, locale) },
                emptyMessage = stringResource(R.string.translation_chart_noData),
            )
            ChartLegend(entries = seriesLegend, modifier = Modifier.fillMaxWidth())
            ChartLegend(entries = thresholdLegend, modifier = Modifier.fillMaxWidth())
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
private fun StatorTempFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberStatorTempFreshnessFormatter(),
    )
}

/**
 * Builds the localized [StatorTempChartStrings] from the i18n catalog (P1/S10): the `drivetrain.*` keys the
 * web component reads. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberStatorTempChartStrings(): StatorTempChartStrings {
    val title = stringResource(R.string.translation_drivetrain_statorTempHistory)
    val subtitle = stringResource(R.string.translation_drivetrain_statorTempSub)
    val timeColumn = stringResource(R.string.translation_drivetrain_col_time)
    val statorColumn = stringResource(R.string.translation_drivetrain_col_stator)
    val statorRelColumn = stringResource(R.string.translation_drivetrain_col_statorRel)
    val statorRerColumn = stringResource(R.string.translation_drivetrain_col_statorRer)
    val statorSeries = stringResource(R.string.translation_drivetrain_statorTemp)
    val statorRelSeries = stringResource(R.string.translation_drivetrain_statorTempRearLeft)
    val statorRerSeries = stringResource(R.string.translation_drivetrain_statorTempRearRight)
    val normalLabel = stringResource(R.string.translation_drivetrain_normal)
    val warmLabel = stringResource(R.string.translation_drivetrain_warm)
    return remember(
        title,
        subtitle,
        timeColumn,
        statorColumn,
        statorRelColumn,
        statorRerColumn,
        statorSeries,
        statorRelSeries,
        statorRerSeries,
        normalLabel,
        warmLabel,
    ) {
        StatorTempChartStrings(
            title = title,
            subtitle = subtitle,
            timeColumn = timeColumn,
            statorColumn = statorColumn,
            statorRelColumn = statorRelColumn,
            statorRerColumn = statorRerColumn,
            statorSeries = statorSeries,
            statorRelSeries = statorRelSeries,
            statorRerSeries = statorRerSeries,
            normalLabel = normalLabel,
            warmLabel = warmLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberStatorTempFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH_AGE
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

/** Builds a line [ChartSeries] (every motor + guide series is a line, the web `<Line>`). */
private fun line(
    key: String,
    label: String,
    values: List<Double?>,
    color: Color,
): ChartSeries = ChartSeries(key = key, label = label, values = values, kind = ChartSeriesKind.Line, color = color)

/** A constant-value series of [count] samples — a horizontal guide line (the web `<ReferenceLine y>`). */
private fun constant(
    value: Double,
    count: Int,
): List<Double?> = List(count) { value }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    StatorTempChartStrings(
        title = "Stator Temperature History",
        subtitle = "Motor stator temperature over recent snapshots",
        timeColumn = "Time",
        statorColumn = "Stator",
        statorRelColumn = "Rear-Left",
        statorRerColumn = "Rear-Right",
        statorSeries = "Stator Temp",
        statorRelSeries = "Rear-Left Stator Temp",
        statorRerSeries = "Rear-Right Stator Temp",
        normalLabel = "Normal",
        warmLabel = "Warm",
    )

private val PREVIEW_POINTS =
    listOf(
        MotorTempPoint(time = "10:00", statorC = 45.0, statorRelC = 42.0, statorRerC = 38.0),
        MotorTempPoint(time = "10:05", statorC = 58.0, statorRelC = 55.0, statorRerC = 49.0),
        MotorTempPoint(time = "10:10", statorC = 72.0, statorRelC = 68.0, statorRerC = 61.0),
        MotorTempPoint(time = "10:15", statorC = 84.0, statorRelC = 79.0, statorRerC = 70.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun StatorTempChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatorTempChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun StatorTempChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatorTempChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun StatorTempChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatorTempChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun StatorTempChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatorTempChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun StatorTempChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatorTempChartContent(
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
