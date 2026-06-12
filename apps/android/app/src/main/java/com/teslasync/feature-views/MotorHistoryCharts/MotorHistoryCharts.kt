// The native Jetpack Compose + Material 3 Motor History charts feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx. The web component is purely
// presentational: from its `motorHistory` prop it renders three stacked `<FadeIn><ChartContainer>` blocks —
// a Power-over-time `<AreaChart>` (Power cyan `#06b6d4` + Regen green `#22c55e`) whose interactive
// `<ChartLegend state={useHiddenSeries('motor-power-history')} />` click-to-hides each `<Area hide=… />`,
// a Torque `<LineChart>` (Front `#3b82f6` + Rear `#a855f7`) with a passive `<Legend>`, and an RPM
// `<LineChart>` (Front `#06b6d4` + Rear `#a855f7`) with a passive `<Legend>`. Each chart shows its plot when
// `chartData.length > 0`, otherwise the `dynamics.awaitingData` empty state.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog (P1/S10), `useDateFormat` → the host-formatted
// [MotorHistorySample.time] label (the same host-owns-the-time-label split the sibling StatorTempChart
// documents), `useHiddenSeries('motor-power-history')` → [rememberChartLegendState] (the web persists the
// hidden set in URL state; the native equivalent is `rememberSaveable`, surviving config changes + process
// death). The host supplies the loaded samples through the shared P1/S8 state-holder layer as a [UiState]
// (the cache-then-network projection of the `/motor` history), so this feature view renders every lifecycle
// state that layer can carry — loading, hard error with retry, empty, content, and stale/offline (cached
// "last known") — without ever fetching. A web-parity overload that takes the raw samples prop is also
// provided.
//
// Colors map to design tokens (never raw hex in render code): Power (web cyan `#06b6d4`) →
// [TeslaTokens.chart.regen] (#06b6d4 — exact); Regen (web green `#22c55e`) → [TeslaTokens.chart.battery]
// (#10b981 — the palette's canonical green, the closest hue with no `#22c55e` token); Torque Front /
// RPM rear share the web hue with [TeslaTokens.chart.speed] (#3b82f6 — exact blue) and
// [TeslaTokens.chart.power] (#a855f7 — exact purple); RPM Front reuses [TeslaTokens.chart.regen] (#06b6d4 —
// exact cyan), exactly as the web reuses cyan for the front RPM line. The web red/green/blue/purple/cyan
// intent is preserved while light/dark theming keeps working.
//
// Accessibility note (documented native enhancement): the web tags these dense per-sample traces
// `chart-a11y:no-table` (its screen-reader strategy is the chart `aria-label` + CSV export). The native
// `ChartContainer` has no CSV-export affordance wired, so this port keeps the web `ariaLabel` on each chart
// AND adds the standard collapsible accessible data table — the established TalkBack fallback every sibling
// chart surface provides. This is an a11y addition, not a data / composition / state drift.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MotorHistoryCharts — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorhistorycharts

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.rememberChartLegendState
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
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

/** The web `<ChartContainer height={280}>` plot height, shared by all three charts. */
private val CHART_HEIGHT: Dp = 280.dp

/** Power-chart area/legend series keys — the web `<Area dataKey="power" />` / `dataKey="regen"`. */
private const val POWER_KEY: String = "power"
private const val REGEN_KEY: String = "regen"

/** Torque-chart line/legend series keys — the web `<Line dataKey="front" />` / `dataKey="rear"`. */
private const val TORQUE_FRONT_KEY: String = "torqueFront"
private const val TORQUE_REAR_KEY: String = "torqueRear"

/** RPM-chart line/legend series keys — the web `<Line dataKey="front" />` / `dataKey="rear"`. */
private const val RPM_FRONT_KEY: String = "rpmFront"
private const val RPM_REAR_KEY: String = "rpmRear"

/** Fixed value-axis units — the web `<YAxis unit=" kW" />` / `" Nm"` / `" RPM"` literals. */
private const val POWER_UNIT: String = "kW"
private const val TORQUE_UNIT: String = "Nm"
private const val RPM_UNIT: String = "RPM"

/** Entrance staggers — the web `<FadeIn delay={0.2} />` / `0.25` / `0.3` (seconds → ms). */
private const val POWER_FADE_MS: Int = 200
private const val TORQUE_FADE_MS: Int = 250
private const val RPM_FADE_MS: Int = 300

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Motor History charts. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared motor-history feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the motor samples (web `motorHistory`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MotorHistoryCharts(
    state: UiState<List<MotorHistorySample>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordMotorHistoryChartsOpened(logger) }
    MotorHistoryChartsContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `motorHistory: MotorSnapshot[] | undefined` prop, for
 * hosts that already hold the loaded list. The web `chartData.length > 0` boundary is reproduced: an empty /
 * absent list renders the `dynamics.awaitingData` empty surface, a non-empty list renders the plots. Records
 * `view.opened` like the stateful entry; with no fetch behind it, it offers no retry affordance.
 */
@Composable
fun MotorHistoryCharts(
    motorHistory: List<MotorHistorySample>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(motorHistory) {
            val items = motorHistory ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    MotorHistoryCharts(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto a shared [ChartStatus] (loading / error+retry / empty / ready) applied to all three stacked charts,
 * reproducing the web's three `FadeIn` + `ChartContainer` blocks: the Power [AreaChartWrapper] with its
 * interactive [ChartLegend] (web `useHiddenSeries`), and the Torque + RPM [LineChartWrapper]s with passive
 * legends (web `<Legend>`). A freshness chip appears on each panel when the cached data is refreshing /
 * stale / offline, and stale (non-error) data auto-refreshes once, mirroring the web freshness contract.
 * [locale] formats the value-axis ticks + table cells.
 */
@Composable
fun MotorHistoryChartsContent(
    state: UiState<List<MotorHistorySample>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: MotorHistoryChartsStrings = rememberMotorHistoryChartsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale) {
            MotorHistoryChartsProjection.project(
                points = state.data ?: emptyList(),
                formatPower = { MotorHistoryChartsProjection.formatPower(it, locale) },
                formatTorque = { MotorHistoryChartsProjection.formatTorque(it, locale) },
                formatRpm = { MotorHistoryChartsProjection.formatRpm(it, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val emptyMessage = stringResource(R.string.translation_dynamics_awaitingData)

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        MotorPowerChart(
            result = result,
            strings = strings,
            status = status,
            state = state,
            locale = locale,
            emptyMessage = emptyMessage,
            onRetry = onRetry,
        )
        MotorLineChart(
            title = strings.torqueTitle,
            subtitle = strings.torqueSubtitle,
            ariaLabel = strings.torqueAria,
            unit = TORQUE_UNIT,
            frontKey = TORQUE_FRONT_KEY,
            frontLabel = strings.torqueFrontLabel,
            frontValues = result.torqueFrontValues,
            frontColor = TeslaTokens.chart.speed,
            rearKey = TORQUE_REAR_KEY,
            rearLabel = strings.torqueRearLabel,
            rearValues = result.torqueRearValues,
            rearColor = TeslaTokens.chart.power,
            times = result.times,
            tableHeader = listOf(strings.timeColumn, strings.torqueFrontLabel, strings.torqueRearLabel),
            tableRows = result.torqueTableRows,
            emptyMessage = emptyMessage,
            fadeDelayMs = TORQUE_FADE_MS,
            status = status,
            state = state,
            onRetry = onRetry,
            valueFormatter = { MotorHistoryChartsProjection.formatTorque(it, locale) },
        )
        MotorLineChart(
            title = strings.rpmTitle,
            subtitle = strings.rpmSubtitle,
            ariaLabel = strings.rpmAria,
            unit = RPM_UNIT,
            frontKey = RPM_FRONT_KEY,
            frontLabel = strings.rpmFrontLabel,
            frontValues = result.rpmFrontValues,
            frontColor = TeslaTokens.chart.regen,
            rearKey = RPM_REAR_KEY,
            rearLabel = strings.rpmRearLabel,
            rearValues = result.rpmRearValues,
            rearColor = TeslaTokens.chart.power,
            times = result.times,
            tableHeader = listOf(strings.timeColumn, strings.rpmFrontLabel, strings.rpmRearLabel),
            tableRows = result.rpmTableRows,
            emptyMessage = emptyMessage,
            fadeDelayMs = RPM_FADE_MS,
            status = status,
            state = state,
            onRetry = onRetry,
            valueFormatter = { MotorHistoryChartsProjection.formatRpm(it, locale) },
        )
    }
}

/**
 * The Power-over-time chart — the web `<AreaChart>` with two gradient areas (Power + Regen) and the
 * interactive `useHiddenSeries('motor-power-history')` legend. The hidden set both dims the tapped legend
 * chip and is fed to the chart as `hiddenKeys`, so click-to-hide declutters to one trace exactly as the web
 * `<Area hide={powerHidden.isHidden(key)} />`.
 */
@Composable
private fun MotorPowerChart(
    result: MotorHistoryChartsProjectionResult,
    strings: MotorHistoryChartsStrings,
    status: ChartStatus,
    state: UiState<*>,
    locale: Locale,
    emptyMessage: String,
    onRetry: () -> Unit,
) {
    val powerColor = TeslaTokens.chart.regen
    val regenColor = TeslaTokens.chart.battery

    val series =
        remember(result.powerValues, result.regenValues, strings.powerLabel, strings.regenLabel, powerColor, regenColor) {
            listOf(
                ChartSeries(
                    key = POWER_KEY,
                    label = strings.powerLabel,
                    values = result.powerValues,
                    kind = ChartSeriesKind.Area,
                    color = powerColor,
                    unit = POWER_UNIT,
                ),
                ChartSeries(
                    key = REGEN_KEY,
                    label = strings.regenLabel,
                    values = result.regenValues,
                    kind = ChartSeriesKind.Area,
                    color = regenColor,
                    unit = POWER_UNIT,
                ),
            )
        }

    val legend =
        remember(strings.powerLabel, strings.regenLabel, powerColor, regenColor) {
            listOf(
                LegendEntry(key = POWER_KEY, label = strings.powerLabel, color = powerColor),
                LegendEntry(key = REGEN_KEY, label = strings.regenLabel, color = regenColor),
            )
        }

    val legendState = rememberChartLegendState()

    MotorChartPanel(
        title = strings.powerTitle,
        subtitle = strings.powerSubtitle,
        ariaLabel = strings.powerAria,
        status = status,
        state = state,
        tableHeader = listOf(strings.timeColumn, strings.powerLabel, strings.regenLabel),
        tableRows = result.powerTableRows,
        emptyMessage = emptyMessage,
        fadeDelayMs = POWER_FADE_MS,
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            // The web rotated `<YAxis unit=" kW" />`; Vico has no axis-title slot, so the unit is surfaced as
            // a caption above the plot — keeping the value-axis unit on screen (sibling adaptation).
            Caption(POWER_UNIT)
            AreaChartWrapper(
                series = series,
                xLabels = result.times,
                height = CHART_HEIGHT,
                hiddenKeys = legendState.hidden,
                yValueFormatter = { value -> MotorHistoryChartsProjection.formatPower(value, locale) },
                emptyMessage = emptyMessage,
            )
            ChartLegend(entries = legend, state = legendState, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * A two-line motor chart (Torque or RPM) — the web `<LineChart>` with two `<Line>` traces and a passive
 * `<Legend>`. Unlike the Power chart there is no hidden-series state (the web uses a plain `<Legend>` here),
 * so the legend renders passively. [valueFormatter] formats the value-axis ticks for the chart's unit.
 */
@Composable
private fun MotorLineChart(
    title: String,
    subtitle: String,
    ariaLabel: String,
    unit: String,
    frontKey: String,
    frontLabel: String,
    frontValues: List<Double?>,
    frontColor: Color,
    rearKey: String,
    rearLabel: String,
    rearValues: List<Double?>,
    rearColor: Color,
    times: List<String>,
    tableHeader: List<String>,
    tableRows: List<List<String>>,
    emptyMessage: String,
    fadeDelayMs: Int,
    status: ChartStatus,
    state: UiState<*>,
    onRetry: () -> Unit,
    valueFormatter: (Double) -> String,
) {
    val series =
        remember(frontValues, rearValues, frontLabel, rearLabel, frontColor, rearColor) {
            listOf(
                ChartSeries(
                    key = frontKey,
                    label = frontLabel,
                    values = frontValues,
                    kind = ChartSeriesKind.Line,
                    color = frontColor,
                    unit = unit,
                ),
                ChartSeries(
                    key = rearKey,
                    label = rearLabel,
                    values = rearValues,
                    kind = ChartSeriesKind.Line,
                    color = rearColor,
                    unit = unit,
                ),
            )
        }

    val legend =
        remember(frontLabel, rearLabel, frontColor, rearColor) {
            listOf(
                LegendEntry(key = frontKey, label = frontLabel, color = frontColor),
                LegendEntry(key = rearKey, label = rearLabel, color = rearColor),
            )
        }

    MotorChartPanel(
        title = title,
        subtitle = subtitle,
        ariaLabel = ariaLabel,
        status = status,
        state = state,
        tableHeader = tableHeader,
        tableRows = tableRows,
        emptyMessage = emptyMessage,
        fadeDelayMs = fadeDelayMs,
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Caption(unit)
            LineChartWrapper(
                series = series,
                xLabels = times,
                height = CHART_HEIGHT,
                yValueFormatter = valueFormatter,
                emptyMessage = emptyMessage,
            )
            ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The shared chart-panel chrome for one motor chart — a [FadeIn]-wrapped [ChartContainer] that maps [status]
 * onto the loading / error+retry / empty / ready surfaces, carries the web `ariaLabel` as the chart's
 * accessible description, offers the collapsible accessible data table, and shows a freshness chip in the
 * header when the cached data is refreshing / stale / offline. Never hides: a chart with no data renders the
 * empty surface, never a blank panel.
 */
@Composable
private fun MotorChartPanel(
    title: String,
    subtitle: String,
    ariaLabel: String,
    status: ChartStatus,
    state: UiState<*>,
    tableHeader: List<String>,
    tableRows: List<List<String>>,
    emptyMessage: String,
    fadeDelayMs: Int,
    onRetry: () -> Unit,
    content: @Composable () -> Unit,
) {
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
    FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = fadeDelayMs) {
        ChartContainer(
            title = title,
            subtitle = subtitle,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { MotorHistoryFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = ariaLabel,
            dataTableHeader = tableHeader,
            dataTableRows = tableRows,
            dataTableLabel = stringResource(R.string.translation_Details),
            emptyMessage = emptyMessage,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
            content = content,
        )
    }
}

/**
 * The freshness chip rendered in a chart header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Carries no English literal.
 */
@Composable
private fun MotorHistoryFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberMotorHistoryFreshnessFormatter(),
    )
}

/**
 * Builds the localized [MotorHistoryChartsStrings] from the i18n catalog (P1/S10): the visible
 * title / subtitle / series keys resolve through compile-time resources; the three aria descriptions resolve
 * by-name with the web `t(key, default)` fallback, since the catalog defines no key for them. Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberMotorHistoryChartsStrings(): MotorHistoryChartsStrings {
    val context = LocalContext.current
    val powerTitle = stringResource(R.string.translation_dynamics_powerOverTime)
    val powerSubtitle = stringResource(R.string.translation_dynamics_powerOverTimeDesc)
    val powerAria = resolveOptional({ context.optionalString(it) }, KEY_POWER_ARIA, MotorHistoryChartsDefaults.POWER_ARIA)
    val torqueTitle = stringResource(R.string.translation_dynamics_torqueHistory)
    val torqueSubtitle = stringResource(R.string.translation_dynamics_torqueHistoryDesc)
    val torqueAria = resolveOptional({ context.optionalString(it) }, KEY_TORQUE_ARIA, MotorHistoryChartsDefaults.TORQUE_ARIA)
    val rpmTitle = stringResource(R.string.translation_dynamics_rpmHistory)
    val rpmSubtitle = stringResource(R.string.translation_dynamics_rpmHistoryDesc)
    val rpmAria = resolveOptional({ context.optionalString(it) }, KEY_RPM_ARIA, MotorHistoryChartsDefaults.RPM_ARIA)
    val powerLabel = stringResource(R.string.translation_dynamics_power)
    val regenLabel = stringResource(R.string.translation_dynamics_regen)
    val torqueFrontLabel = stringResource(R.string.translation_dynamics_torqueFront)
    val torqueRearLabel = stringResource(R.string.translation_dynamics_torqueRear)
    val rpmFrontLabel = stringResource(R.string.translation_dynamics_rpmFront)
    val rpmRearLabel = stringResource(R.string.translation_dynamics_rpmRear)
    val timeColumn = stringResource(R.string.translation_drivetrain_col_time)
    return remember(
        powerTitle,
        powerSubtitle,
        powerAria,
        torqueTitle,
        torqueSubtitle,
        torqueAria,
        rpmTitle,
        rpmSubtitle,
        rpmAria,
        powerLabel,
        regenLabel,
        torqueFrontLabel,
        torqueRearLabel,
        rpmFrontLabel,
        rpmRearLabel,
        timeColumn,
    ) {
        MotorHistoryChartsStrings(
            powerTitle = powerTitle,
            powerSubtitle = powerSubtitle,
            powerAria = powerAria,
            torqueTitle = torqueTitle,
            torqueSubtitle = torqueSubtitle,
            torqueAria = torqueAria,
            rpmTitle = rpmTitle,
            rpmSubtitle = rpmSubtitle,
            rpmAria = rpmAria,
            powerLabel = powerLabel,
            regenLabel = regenLabel,
            torqueFrontLabel = torqueFrontLabel,
            torqueRearLabel = torqueRearLabel,
            rpmFrontLabel = rpmFrontLabel,
            rpmRearLabel = rpmRearLabel,
            timeColumn = timeColumn,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberMotorHistoryFreshnessFormatter(): (FreshnessAge) -> String {
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
    MotorHistoryChartsStrings(
        powerTitle = "Motor Power Over Time",
        powerSubtitle = "Drive and regen power from motor telemetry",
        powerAria = "Motor power and regen over time area chart",
        torqueTitle = "Motor Torque History",
        torqueSubtitle = "Front and rear motor torque over time",
        torqueAria = "Front and rear motor torque over time line chart",
        rpmTitle = "Motor RPM History",
        rpmSubtitle = "Front and rear motor RPM over time",
        rpmAria = "Front and rear motor RPM over time line chart",
        powerLabel = "Power",
        regenLabel = "Regen",
        torqueFrontLabel = "Front Torque",
        torqueRearLabel = "Rear Torque",
        rpmFrontLabel = "Front RPM",
        rpmRearLabel = "Rear RPM",
        timeColumn = "Time",
    )

// MotorHistorySample(time, powerKw, regenKw, torqueFront, torqueRear, rpmFront, rpmRear) — positional to
// keep each preview fixture on one line within the column limit.
private val PREVIEW_SAMPLES =
    listOf(
        MotorHistorySample("10:00", 64.2, -12.0, 180.0, 210.0, 3200.0, 3400.0),
        MotorHistorySample("10:05", 120.5, -4.0, 240.0, 265.0, 5200.0, 5600.0),
        MotorHistorySample("10:10", 88.0, -33.5, 150.0, 175.0, 4100.0, 4300.0),
        MotorHistorySample("10:15", 30.0, -58.0, 90.0, 110.0, 2600.0, 2750.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun MotorHistoryChartsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorHistoryChartsContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun MotorHistoryChartsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorHistoryChartsContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun MotorHistoryChartsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorHistoryChartsContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun MotorHistoryChartsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorHistoryChartsContent(
            state = UiState(UiPhase.Content, data = PREVIEW_SAMPLES),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun MotorHistoryChartsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorHistoryChartsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SAMPLES,
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
