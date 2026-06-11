// The native Jetpack Compose + Material 3 Energy Stats dashboard surface — a parity port of
// web/src/features/dashboard/widgets/EnergyStatsWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a `QueryError` retry surface on hard failure, otherwise a freshness header) wrapping one
// of the two bodies the web renders: the compact total-energy hero (1×N — a big kWh number + unit label)
// or — when wider — the standard layout (a daily-usage area chart over a stat grid of Total Used / Total
// Charged / Avg Efficiency / CO₂ Saved, plus Total Cost + Net Energy at three-plus columns), with a
// friendly empty state when no payload exists. All data flows through the shared
// [EnergyStatsWidgetViewModel]; SI energy is formatted + SI Wh/m efficiency is converted at this render
// boundary via the live [UnitFormatter]. The view never performs HTTP. Every string resolves through the
// i18n catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergyStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energystats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private val HERO_MIN_HEIGHT = 44.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_HERO_HEIGHT = 32.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_HERO_FRACTION = 0.6f
private const val Y_AXIS_DECIMALS = 1
private const val COMPACT_HERO_DECIMALS = 0
private const val STAT_STANDARD_COUNT = 4
private const val STAT_WIDE_COUNT = 6
private const val KEY_ENERGY = "energy"
private const val UNIT_KWH = "kWh"

/**
 * Stateful entry point. Binds the shared feeds via [source] into an [EnergyStatsWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement. [units] defaults to the app's
 * `LocalDataContainer` live formatter (web `useUnits`).
 *
 * @param source the cache-then-network seam (vehicles + energy-stats adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EnergyStatsWidget(
    source: EnergyStatsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: EnergyStatsSize = EnergyStatsRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = EnergyStatsRegistration.ID,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val viewModel: EnergyStatsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { EnergyStatsWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    EnergyStatsWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI energy formatting +
 * Wh/m → display-unit efficiency conversion; [locale] drives number grouping (tests pin a deterministic
 * locale).
 */
@Composable
fun EnergyStatsWidgetContent(
    state: UiState<JsonElement>,
    prefs: UnitPref,
    size: EnergyStatsSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberEnergyStatsStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                EnergyStatsLoading(size = size, label = stringResource(R.string.translation_a11y_loading))

            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val display =
                    remember(state.data, size, prefs, strings, locale) {
                        EnergyStatsProjection.project(parseEnergyStats(state.data), size, strings, prefs, locale)
                    }
                if (size.isCompact) {
                    EnergyStatsCompact(state = state, display = display, locale = locale)
                } else {
                    EnergyStatsStandard(state = state, display = display, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun EnergyStatsCompact(
    state: UiState<JsonElement>,
    display: EnergyStatsDisplay,
    locale: Locale,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
    if (display.hasData) {
        EnergyStatsHero(display = display, locale = locale)
    } else {
        EnergyStatsEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun EnergyStatsHero(
    display: EnergyStatsDisplay,
    locale: Locale,
) {
    val reduceMotion = rememberReducedMotion()
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = HERO_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (reduceMotion) {
            MetricValue(display.compactValueText)
        } else {
            AnimatedNumber(value = display.compactValueKwh, decimals = COMPACT_HERO_DECIMALS, locale = locale)
        }
        MetricLabel(display.energyUnitLabel)
    }
}

@Composable
private fun EnergyStatsStandard(
    state: UiState<JsonElement>,
    display: EnergyStatsDisplay,
    onRefresh: () -> Unit,
) {
    EnergyStatsHeader(title = display.title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        EnergyStatsBody(display = display)
    } else {
        EnergyStatsEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun EnergyStatsHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            EnergyStatsGlyphs.Zap,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.energy,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        IconButton(
            imageVector = EnergyStatsGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun EnergyStatsBody(display: EnergyStatsDisplay) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (display.hasChartData) {
            EnergyStatsChart(display = display)
        }
        EnergyStatsStatGrid(stats = display.stats, columns = display.statGridColumns)
    }
}

@Composable
private fun EnergyStatsChart(display: EnergyStatsDisplay) {
    val color = TeslaTokens.chart.energy
    val locale = Locale.getDefault()
    val labels = remember(display) { display.chartPoints.map { it.label } }
    val series =
        remember(display, color) {
            listOf(
                ChartSeries(
                    key = KEY_ENERGY,
                    label = display.energyKwhLabel,
                    values = display.chartPoints.map { it.energyKwh },
                    kind = ChartSeriesKind.Area,
                    color = color,
                    unit = UNIT_KWH,
                ),
            )
        }
    ComboChart(
        series = series,
        xLabels = labels,
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = "",
    )
}

@Composable
private fun EnergyStatsStatGrid(
    stats: List<EnergyStatItem>,
    columns: Int,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.chunked(columns).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowItems.forEach { item -> EnergyStatTile(item = item) }
                repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun RowScope.EnergyStatTile(item: EnergyStatItem) {
    StatCard(
        label = item.label,
        value = item.value,
        modifier = Modifier.weight(1f),
        unit = item.unit,
        icon = item.icon.glyph(),
    )
}

@Composable
private fun EnergyStatsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = EnergyStatsGlyphs.Zap,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun EnergyStatsLoading(
    size: EnergyStatsSize,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (size.isCompact) {
            Skeleton(widthFraction = LOADING_HERO_FRACTION, height = LOADING_HERO_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(height = CHART_HEIGHT, rounded = true)
            StatGridSkeleton(count = if (size.isWide) STAT_WIDE_COUNT else STAT_STANDARD_COUNT)
        }
    }
}

/**
 * Builds the localized [EnergyStatsStrings] from the i18n catalog (P1/S10) — the ten
 * `widget.energyStats.*` keys the web component reads via `t('widget.energyStats.…')`. Remembered against
 * the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberEnergyStatsStrings(): EnergyStatsStrings {
    val title = stringResource(R.string.translation_widget_energyStats_title)
    val totalUsed = stringResource(R.string.translation_widget_energyStats_totalUsed)
    val totalCharged = stringResource(R.string.translation_widget_energyStats_totalCharged)
    val avgEfficiency = stringResource(R.string.translation_widget_energyStats_avgEfficiency)
    val co2Saved = stringResource(R.string.translation_widget_energyStats_co2Saved)
    val totalCost = stringResource(R.string.translation_widget_energyStats_totalCost)
    val netBalance = stringResource(R.string.translation_widget_energyStats_netBalance)
    val noData = stringResource(R.string.translation_widget_energyStats_noData)
    val dailyUsage = stringResource(R.string.translation_widget_energyStats_dailyUsage)
    val energyKwh = stringResource(R.string.translation_widget_energyStats_energyKwh)
    return remember(
        title,
        totalUsed,
        totalCharged,
        avgEfficiency,
        co2Saved,
        totalCost,
        netBalance,
        noData,
        dailyUsage,
        energyKwh,
    ) {
        EnergyStatsStrings(
            title = title,
            totalUsed = totalUsed,
            totalCharged = totalCharged,
            avgEfficiency = avgEfficiency,
            co2Saved = co2Saved,
            totalCost = totalCost,
            netBalance = netBalance,
            noData = noData,
            dailyUsage = dailyUsage,
            energyKwh = energyKwh,
        )
    }
}

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/** Resolves the stat marker to its self-contained line glyph. */
private fun EnergyStatIcon.glyph(): ImageVector =
    when (this) {
        EnergyStatIcon.Used -> EnergyStatsGlyphs.Zap
        EnergyStatIcon.Charged -> EnergyStatsGlyphs.BatteryCharging
        EnergyStatIcon.Efficiency -> EnergyStatsGlyphs.TrendingUp
        EnergyStatIcon.Co2 -> EnergyStatsGlyphs.Leaf
        EnergyStatIcon.Cost -> EnergyStatsGlyphs.DollarSign
        EnergyStatIcon.Net -> EnergyStatsGlyphs.Route
    }

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans
 * on lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured at render
 * time by the [Icon]/[StatCard] tint — the same approach as the sibling DriveEfficiencyChartWidget.
 */
private object EnergyStatsGlyphs {
    /** lucide `zap` — the lightning bolt (title icon, Total Used tile, empty-state icon). */
    val Zap: ImageVector =
        energyVector("EnergyStatsZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `battery-charging` — a battery body + bolt (Total Charged tile). */
    val BatteryCharging: ImageVector =
        energyVector("EnergyStatsBatteryCharging") {
            moveTo(7f, 7f)
            lineTo(4f, 7f)
            lineTo(4f, 17f)
            lineTo(8f, 17f)
            moveTo(13f, 7f)
            lineTo(16f, 7f)
            lineTo(16f, 17f)
            lineTo(12f, 17f)
            moveTo(21f, 11f)
            lineTo(21f, 13f)
            moveTo(11f, 7f)
            lineTo(8f, 12.5f)
            lineTo(11.5f, 12.5f)
            lineTo(9f, 17f)
        }

    /** lucide `trending-up` — the rising trend arrow (Avg Efficiency tile). */
    val TrendingUp: ImageVector =
        energyVector("EnergyStatsTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** lucide `leaf` — the eco leaf (CO₂ Saved tile). */
    val Leaf: ImageVector =
        energyVector("EnergyStatsLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            curveTo(8f, 14f, 12f, 11f, 17f, 9f)
        }

    /** lucide `dollar-sign` — currency mark (Total Cost tile). */
    val DollarSign: ImageVector =
        energyVector("EnergyStatsDollarSign") {
            moveTo(12f, 2f)
            lineTo(12f, 22f)
            moveTo(16.5f, 6f)
            curveTo(15.5f, 4.5f, 13.5f, 4f, 12f, 4f)
            curveTo(9.5f, 4f, 7.5f, 5.5f, 7.5f, 8f)
            curveTo(7.5f, 13f, 16.5f, 11f, 16.5f, 16f)
            curveTo(16.5f, 18.5f, 14.5f, 20f, 12f, 20f)
            curveTo(10f, 20f, 8f, 19.3f, 7f, 17.5f)
        }

    /** lucide `route` — connected waypoints (Net Energy tile). */
    val Route: ImageVector =
        energyVector("EnergyStatsRoute") {
            moveTo(6f, 19f)
            lineTo(14f, 19f)
            curveTo(16.2f, 19f, 18f, 17.2f, 18f, 15f)
            curveTo(18f, 12.8f, 16.2f, 11f, 14f, 11f)
            lineTo(10f, 11f)
            curveTo(7.8f, 11f, 6f, 9.2f, 6f, 7f)
            curveTo(6f, 4.8f, 7.8f, 3f, 10f, 3f)
            lineTo(18f, 3f)
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        energyVector("EnergyStatsRefresh") {
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

private fun energyVector(
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
