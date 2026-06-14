// The native Jetpack Compose + Material 3 Climate History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, otherwise a thermometer-iconed title + freshness header)
// wrapping the web `WidgetChartSummary`: a Cabin / Outside latest-temperature stat row over a two-channel
// gradient area chart of the cabin vs outside temperature history, or a friendly "No climate history"
// empty state when there is nothing to plot. The compact (single-column) footprint shows only the stat
// row, exactly like the web compact branch. All data flows through the shared
// [ClimateHistoryWidgetViewModel] (P1/S8); the view never performs HTTP. Temperatures are SI→display
// converted at this render boundary via the shared [UnitFormatter] (web `useUnits()` + `convertTempFromSI`),
// every string resolves through the i18n catalog (P1/S10), and the refresh control carries a TalkBack name.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ClimateHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatehistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val STAT_COUNT = 2
private const val DEGREE_SIGN = "\u00B0"

/**
 * Stateful entry point. Binds the shared vehicles + climate-history feeds via [source] into a
 * [ClimateHistoryWidgetViewModel], resolves the live display-[UnitFormatter] from the app container
 * ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and renders
 * the surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8
 * Vehicles + VehicleSystems data layer) and a unique [instanceKey] per placement; an explicit [vehicleId]
 * pins the surface to one vehicle (web `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is
 * used.
 */
@Composable
fun ClimateHistoryWidget(
    source: ClimateHistorySource,
    modifier: Modifier = Modifier,
    size: ClimateHistorySize = ClimateHistoryRegistration.defaultSize,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ClimateHistoryRegistration.ID,
) {
    val viewModel: ClimateHistoryWidgetViewModel =
        viewModel(key = instanceKey, factory = ClimateHistoryWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    ClimateHistoryWidgetContent(
        state = state,
        formatter = formatter,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the freshness header over the
 * stat row + area chart, or the "No climate history" empty state. The web climate-history widget does not
 * pass `WidgetShell`'s `error` prop, so a hard failure is surfaced honestly through the header freshness
 * chip (offline) + the refresh control (the retry affordance) above the empty body — never a blanked
 * panel — and a stale/offline cached history keeps its chart visible with the freshness chip flagged.
 */
@Composable
fun ClimateHistoryWidgetContent(
    state: UiState<ClimateHistorySnapshot>,
    formatter: UnitFormatter,
    size: ClimateHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> ClimateHistoryLoading(size)
            else -> ClimateHistoryLoaded(state = state, formatter = formatter, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun ClimateHistoryLoaded(
    state: UiState<ClimateHistorySnapshot>,
    formatter: UnitFormatter,
    size: ClimateHistorySize,
    onRefresh: () -> Unit,
) {
    val strings = rememberClimateHistoryStrings()
    val display =
        remember(state.data, size, strings, formatter) {
            ClimateHistoryProjection.project(state.data ?: ClimateHistorySnapshot.EMPTY, size, strings, formatter)
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ClimateHistoryHeader(state = state, display = display, onRefresh = onRefresh)
        if (!display.hasData) {
            EmptyState(
                message = display.noDataMessage,
                icon = ClimateHistoryGlyphs.ThermometerSun,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            ClimateHistoryBody(display = display, formatter = formatter)
        }
    }
}

@Composable
private fun ClimateHistoryHeader(
    state: UiState<ClimateHistorySnapshot>,
    display: ClimateHistoryDisplay,
    onRefresh: () -> Unit,
) {
    // Web shows the shell title + icon only in the standard (non-compact) branch.
    val showTitle = !display.isCompact
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showTitle) {
            Row(
                modifier = Modifier.semantics { heading() },
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = ClimateHistoryGlyphs.ThermometerSun,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.chart.energy,
                )
                PanelTitle(display.title)
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
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberRelativeAgeFormatter(),
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

@Composable
private fun ClimateHistoryBody(
    display: ClimateHistoryDisplay,
    formatter: UnitFormatter,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ClimateHistoryStats(stats = display.stats)
        if (!display.isCompact) {
            ClimateHistoryChart(display = display, formatter = formatter)
            ClimateHistoryLegend(display = display)
        }
    }
}

@Composable
private fun ClimateHistoryStats(stats: List<ClimateHistoryStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            ClimateHistoryStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun ClimateHistoryStatItem(
    stat: ClimateHistoryStat,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "${stat.label}, ${stat.value}${stat.unit ?: ""}" },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(stat.label)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = stat.value,
                modifier = Modifier.weight(1f, fill = false),
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (stat.unit != null) {
                Caption(stat.unit, modifier = Modifier.padding(bottom = STAT_UNIT_BOTTOM_PADDING))
            }
        }
    }
}

@Composable
private fun ClimateHistoryChart(
    display: ClimateHistoryDisplay,
    formatter: UnitFormatter,
) {
    val insideColor = TeslaTokens.chart.energy
    val outsideColor = TeslaTokens.chart.speed
    val locale = remember(formatter) { localeOf(formatter) }
    val series =
        remember(display, insideColor, outsideColor) {
            listOf(
                areaSeries(KEY_INSIDE, display.cabinLabel, insideColor, display.insideValues, display.tempUnit),
                areaSeries(KEY_OUTSIDE, display.outsideLabel, outsideColor, display.outsideValues, display.tempUnit),
            )
        }
    AreaChartWrapper(
        series = series,
        xLabels = display.xLabels,
        height = CHART_HEIGHT,
        yValueFormatter = { "${ChartFormat.number(it, TEMP_DECIMALS, locale)}$DEGREE_SIGN" },
        emptyMessage = display.noDataMessage,
    )
}

private fun areaSeries(
    key: String,
    label: String,
    color: Color,
    values: List<Double?>,
    unit: String,
): ChartSeries =
    ChartSeries(
        key = key,
        label = label,
        values = values,
        kind = ChartSeriesKind.Area,
        color = color,
        unit = unit,
    )

@Composable
private fun ClimateHistoryLegend(display: ClimateHistoryDisplay) {
    val entries =
        listOf(
            LegendEntry(KEY_INSIDE, display.cabinLabel, TeslaTokens.chart.energy),
            LegendEntry(KEY_OUTSIDE, display.outsideLabel, TeslaTokens.chart.speed),
        )
    ChartLegend(entries = entries, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun ClimateHistoryLoading(size: ClimateHistorySize) {
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
private fun rememberClimateHistoryStrings(): ClimateHistoryStrings {
    val title = stringResource(R.string.translation_widget_climateHistory_title)
    val cabin = stringResource(R.string.translation_widget_climateHistory_cabin)
    val outside = stringResource(R.string.translation_widget_climateHistory_outside)
    val noData = stringResource(R.string.translation_widget_climateHistory_noData)
    return remember(title, cabin, outside, noData) {
        ClimateHistoryStrings(title = title, cabin = cabin, outside = outside, noData = noData)
    }
}

/**
 * Builds the localized relative-age formatter the header freshness chip folds [FreshnessAge] buckets
 * through (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

private fun localeOf(formatter: UnitFormatter): Locale {
    val tag = formatter.prefs.locale
    return if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)
}

// ── Local glyph — the web `ThermometerSun` (lucide), authored as a 24×24 stroked vector. The data-display
// layer ships no thermometer-sun glyph and this surface's allowed files cannot extend that catalog, so the
// icon is hand-authored here, mirroring the approach in the sibling ClimateStatusWidget. ──────────────────

private object ClimateHistoryGlyphs {
    /** A thermometer (lower-left) beside a small sun (upper-right) — the web `ThermometerSun`. */
    val ThermometerSun: ImageVector =
        climateGlyph("ClimateHistoryThermometerSun") {
            // Thermometer stem running down into the bulb.
            moveTo(7f, 13.5f)
            lineTo(7f, 6f)
            // Bulb — a circle at the base, approximated with two semicircular arcs.
            moveTo(4.5f, 16.5f)
            arcTo(2.5f, 2.5f, 0f, false, true, 9.5f, 16.5f)
            arcTo(2.5f, 2.5f, 0f, false, true, 4.5f, 16.5f)
            close()
            // Sun core (upper-right) plus four rays.
            moveTo(15.5f, 7f)
            arcTo(2f, 2f, 0f, false, true, 19.5f, 7f)
            arcTo(2f, 2f, 0f, false, true, 15.5f, 7f)
            close()
            moveTo(17.5f, 2.5f)
            lineTo(17.5f, 3.5f)
            moveTo(17.5f, 10.5f)
            lineTo(17.5f, 11.5f)
            moveTo(13f, 7f)
            lineTo(14f, 7f)
            moveTo(21f, 7f)
            lineTo(22f, 7f)
        }
}

private fun climateGlyph(
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

// ── Previews — one per rendered state (content / empty / loading / offline). ──────────────────────────

private fun previewSnapshot(): ClimateHistorySnapshot =
    ClimateHistorySnapshot.ofSamples(
        listOf(
            ClimateSample("2024-06-11T08:00:00Z", insideC = 21.0, outsideC = 14.0),
            ClimateSample("2024-06-11T09:00:00Z", insideC = 22.5, outsideC = 16.0),
            ClimateSample("2024-06-11T10:00:00Z", insideC = 23.0, outsideC = 18.5),
        ),
    )

@Preview(name = "Climate History · content", showBackground = true)
@Composable
private fun ClimateHistoryContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateHistoryWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
            size = ClimateHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "Climate History · empty", showBackground = true)
@Composable
private fun ClimateHistoryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateHistoryWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = ClimateHistorySnapshot.EMPTY, fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
            size = ClimateHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "Climate History · loading", showBackground = true)
@Composable
private fun ClimateHistoryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateHistoryWidgetContent(
            state = UiState.loading(),
            formatter = UnitFormatter.default(),
            size = ClimateHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "Climate History · offline (cached)", showBackground = true)
@Composable
private fun ClimateHistoryOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateHistoryWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
            size = ClimateHistoryRegistration.defaultSize,
            onRefresh = {},
        )
    }
}
