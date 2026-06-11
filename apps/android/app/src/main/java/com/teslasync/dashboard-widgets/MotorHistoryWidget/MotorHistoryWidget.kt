// The native Jetpack Compose + Material 3 Motor History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MotorHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a title + cog glyph
// + freshness header) wrapping the web `WidgetChartSummary`: a Torque / Stator latest-value stat pair
// over a torque + stator-temperature line chart (with the lateral / longitudinal g-force overlays added
// on the wide footprint), or a friendly "No motor history" empty state. The compact (1-column) footprint
// shows only the stat pair, exactly like the web `chart={null}` compact branch. All data flows through
// the shared [MotorHistoryWidgetViewModel] (P1/S8); SI stator temperatures are converted to the user's
// unit at this render boundary via the live [io.teslasync.android.data.UnitFormatter]. The view performs
// no HTTP. Every string resolves through the i18n catalog and the refresh control carries a TalkBack
// label.
//
// Documented native deviations (web Recharts → Vico, ADR-012; see components/charts/SURVEY.md):
//   • Single Y-axis. Recharts draws torque (Nm, left) and stator temp (right) on dual axes; Vico 2.0's
//     cartesian layer exposes one value axis, so both render against a shared axis (the web already plots
//     the g-force overlays on the torque axis, so they stay relative there too). A legend names each
//     series the way the web tooltip does.
//   • Danger zone → color, not a band. The web paints a `ReferenceArea` above 100 °C; Vico has no
//     horizontal-band decoration, so the danger zone is surfaced by tinting the stator series + live stat
//     with the status-danger color — no untranslated text is introduced.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MotorHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.motorhistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private val CHART_HEIGHT = 168.dp
private val BODY_MIN_HEIGHT = 140.dp
private const val Y_AXIS_DECIMALS = 0
private const val KEY_TORQUE = "torque"
private const val KEY_STATOR = "stator"
private const val KEY_LATERAL_G = "lateralG"
private const val KEY_LONG_G = "longitudinalG"
private const val UNIT_TORQUE = "Nm"
private const val UNIT_G = "g"

/**
 * Stateful entry point. Collects the shared [MotorHistoryWidgetViewModel] state + the live [units]
 * formatter (for the temperature display unit), records the one-shot `view.opened` diagnostic, and
 * renders the surface for the given [size]. A dashboard host supplies the view-model (wired via
 * [MotorHistoryWidgetViewModel.factory]); [units] defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MotorHistoryWidget(
    viewModel: MotorHistoryWidgetViewModel,
    modifier: Modifier = Modifier,
    size: MotorHistorySize = MotorHistoryRegistration.defaultSize,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    MotorHistoryWidgetContent(
        state = state,
        size = size,
        temperatureUnit = formatter.prefs.temperature,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless Motor History panel — renders every state the web widget does (loading / content / empty /
 * error, plus stale + offline via the header freshness chip over the cached chart). Stale (non-error)
 * data auto-refreshes (web TanStack stale refetch). Hoisted out of the ViewModel so each state is
 * preview- and screenshot-testable with hand-built [UiState] inputs. [temperatureUnit] supplies the SI
 * Celsius → display conversion + unit symbol at the render boundary.
 */
@Composable
fun MotorHistoryWidgetContent(
    state: UiState<MotorHistorySnapshot>,
    size: MotorHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    temperatureUnit: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberMotorHistoryStrings()
    val title = stringResource(R.string.translation_widget_motorHistory_title)
    val emptyMessage = stringResource(R.string.translation_widget_motorHistory_noData)
    val formatTime = rememberMotorTimeFormatter()
    val display =
        remember(state.data, size, temperatureUnit, strings) {
            MotorHistoryProjection.project(
                snapshot = state.data ?: MotorHistorySnapshot.EMPTY,
                size = size,
                tempUnit = temperatureUnit,
                strings = strings,
                formatTime = formatTime,
            )
        }
    GlassPanel(modifier = modifier.fillMaxSize(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> MotorHistoryLoading(size)
            state.isError -> MotorHistoryError(state = state, title = title, onRetry = onRefresh)
            else -> {
                MotorHistoryHeader(state = state, title = title, size = size, onRefresh = onRefresh)
                if (!display.hasData) {
                    MotorHistoryEmpty(message = emptyMessage)
                } else {
                    MotorHistoryBody(display = display)
                }
            }
        }
    }
}

@Composable
private fun MotorHistoryHeader(
    state: UiState<MotorHistorySnapshot>,
    title: String,
    size: MotorHistorySize,
    onRefresh: () -> Unit,
) {
    val showTitle = !size.isCompact
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showTitle) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = NavGlyphs.Gear,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.chart.regen,
                )
                PanelTitle(title, modifier = Modifier.semantics { heading() })
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
            IconButton(
                imageVector = FeedbackGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

/**
 * The `WidgetChartSummary` body: the Torque / Stator latest-value stat pair, plus — only on the
 * non-compact footprint (web `chart={null}` in compact) — the torque + stator line chart and a series
 * legend beneath it.
 */
@Composable
private fun MotorHistoryBody(display: MotorHistoryDisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MotorHistoryStats(display = display)
        if (!display.isCompact) {
            MotorHistoryChart(display = display)
            MotorHistoryLegend(display = display)
        }
    }
}

@Composable
private fun MotorHistoryStats(display: MotorHistoryDisplay) {
    if (display.stats.isEmpty()) return
    val statorDanger = TeslaTokens.status.danger
    val normal = MaterialTheme.colorScheme.onSurface
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        display.stats.forEachIndexed { index, stat ->
            val isStator = index == STATOR_STAT_INDEX
            val valueColor = if (isStator && display.latestStatorInDanger) statorDanger else normal
            MotorStatItem(stat = stat, valueColor = valueColor, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun MotorStatItem(
    stat: MotorStat,
    valueColor: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = stat.value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = valueColor,
            )
            Caption(stat.unit, modifier = Modifier.padding(bottom = STAT_UNIT_BOTTOM_PADDING))
        }
        MetricLabel(stat.label)
    }
}

@Composable
private fun MotorHistoryChart(display: MotorHistoryDisplay) {
    val torqueColor = TeslaTokens.chart.regen
    val statorColor = if (display.peakStatorInDanger) TeslaTokens.status.danger else TeslaTokens.chart.energy
    val lateralColor = TeslaTokens.chart.power
    val longColor = TeslaTokens.chart.battery
    val locale = Locale.getDefault()
    val strings = rememberMotorHistoryStrings()
    val labels = remember(display) { display.points.map { it.timeLabel } }
    val series =
        remember(display, torqueColor, statorColor, lateralColor, longColor, strings) {
            buildList {
                add(lineSeries(KEY_TORQUE, strings.torque, display.points.map { it.torqueNm }, torqueColor, UNIT_TORQUE))
                add(lineSeries(KEY_STATOR, strings.statorTemp, display.points.map { it.statorTempDisplay }, statorColor, null))
                if (display.isWide) {
                    add(lineSeries(KEY_LATERAL_G, strings.lateralG, display.points.map { it.lateralG }, lateralColor, UNIT_G))
                    add(lineSeries(KEY_LONG_G, strings.longG, display.points.map { it.longitudinalG }, longColor, UNIT_G))
                }
            }
        }
    LineChartWrapper(
        series = series,
        xLabels = labels,
        modifier = Modifier.fillMaxWidth(),
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = "",
    )
}

@Composable
private fun MotorHistoryLegend(display: MotorHistoryDisplay) {
    val strings = rememberMotorHistoryStrings()
    val statorColor = if (display.peakStatorInDanger) TeslaTokens.status.danger else TeslaTokens.chart.energy
    val entries =
        buildList {
            add(LegendEntry(KEY_TORQUE, strings.torque, TeslaTokens.chart.regen))
            add(LegendEntry(KEY_STATOR, strings.statorTemp, statorColor))
            if (display.isWide) {
                add(LegendEntry(KEY_LATERAL_G, strings.lateralG, TeslaTokens.chart.power))
                add(LegendEntry(KEY_LONG_G, strings.longG, TeslaTokens.chart.battery))
            }
        }
    ChartLegend(entries = entries, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun MotorHistoryEmpty(message: String) {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = message, icon = NavGlyphs.Gear)
    }
}

@Composable
private fun MotorHistoryError(
    state: UiState<MotorHistorySnapshot>,
    title: String,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = state.toQueryErrorKind(), resourceName = title, onRetry = onRetry)
    }
}

@Composable
private fun MotorHistoryLoading(size: MotorHistorySize) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatGridSkeleton(count = STAT_COUNT)
        if (!size.isCompact) {
            Skeleton(height = CHART_HEIGHT, rounded = true)
        }
    }
}

/** Resolves the source stat + series labels through the i18n facade (P1/S10). */
@Composable
private fun rememberMotorHistoryStrings(): MotorHistoryStrings =
    MotorHistoryStrings(
        torque = stringResource(R.string.translation_widget_motorHistory_torque),
        statorTemp = stringResource(R.string.translation_widget_motorHistory_statorTemp),
        lateralG = stringResource(R.string.translation_widget_motorHistory_lateralG),
        longG = stringResource(R.string.translation_widget_motorHistory_longG),
    )

/**
 * A locale + system-zone short-time formatter for the x-axis ticks (web `useDateFormat().formatDateTime`
 * tick formatter). Parses an ISO instant (with `Z` or an explicit offset) and falls back to the raw
 * timestamp when it cannot be parsed, so a malformed row never throws.
 */
@Composable
private fun rememberMotorTimeFormatter(): (String) -> String {
    val formatter =
        remember { DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()) }
    return remember(formatter) {
        { iso -> parseInstant(iso)?.let(formatter::format) ?: iso }
    }
}

/** Parse an ISO timestamp as an [Instant], tolerating both a trailing `Z` and an explicit offset. */
private fun parseInstant(iso: String): Instant? =
    runCatching { Instant.parse(iso) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()

private fun lineSeries(
    key: String,
    label: String,
    values: List<Double?>,
    color: Color,
    unit: String?,
): ChartSeries = ChartSeries(key = key, label = label, values = values, kind = ChartSeriesKind.Line, color = color, unit = unit)

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val STAT_COUNT = 2
private const val STATOR_STAT_INDEX = 1

// ── Previews — one per rendered state (content / wide / compact / empty / loading / error) ─────────────

private fun previewRow(
    minute: Int,
    torque: Double,
    stator: Double,
    lateralG: Double,
    longG: Double,
): JsonObject =
    buildJsonObject {
        put("ts", "2024-01-15T10:%02d:00Z".format(minute))
        put("di_torque", torque)
        put("di_stator_temp", stator)
        put("lateral_accel", lateralG)
        put("longitudinal_accel", longG)
    }

private fun sampleSnapshot(): MotorHistorySnapshot =
    MotorHistorySnapshot(
        listOf(
            previewRow(10, 120.0, 45.0, 0.12, -0.30),
            previewRow(20, 240.0, 58.0, 0.35, 0.42),
            previewRow(30, 180.0, 72.0, -0.18, 0.10),
            previewRow(40, 310.0, 88.0, 0.50, 0.61),
        ),
    )

private fun dangerSnapshot(): MotorHistorySnapshot =
    MotorHistorySnapshot(
        listOf(
            previewRow(10, 200.0, 80.0, 0.10, 0.20),
            previewRow(20, 280.0, 96.0, 0.30, 0.40),
            previewRow(30, 260.0, 108.0, 0.20, 0.35),
        ),
    )

@Preview(name = "MotorHistory · content", showBackground = true)
@Composable
private fun MotorHistoryContentPreview() {
    TeslaSyncTheme {
        MotorHistoryWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = MotorHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "MotorHistory · wide + danger", showBackground = true)
@Composable
private fun MotorHistoryWidePreview() {
    TeslaSyncTheme {
        MotorHistoryWidgetContent(
            state = UiState(phase = UiPhase.Content, data = dangerSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = MotorHistorySize(cols = 4, rows = 6),
            onRefresh = {},
        )
    }
}

@Preview(name = "MotorHistory · compact", showBackground = true)
@Composable
private fun MotorHistoryCompactPreview() {
    TeslaSyncTheme {
        MotorHistoryWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = MotorHistorySize(cols = 1, rows = 4),
            onRefresh = {},
        )
    }
}

@Preview(name = "MotorHistory · empty", showBackground = true)
@Composable
private fun MotorHistoryEmptyPreview() {
    TeslaSyncTheme {
        MotorHistoryWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = MotorHistorySnapshot.EMPTY, fetchedAt = System.currentTimeMillis()),
            size = MotorHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "MotorHistory · loading", showBackground = true)
@Composable
private fun MotorHistoryLoadingPreview() {
    TeslaSyncTheme {
        MotorHistoryWidgetContent(
            state = UiState.loading(),
            size = MotorHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "MotorHistory · error", showBackground = true)
@Composable
private fun MotorHistoryErrorPreview() {
    TeslaSyncTheme {
        MotorHistoryWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = MotorHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}
