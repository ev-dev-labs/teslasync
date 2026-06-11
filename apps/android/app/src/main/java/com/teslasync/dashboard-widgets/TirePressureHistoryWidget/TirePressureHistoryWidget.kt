// The native Jetpack Compose + Material 3 Tire Pressure History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a freshness header)
// wrapping the web `WidgetChartSummary`: an FL / FR / RL / RR latest-value stat row over a four-corner
// tire-pressure line chart, or a friendly "No tire pressure history" empty state. The compact (1-column)
// footprint shows only the stat row, exactly like the web `chart={null}` compact branch. All data flows
// through the shared [TirePressureHistoryWidgetViewModel] (P1/S8); SI Pascal pressures are converted to
// the user's unit at this render boundary via the live [io.teslasync.android.data.UnitFormatter]. The
// view performs no HTTP. Every string resolves through the i18n catalog and the refresh control carries
// a TalkBack label.
//
// Documented native deviation (web Recharts → Vico, ADR-012; see components/charts/SURVEY.md): Vico 2.0
// exposes no horizontal reference-line/band decoration, so the web's two dashed-green `ReferenceLine`s
// (the recommended pressure range, labeled "Min"/"Max" at `refLow`/`refHigh`) are surfaced as an
// accessible recommended-range caption beneath the chart carrying the same Min/Max labels + converted
// bound values — the same approach the MotorHistory surface uses for its `ReferenceArea`. The reference
// bounds take the exact `RECOMMENDED_RANGE_BAR.* * 100_000 → toPressureValue` path the web uses, so they
// stay consistent with the plotted corners.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TirePressureHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tirepressurehistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.units.PressureUnitPref
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private val CHART_HEIGHT = 168.dp
private val BODY_MIN_HEIGHT = 140.dp
private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val Y_AXIS_DECIMALS = 1
private const val STAT_COUNT = 4
private const val KEY_FL = "fl"
private const val KEY_FR = "fr"
private const val KEY_RL = "rl"
private const val KEY_RR = "rr"

/**
 * Stateful entry point. Collects the shared [TirePressureHistoryWidgetViewModel] state + the live [units]
 * formatter (for the display pressure unit), records the one-shot `view.opened` diagnostic, and renders
 * the surface for the given [size]. A dashboard host supplies the view-model (wired via
 * [TirePressureHistoryWidgetViewModel.factory]); [units] defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TirePressureHistoryWidget(
    viewModel: TirePressureHistoryWidgetViewModel,
    modifier: Modifier = Modifier,
    size: TirePressureHistorySize = TirePressureHistoryRegistration.defaultSize,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    TirePressureHistoryWidgetContent(
        state = state,
        size = size,
        pressureUnit = formatter.prefs.pressure,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless Tire Pressure History panel — renders every state the web widget does (loading / content /
 * empty / error, plus stale + offline via the header freshness chip over the cached chart). Stale
 * (non-error) data auto-refreshes (web TanStack stale refetch). Hoisted out of the ViewModel so each
 * state is preview- and screenshot-testable with hand-built [UiState] inputs. [pressureUnit] supplies the
 * SI Pascal → display conversion + unit symbol at the render boundary.
 */
@Composable
fun TirePressureHistoryWidgetContent(
    state: UiState<TirePressureHistorySnapshot>,
    size: TirePressureHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    pressureUnit: PressureUnitPref = PressureUnitPref.BAR,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberTirePressureHistoryStrings()
    val formatTime = rememberTirePressureTimeFormatter()
    val display =
        remember(state.data, size, pressureUnit, strings) {
            TirePressureHistoryProjection.project(
                snapshot = state.data ?: TirePressureHistorySnapshot.EMPTY,
                size = size,
                pressureUnit = pressureUnit,
                strings = strings,
                formatTime = formatTime,
            )
        }
    GlassPanel(modifier = modifier.fillMaxSize(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> TirePressureHistoryLoading(size)
            state.isError -> TirePressureHistoryError(state = state, title = strings.title, onRetry = onRefresh)
            else -> {
                TirePressureHistoryHeader(state = state, title = strings.title, size = size, onRefresh = onRefresh)
                if (!display.hasData) {
                    TirePressureHistoryEmpty(message = display.noDataMessage)
                } else {
                    TirePressureHistoryBody(display = display)
                }
            }
        }
    }
}

@Composable
private fun TirePressureHistoryHeader(
    state: UiState<TirePressureHistorySnapshot>,
    title: String,
    size: TirePressureHistorySize,
    onRefresh: () -> Unit,
) {
    // Web shows the shell title only on the non-compact footprint (compact passes no title).
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
                    imageVector = TirePressureGlyphs.CircleDot,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.chart.speed,
                )
                PanelTitle(title, modifier = Modifier.semantics { heading() })
            }
        } else {
            Spacer(modifier = Modifier.fillMaxWidth().weight(1f))
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
 * The `WidgetChartSummary` body: the FL / FR / RL / RR latest-value stat row, plus — only on the
 * non-compact footprint (web `chart={null}` in compact) — the four-corner line chart, the recommended
 * range caption, and a corner legend beneath it.
 */
@Composable
private fun TirePressureHistoryBody(display: TirePressureHistoryDisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        TirePressureHistoryStats(stats = display.stats)
        if (!display.isCompact) {
            TirePressureHistoryChart(display = display)
            TirePressureRecommendedRange(display = display)
            TirePressureHistoryLegend(display = display)
        }
    }
}

@Composable
private fun TirePressureHistoryStats(stats: List<TirePressureHistoryStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.forEach { stat ->
            TirePressureStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun TirePressureStatItem(
    stat: TirePressureHistoryStat,
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
                color = MaterialTheme.colorScheme.onSurface,
            )
            Caption(stat.unit, modifier = Modifier.padding(bottom = STAT_UNIT_BOTTOM_PADDING))
        }
        MetricLabel(stat.label)
    }
}

@Composable
private fun TirePressureHistoryChart(display: TirePressureHistoryDisplay) {
    val locale = Locale.getDefault()
    val labels = remember(display) { display.points.map { it.timeLabel } }
    val flColor = TeslaTokens.chart.speed
    val frColor = TeslaTokens.chart.energy
    val rlColor = TeslaTokens.chart.regen
    val rrColor = TeslaTokens.chart.power
    val series =
        remember(display, flColor, frColor, rlColor, rrColor) {
            listOf(
                cornerSeries(KEY_FL, display.flLabel, display.points.map { it.frontLeft }, flColor),
                cornerSeries(KEY_FR, display.frLabel, display.points.map { it.frontRight }, frColor),
                cornerSeries(KEY_RL, display.rlLabel, display.points.map { it.rearLeft }, rlColor),
                cornerSeries(KEY_RR, display.rrLabel, display.points.map { it.rearRight }, rrColor),
            )
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

private fun cornerSeries(
    key: String,
    label: String,
    values: List<Double?>,
    color: Color,
): ChartSeries = ChartSeries(key = key, label = label, values = values, kind = ChartSeriesKind.Line, color = color)

/**
 * The accessible recommended-range caption — the native surfacing of the web's two dashed-green
 * `ReferenceLine`s (labeled "Min"/"Max" at `refLow`/`refHigh`). Vico 2.0 draws no horizontal reference
 * line (SURVEY.md), so the bounds are shown as a muted caption carrying the same Min/Max labels +
 * converted values + unit, keeping the recommended range visible and screen-reader accessible.
 */
@Composable
private fun TirePressureRecommendedRange(display: TirePressureHistoryDisplay) {
    val locale = Locale.getDefault()
    val low = ChartFormat.number(display.recommendedLow, Y_AXIS_DECIMALS, locale)
    val high = ChartFormat.number(display.recommendedHigh, Y_AXIS_DECIMALS, locale)
    Caption(
        text = "${display.minLabel} $low · ${display.maxLabel} $high ${display.unit}",
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun TirePressureHistoryLegend(display: TirePressureHistoryDisplay) {
    val entries =
        listOf(
            LegendEntry(KEY_FL, display.flLabel, TeslaTokens.chart.speed),
            LegendEntry(KEY_FR, display.frLabel, TeslaTokens.chart.energy),
            LegendEntry(KEY_RL, display.rlLabel, TeslaTokens.chart.regen),
            LegendEntry(KEY_RR, display.rrLabel, TeslaTokens.chart.power),
        )
    ChartLegend(entries = entries, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun TirePressureHistoryEmpty(message: String) {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = message, icon = TirePressureGlyphs.CircleDot)
    }
}

@Composable
private fun TirePressureHistoryError(
    state: UiState<TirePressureHistorySnapshot>,
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
private fun TirePressureHistoryLoading(size: TirePressureHistorySize) {
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

/** Resolves the source strings through the i18n facade (P1/S10). */
@Composable
private fun rememberTirePressureHistoryStrings(): TirePressureHistoryStrings {
    val title = stringResource(R.string.translation_widget_tirePressureHistory_title)
    val fl = stringResource(R.string.translation_widget_tirePressureHistory_fl)
    val fr = stringResource(R.string.translation_widget_tirePressureHistory_fr)
    val rl = stringResource(R.string.translation_widget_tirePressureHistory_rl)
    val rr = stringResource(R.string.translation_widget_tirePressureHistory_rr)
    val min = stringResource(R.string.translation_widget_tirePressureHistory_min)
    val max = stringResource(R.string.translation_widget_tirePressureHistory_max)
    val noData = stringResource(R.string.translation_widget_tirePressureHistory_noData)
    return remember(title, fl, fr, rl, rr, min, max, noData) {
        TirePressureHistoryStrings(
            title = title,
            fl = fl,
            fr = fr,
            rl = rl,
            rr = rr,
            min = min,
            max = max,
            noData = noData,
        )
    }
}

/**
 * A locale + system-zone short-time formatter for the x-axis labels (web `useDateFormat().formatDateTime`
 * tick formatter). Parses an ISO instant (with `Z` or an explicit offset) and falls back to the raw
 * timestamp when it cannot be parsed, so a malformed row never throws.
 */
@Composable
private fun rememberTirePressureTimeFormatter(): (String) -> String {
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

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Self-contained `CircleDot` glyph for the surface, authored as a 24×24 vector (the web library leans on
 * lucide-react's `CircleDot`, which has no bundled Android equivalent): a stroked outer ring + a filled
 * centre dot. Monochrome, recoloured at render time by the [Icon] tint.
 */
private object TirePressureGlyphs {
    /** Concentric ring + centre dot — header + empty state (web `CircleDot`). */
    val CircleDot: ImageVector =
        ImageVector
            .Builder(
                name = "TirePressureCircleDot",
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                // Outer ring: a full circle centred (12,12) radius 10, drawn as two half-arcs.
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                ) {
                    moveTo(2f, 12f)
                    arcToRelative(10f, 10f, 0f, true, true, 20f, 0f)
                    arcToRelative(10f, 10f, 0f, true, true, -20f, 0f)
                    close()
                }
                // Centre dot: a filled circle centred (12,12) radius 1.5, drawn as two half-arcs.
                path(fill = SolidColor(Color.Black)) {
                    moveTo(10.5f, 12f)
                    arcToRelative(1.5f, 1.5f, 0f, true, true, 3f, 0f)
                    arcToRelative(1.5f, 1.5f, 0f, true, true, -3f, 0f)
                    close()
                }
            }.build()
}
