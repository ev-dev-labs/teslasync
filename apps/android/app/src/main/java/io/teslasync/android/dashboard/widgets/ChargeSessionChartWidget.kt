package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
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
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val STAT_COUNT = 3
private const val Y_AXIS_DECIMALS = 0
private const val KEY_HOME = "home"
private const val KEY_SUPERCHARGER = "supercharger"
private const val KEY_DC = "dc"

/**
 * The native Charge Session Chart dashboard surface — a Jetpack Compose / Material 3 parity port of
 * web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx. It mirrors the web `WidgetShell`
 * (a skeleton while loading, a `QueryError` on hard failure, otherwise a freshness header) wrapping
 * the web `WidgetChartSummary`: a Total / Avg / Sessions stat row over a bar chart of per-session
 * energy (kWh) colour-coded by charger type — green Home/AC, red Supercharger, amber DC-fast — with a
 * matching legend; or a friendly "No charge sessions yet" empty state. The compact (1×1) footprint
 * shows only the stat row, exactly like the web compact branch. All data flows through the shared
 * [ChargeSessionChartViewModel] (P1/S8); the view never performs HTTP. Every string resolves through
 * the i18n catalog and the refresh control carries a screen-reader name.
 */
@Composable
fun ChargeSessionChartWidget(
    viewModel: ChargeSessionChartViewModel,
    modifier: Modifier = Modifier,
    size: ChargeSessionChartSize = ChargeSessionChartRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    ChargeSessionChartWidgetContent(
        state = state,
        size = size,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for the Charge Session Chart surface — every state from the web source is
 * reproduced and none is ever hidden. Split out from [ChargeSessionChartWidget] so each state can be
 * rendered in a snapshot/accessibility test without a view-model or network.
 */
@Composable
fun ChargeSessionChartWidgetContent(
    state: UiState<List<ChargingSession>>,
    size: ChargeSessionChartSize,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberChargeSessionChartStrings()
    val display =
        remember(state.data, size, strings) {
            ChargeSessionChartProjection.project(state.data ?: emptyList(), size, strings)
        }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> ChargeSessionChartLoading(size)
            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRetry)

            !display.hasData -> {
                ChargeSessionChartHeader(state = state, strings = strings, size = size, onRefresh = onRetry)
                EmptyState(message = strings.empty, icon = ChargeSessionChartGlyphs.Zap)
            }

            else -> {
                ChargeSessionChartHeader(state = state, strings = strings, size = size, onRefresh = onRetry)
                ChargeSessionChartBody(display = display, strings = strings)
            }
        }
    }
}

@Composable
private fun ChargeSessionChartHeader(
    state: UiState<List<ChargingSession>>,
    strings: ChargeSessionChartStrings,
    size: ChargeSessionChartSize,
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
                    ChargeSessionChartGlyphs.Zap,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.success,
                )
                PanelTitle(strings.title)
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
                imageVector = ChargeSessionChartGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun ChargeSessionChartBody(
    display: ChargeSessionChartDisplay,
    strings: ChargeSessionChartStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ChargeSessionChartStats(stats = display.stats)
        if (!display.isCompact) {
            ChargeSessionChartGraph(display = display, strings = strings)
            ChargeSessionChartLegend(strings = strings)
        }
    }
}

@Composable
private fun ChargeSessionChartStats(stats: List<ChargeSummaryStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            ChargeSessionChartStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun ChargeSessionChartStatItem(
    stat: ChargeSummaryStat,
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
            if (stat.unit != null) {
                Caption(stat.unit, modifier = Modifier.padding(bottom = STAT_UNIT_BOTTOM_PADDING))
            }
        }
        MetricLabel(stat.label)
    }
}

@Composable
private fun ChargeSessionChartGraph(
    display: ChargeSessionChartDisplay,
    strings: ChargeSessionChartStrings,
) {
    val homeColor = TeslaTokens.status.success
    val superchargerColor = TeslaTokens.status.danger
    val dcColor = TeslaTokens.status.warning
    val locale = Locale.getDefault()
    val labels = remember(display.bars) { display.bars.map { it.label } }
    val series =
        remember(display.bars, homeColor, superchargerColor, dcColor, strings) {
            listOf(
                barSeries(KEY_HOME, strings.typeHome, ChargerKind.Home, homeColor, display.bars),
                barSeries(KEY_SUPERCHARGER, strings.typeSupercharger, ChargerKind.Supercharger, superchargerColor, display.bars),
                barSeries(KEY_DC, strings.typeDc, ChargerKind.Dc, dcColor, display.bars),
            )
        }
    BarChartWrapper(
        series = series,
        xLabels = labels,
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = strings.empty,
    )
}

private fun barSeries(
    key: String,
    label: String,
    kind: ChargerKind,
    color: Color,
    bars: List<ChargeSessionBar>,
): ChartSeries =
    ChartSeries(
        key = key,
        label = label,
        values = bars.map { if (it.kind == kind) it.energyKwh else null },
        kind = ChartSeriesKind.Bar,
        color = color,
        unit = ChargeSessionChartProjection.KWH_UNIT,
    )

@Composable
private fun ChargeSessionChartLegend(strings: ChargeSessionChartStrings) {
    val entries =
        listOf(
            LegendEntry(KEY_HOME, strings.typeHome, TeslaTokens.status.success),
            LegendEntry(KEY_SUPERCHARGER, strings.typeSupercharger, TeslaTokens.status.danger),
            LegendEntry(KEY_DC, strings.typeDc, TeslaTokens.status.warning),
        )
    ChartLegend(entries = entries, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun ChargeSessionChartLoading(size: ChargeSessionChartSize) {
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

/** Resolves the source strings through the i18n facade (P1/S10); the legend reuses the shared chargerTypes keys. */
@Composable
private fun rememberChargeSessionChartStrings(): ChargeSessionChartStrings =
    ChargeSessionChartStrings(
        title = stringResource(R.string.translation_widget_chargeSessionChart_title),
        total = stringResource(R.string.translation_widget_chargeSessionChart_total),
        avg = stringResource(R.string.translation_widget_chargeSessionChart_avg),
        sessions = stringResource(R.string.translation_widget_chargeSessionChart_sessions),
        empty = stringResource(R.string.translation_widget_chargeSessionChart_empty),
        typeHome = stringResource(R.string.translation_chargerTypes_home),
        typeSupercharger = stringResource(R.string.translation_chargerTypes_supercharger),
        typeDc = stringResource(R.string.translation_chargerTypes_dc),
    )

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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library
 * leans on lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured
 * at render time by the [Icon] tint.
 */
private object ChargeSessionChartGlyphs {
    /** Lightning bolt — header + empty state (web `Zap`). */
    val Zap: ImageVector =
        chargeVector("ChargeSessionChartZap") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(11f, 14f)
            lineTo(10f, 22f)
            lineTo(20f, 9f)
            lineTo(13f, 9f)
            close()
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        chargeVector("ChargeSessionChartRefresh") {
            moveTo(20f, 9f)
            curveTo(18.5f, 6f, 15.5f, 4f, 12f, 4f)
            curveTo(8f, 4f, 4.7f, 6.8f, 4f, 11f)
            moveTo(4f, 15f)
            curveTo(5.5f, 18f, 8.5f, 20f, 12f, 20f)
            curveTo(16f, 20f, 19.3f, 17.2f, 20f, 13f)
            moveTo(20f, 5f)
            lineTo(20f, 9f)
            lineTo(16f, 9f)
            moveTo(4f, 19f)
            lineTo(4f, 15f)
            lineTo(8f, 15f)
        }
}

private fun chargeVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
