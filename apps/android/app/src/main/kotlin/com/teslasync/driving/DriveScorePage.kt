// The native Jetpack Compose + Material 3 DriveScorePage driving surface — a parity port of
// web/src/features/driving/pages/DriveScorePage.tsx, the per-vehicle driving-rating dashboard. It reproduces every
// panel the web page renders (the hero overall-score gauge, the grade badge, the three category breakdown gauges, the
// score-trend line chart, the category + distribution bar charts, the improvement tips, the best/worst drive cards,
// the sortable + paginated drive-history table, the four summary stat cards, the six weekly/monthly period tiles, the
// achievement badges and the two score-detail definition lists), every data state (loading / empty / error / success,
// plus the cache-then-network stale/offline tier), and every visible string (resolved from the generated res/values
// catalog `driveScore.*` + `common.noData` + `help.driveScore.iconLabel`, ADR-014).
//
// Composition: [DriveScorePage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the data feed + the live display preferences + the range/sort/page
// UI state); [DriveScorePageContent] is the stateless render layer (the chrome — title / subtitle / freshness chip /
// vehicle-scope picker / date-range filter — then the loading / error / empty / loaded body). The loaded body draws
// every panel from the decoded model; all scoring + aggregation + formatting lives in the framework-free model
// (DriveScorePageModel.kt), so this file only resolves i18n + converts SI values to the user's units at the render
// boundary (Phase-48 SI-canonical) + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package. `MatchingDeclarationName` is suppressed for the co-located stateless content +
// sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.driving.drivescore

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardHeader
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.rangepicker.RangePicker
import io.teslasync.android.sharedsurfaces.rangepicker.RangePickerValue
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId

/** Gauge sizes (web `RadialGauge size` 200 / 120 / 72). */
private val HERO_GAUGE = 180.dp
private val CATEGORY_GAUGE = 120.dp
private val DRIVE_GAUGE = 72.dp

/** Drive-history table column widths (the web 8-column grid, made horizontally scrollable on phone). */
private val COL_DATE = 92.dp
private val COL_ROUTE = 184.dp
private val COL_DISTANCE = 96.dp
private val COL_DURATION = 84.dp
private val COL_CONSUMPTION = 104.dp
private val COL_SCORE = 78.dp
private val COL_GRADE = 64.dp
private val COL_EFF = 84.dp

/** Score color thresholds (web `scoreTextClass`). */
private const val SCORE_GOOD = 80
private const val SCORE_OK = 60

/** Best/worst tip thresholds (web ternary cascade). */
private const val BEST_EFF = 35
private const val BEST_SMOOTH = 25
private const val WORST_EFF = 15
private const val WORST_SMOOTH = 10

/** The A-grade reference line value the trend chart annotates (web `ReferenceLine y={80}`). */
private const val GRADE_A_LINE = 80
private const val HUNDRED = 100.0
private const val PALETTE_GREEN = 1
private const val PALETTE_CYAN = 0
private const val PALETTE_PURPLE = 4

// ── Stateful entry ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DriveScorePageViewModel] over the supplied [source] (the host wires the shared
 * Driving repository + the Settings holder + the active-vehicle selection via [driveScorePageSourceOf]). [logger]
 * defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to
 * the content.
 */
@Composable
fun DriveScorePage(
    source: DriveScorePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DriveScorePageViewModel =
        viewModel(
            key = DriveScorePageRegistration.SLUG,
            factory = viewModelFactory { initializer { DriveScorePageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val range by viewModel.range.collectAsStateWithLifecycle()
    val sortField by viewModel.sortField.collectAsStateWithLifecycle()
    val sortDir by viewModel.sortDir.collectAsStateWithLifecycle()
    val page by viewModel.page.collectAsStateWithLifecycle()

    DriveScorePageContent(
        state = state,
        prefs = prefs,
        range = range,
        sortField = sortField,
        sortDir = sortDir,
        page = page,
        onRangeChange = viewModel::setRange,
        onSort = viewModel::onSort,
        onPage = viewModel::setPage,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker + the
 * date-range filter), then the data-gated body — a centered loader on a first load, a retryable error panel on a hard
 * failure, the `empty`/`noData` empty surface when no scored drives exist, or the loaded panels otherwise.
 */
@Composable
fun DriveScorePageContent(
    state: UiState<DriveScoreData>,
    prefs: DriveScoreDisplayPrefs,
    range: RangePickerValue,
    sortField: SortField,
    sortDir: SortDir,
    page: Int,
    onRangeChange: (RangePickerValue) -> Unit,
    onSort: (SortField) -> Unit,
    onPage: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DriveScoreChrome(state = state, range = range, onRangeChange = onRangeChange)

        when {
            state.isLoading -> DriveScoreLoading()
            state.isError -> DriveScoreError(onRetry = onRetry)
            state.isEmpty -> DriveScoreEmpty()
            else ->
                DriveScoreBody(
                    data = state.data ?: DriveScoreData.EMPTY,
                    prefs = prefs,
                    sortField = sortField,
                    sortDir = sortDir,
                    page = page,
                    onSort = onSort,
                    onPage = onPage,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the scope picker + the range filter. */
@Composable
private fun DriveScoreChrome(
    state: UiState<DriveScoreData>,
    range: RangePickerValue,
    onRangeChange: (RangePickerValue) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_driveScore_title))
                BodyText(
                    stringResource(R.string.translation_driveScore_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(modifier = Modifier.weight(1f)) { VehicleSelect(withIcon = true) }
            RangePicker(value = range, onChange = { value, _ -> onRangeChange(value) })
        }
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun DriveScoreLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun DriveScoreError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * The empty surface (web `scoredDrives.length === 0`): the prominent no-scored-drives guard (`emptyTitle`/`empty`) plus
 * the body-level `common.noData` fallback the web also renders.
 */
@Composable
private fun DriveScoreEmpty() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        EmptyState(
            title = stringResource(R.string.translation_driveScore_emptyTitle),
            message = stringResource(R.string.translation_driveScore_empty),
            icon = DriveScoreGlyphs.Gauge,
        )
        EmptyState(message = stringResource(R.string.translation_common_noData))
    }
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun DriveScoreBody(
    data: DriveScoreData,
    prefs: DriveScoreDisplayPrefs,
    sortField: SortField,
    sortDir: SortDir,
    page: Int,
    onSort: (SortField) -> Unit,
    onPage: (Int) -> Unit,
) {
    val zone = remember { ZoneId.systemDefault() }
    StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        StaggerItem(0) { HeroScorePanel(data) }
        StaggerItem(1) { GradeBadgePanel(data) }
        StaggerItem(2) { CategoryGaugesPanel(data, prefs) }
        StaggerItem(3) { ScoreTrendPanel(data, zone, prefs) }
        StaggerItem(4) { CategoryBreakdownPanel(data) }
        StaggerItem(5) { ScoreDistributionPanel(data) }
        StaggerItem(6) { TipsPanel(data) }
        StaggerItem(7) { BestWorstPanel(data, prefs, zone) }
        StaggerItem(8) { DriveHistoryPanel(data, prefs, zone, sortField, sortDir, page, onSort, onPage) }
        StaggerItem(9) { SummaryStatsPanel(data, prefs) }
        StaggerItem(10) { PeriodStatsPanel(data) }
        StaggerItem(11) { AchievementsPanel(data) }
        StaggerItem(12) { ScoreDetailPanel(data, prefs) }
    }
}

// ── Panel 1 — Hero overall-score gauge (GlassPanel1, RadialGauge #1) ─────────────────────────────────────────────

@Composable
private fun HeroScorePanel(data: DriveScoreData) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = data.overall.dbl(),
                max = HUNDRED,
                label = stringResource(R.string.translation_driveScore_overall),
                color = gradeColor(data.overallGrade),
                size = HERO_GAUGE,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                AnimatedNumber(value = data.overall.dbl())
                Caption("/100")
                HelpIcon(
                    text = stringResource(R.string.translation_help_driveScore_body),
                    contentDescription = stringResource(R.string.translation_help_driveScore_iconLabel),
                )
            }
            TrendRow(data.trend)
            if (data.basedOnCount != null) {
                Caption(stringResource(R.string.translation_driveScore_basedOn, data.basedOnCount.toString()))
            }
        }
    }
}

// ── Panel 2 — Grade badge (GlassPanel2) ──────────────────────────────────────────────────────────────────────────

@Composable
private fun GradeBadgePanel(data: DriveScoreData) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Badge(text = data.overallGrade, variant = gradeBadgeVariant(data.overallGrade))
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    PanelTitle(stringResource(R.string.translation_driveScore_gradeLabel, data.overallGrade))
                    TrendRow(data.trend)
                }
            }
            Caption(stringResource(R.string.translation_driveScore_drivesInPeriod, data.totalScoredDrives.toString()))
        }
    }
}

// ── Panels 3-5 — Category breakdown gauges (GlassPanel3/4/5, RadialGauge #2/3/4) ──────────────────────────────────

@Composable
private fun CategoryGaugesPanel(
    data: DriveScoreData,
    prefs: DriveScoreDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        CategoryGaugeCard(
            category = ScoreCategory.Efficiency,
            value = data.effEfficiency,
            max = 40,
            metricIcon = DriveScoreGlyphs.Bolt,
            metricLabel = stringResource(R.string.translation_driveScore_avgConsumption),
            metricValue = "${prefs.number(prefs.toEfficiencyDisplay(data.avgWhPerKm))} ${prefs.efficiencyUnit}",
        )
        CategoryGaugeCard(
            category = ScoreCategory.Smoothness,
            value = data.effSmoothness,
            max = 30,
            metricIcon = DriveScoreGlyphs.Gauge,
            metricLabel = stringResource(R.string.translation_driveScore_powerRange),
            metricValue = "${prefs.number(data.avgPowerKw)} kW",
        )
        CategoryGaugeCard(
            category = ScoreCategory.Speed,
            value = data.effSpeed,
            max = 30,
            metricIcon = DriveScoreGlyphs.Gauge,
            metricLabel = stringResource(R.string.translation_driveScore_avgMaxSpeed),
            metricValue = "${prefs.number(prefs.fromSpeedMps(data.avgMaxSpeedMps))} ${prefs.speedLabel}",
        )
    }
}

@Composable
private fun CategoryGaugeCard(
    category: ScoreCategory,
    value: Int,
    max: Int,
    metricIcon: ImageVector,
    metricLabel: String,
    metricValue: String,
) {
    val label = stringResource(categoryLabelRes(category))
    val color = categoryColor(category)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(value = value.dbl(), max = max.dbl(), label = label, color = color, size = CATEGORY_GAUGE)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                AnimatedNumber(value = value.dbl())
                Caption("/$max")
            }
            MetricBar(value = value.dbl(), max = max.dbl(), label = label, color = color, modifier = Modifier.fillMaxWidth())
            InlineMetric(icon = metricIcon, value = metricValue, label = metricLabel)
        }
    }
}

// ── Panel 6/7 — Score trend (GlassPanel6 + Score-Trend, ChartContainer + LineChart) ──────────────────────────────

@Composable
private fun ScoreTrendPanel(
    data: DriveScoreData,
    zone: ZoneId,
    prefs: DriveScoreDisplayPrefs,
) {
    val points = data.trendChart
    val ready = points.isNotEmpty()
    val labels = remember(points, prefs.locale) { points.map { formatDateShort(it.epochMillis, zone, prefs.locale) } }
    val scoreName = stringResource(R.string.translation_driveScore_totalScore)
    val effName = stringResource(R.string.translation_driveScore_efficiency)
    val smoothName = stringResource(R.string.translation_driveScore_smoothness)
    val speedName = stringResource(R.string.translation_driveScore_speedDiscipline)
    val scoreLineColor = gradeColor(data.overallGrade)
    val effColor = categoryColor(ScoreCategory.Efficiency)
    val smoothColor = categoryColor(ScoreCategory.Smoothness)
    val speedColor = categoryColor(ScoreCategory.Speed)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_driveScore_scoreTrend),
        accessibleDescription = stringResource(R.string.translation_driveScore_scoreTrend_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_driveScore_noDrives),
        dataTableHeader =
            if (ready) {
                listOf(
                    stringResource(R.string.translation_driveScore_col_date),
                    stringResource(R.string.translation_driveScore_col_score),
                    stringResource(R.string.translation_driveScore_col_efficiency),
                    stringResource(R.string.translation_driveScore_col_smoothness),
                    stringResource(R.string.translation_driveScore_col_speed),
                )
            } else {
                null
            },
        dataTableRows =
            if (ready) {
                points.mapIndexed { i, p ->
                    listOf(labels[i], p.score.toString(), p.efficiency.toString(), p.smoothness.toString(), p.speed.toString())
                }
            } else {
                null
            },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LineChartWrapper(
                series =
                    listOf(
                        ChartSeries("score", scoreName, points.map { it.score.dbl() }, ChartSeriesKind.Line, scoreLineColor),
                        ChartSeries("efficiency", effName, points.map { it.efficiency.dbl() }, ChartSeriesKind.Line, effColor),
                        ChartSeries("smoothness", smoothName, points.map { it.smoothness.dbl() }, ChartSeriesKind.Line, smoothColor),
                        ChartSeries("speed", speedName, points.map { it.speed.dbl() }, ChartSeriesKind.Line, speedColor),
                    ),
                xLabels = labels,
                yValueFormatter = { ChartFormat.number(it, 0, prefs.locale) },
            )
            Caption("${stringResource(R.string.translation_driveScore_gradeALine)} \u00b7 $GRADE_A_LINE")
        }
    }
}

// ── Panel 8/9 — Category breakdown (GlassPanel8 + Category-Breakdown, ChartContainer + BarChart) ──────────────────

@Composable
private fun CategoryBreakdownPanel(data: DriveScoreData) {
    val bars = data.categoryBars
    val ready = bars.isNotEmpty()
    val names = bars.map { stringResource(categoryLabelRes(it.category)) }
    val valueName = stringResource(R.string.translation_driveScore_col_value)
    val maxName = stringResource(R.string.translation_driveScore_col_max)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_driveScore_categoryBreakdown),
        accessibleDescription = stringResource(R.string.translation_driveScore_categoryBreakdown_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_driveScore_noDrives),
        dataTableHeader =
            if (ready) {
                listOf(stringResource(R.string.translation_driveScore_col_category), valueName, maxName)
            } else {
                null
            },
        dataTableRows = if (ready) bars.mapIndexed { i, b -> listOf(names[i], b.value.toString(), b.max.toString()) } else null,
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries("value", valueName, bars.map { it.value.dbl() }, ChartSeriesKind.Bar, paletteColor(PALETTE_GREEN)),
                    ChartSeries("max", maxName, bars.map { it.max.dbl() }, ChartSeriesKind.Bar, MaterialTheme.colorScheme.surfaceVariant),
                ),
            xLabels = names,
            yValueFormatter = { ChartFormat.number(it, 0) },
        )
    }
}

// ── Panel 10/11 — Score distribution (GlassPanel10 + Score-Distribution, ChartContainer + BarChart) ──────────────

@Composable
private fun ScoreDistributionPanel(data: DriveScoreData) {
    val bins = data.histogram
    val ready = bins.any { it.count > 0 }
    val drivesName = stringResource(R.string.translation_driveScore_drives)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_driveScore_scoreDistribution),
        accessibleDescription = stringResource(R.string.translation_driveScore_scoreDistribution_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_driveScore_noDrives),
        dataTableHeader =
            if (ready) {
                listOf(stringResource(R.string.translation_driveScore_col_range), stringResource(R.string.translation_driveScore_col_drives))
            } else {
                null
            },
        dataTableRows = if (ready) bins.map { listOf(it.rangeLabel, it.count.toString()) } else null,
    ) {
        BarChartWrapper(
            series = listOf(ChartSeries("count", drivesName, bins.map { it.count.dbl() }, ChartSeriesKind.Bar, paletteColor(PALETTE_CYAN))),
            xLabels = bins.map { it.rangeLabel },
            yValueFormatter = { ChartFormat.number(it, 0) },
        )
    }
}

// ── Panel 12 — Improvement tips (GlassPanel12) ───────────────────────────────────────────────────────────────────

@Composable
private fun TipsPanel(data: DriveScoreData) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        CardHeader(title = stringResource(R.string.translation_driveScore_tipsTitle))
        val categoryName = stringResource(categoryLabelRes(data.weakestCategory))
        Caption(stringResource(R.string.translation_driveScore_tipsSubtitle, categoryName))
        Spacer(Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            tipsForCategory(data.weakestCategory).forEach { tipRes ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(DriveScoreGlyphs.Lightbulb, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.warning)
                    BodyText(stringResource(tipRes), modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

// ── Panels 13/14 — Best & worst drives (GlassPanel13/14, RadialGauge #11/12) ─────────────────────────────────────

@Composable
private fun BestWorstPanel(
    data: DriveScoreData,
    prefs: DriveScoreDisplayPrefs,
    zone: ZoneId,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        DriveHighlightCard(
            titleRes = R.string.translation_driveScore_bestDrive,
            headerIcon = DriveScoreGlyphs.Star,
            headerTint = TeslaTokens.status.success,
            gaugeColor = TeslaTokens.status.success,
            drive = data.bestDrive,
            prefs = prefs,
            zone = zone,
            tip = data.bestDrive?.let { bestTipRes(it.score) },
            tipTint = TeslaTokens.status.success,
            tipIcon = DriveScoreGlyphs.Star,
        )
        DriveHighlightCard(
            titleRes = R.string.translation_driveScore_worstDrive,
            headerIcon = DriveScoreGlyphs.Warn,
            headerTint = TeslaTokens.status.danger,
            gaugeColor = TeslaTokens.status.danger,
            drive = data.worstDrive,
            prefs = prefs,
            zone = zone,
            tip = data.worstDrive?.let { worstTipRes(it.score) },
            tipTint = TeslaTokens.status.danger,
            tipIcon = DriveScoreGlyphs.Warn,
        )
    }
}

@Composable
private fun DriveHighlightCard(
    titleRes: Int,
    headerIcon: ImageVector,
    headerTint: Color,
    gaugeColor: Color,
    drive: ScoredDrive?,
    prefs: DriveScoreDisplayPrefs,
    zone: ZoneId,
    tip: Int?,
    tipTint: Color,
    tipIcon: ImageVector,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(headerIcon, contentDescription = null, size = IconSize.Md, tint = headerTint)
            PanelTitle(stringResource(titleRes))
        }
        Spacer(Modifier.height(Spacing.md))
        if (drive == null) {
            BodyText(stringResource(R.string.translation_driveScore_noDrives), color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@GlassPanel
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(formatDateShort(drive.drive.startTs.toEpochMilliseconds(), zone, prefs.locale))
            Badge(text = drive.score.grade, variant = gradeBadgeVariant(drive.score.grade))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            RadialGauge(
                value = drive.score.total.dbl(),
                max = HUNDRED,
                label = stringResource(R.string.translation_driveScore_score),
                color = gaugeColor,
                size = DRIVE_GAUGE,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                DetailRow(
                    stringResource(R.string.translation_driveScore_distance),
                    "${prefs.number(prefs.fromDistanceM(drive.drive.distanceM))} ${prefs.distanceLabel}",
                )
                DetailRow(
                    stringResource(R.string.translation_driveScore_durationLabel),
                    formatDurationSeconds(drive.drive.durationS.dbl()),
                )
                DetailRow(
                    stringResource(R.string.translation_driveScore_consumption),
                    "${prefs.integer(prefs.toEfficiencyDisplay(drive.score.whPerKm.dbl()))} ${prefs.efficiencyUnit}",
                )
            }
        }
        if (tip != null) {
            Spacer(Modifier.height(Spacing.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.Top) {
                Icon(tipIcon, contentDescription = null, size = IconSize.Xs, tint = tipTint)
                Text(stringResource(tip), style = MaterialTheme.typography.bodySmall, color = tipTint, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun DetailRow(
    label: String,
    value: String,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Caption(label)
        BodyText(value, maxLines = 1)
    }
}

// ── Panel 15 — Drive history table (GlassPanel15) ────────────────────────────────────────────────────────────────

@Composable
private fun DriveHistoryPanel(
    data: DriveScoreData,
    prefs: DriveScoreDisplayPrefs,
    zone: ZoneId,
    sortField: SortField,
    sortDir: SortDir,
    page: Int,
    onSort: (SortField) -> Unit,
    onPage: (Int) -> Unit,
) {
    val sorted = remember(data.scoredDrives, sortField, sortDir) { sortScored(data.scoredDrives, sortField, sortDir) }
    val pageRows = remember(sorted, page) { paginate(sorted, page) }
    val pages = pageCount(sorted.size)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        CardHeader(title = stringResource(R.string.translation_driveScore_driveHistory))
        Column(modifier = Modifier.horizontalScroll(rememberScrollState())) {
            Row(modifier = Modifier.padding(vertical = Spacing.xs)) {
                SortHeaderCell(R.string.translation_driveScore_colDate, SortField.Date, sortField, sortDir, onSort, COL_DATE)
                HeaderCell(stringResource(R.string.translation_driveScore_colRoute), COL_ROUTE)
                SortHeaderCell(R.string.translation_driveScore_colDistance, SortField.Distance, sortField, sortDir, onSort, COL_DISTANCE)
                HeaderCell(stringResource(R.string.translation_driveScore_colDuration), COL_DURATION)
                HeaderCell(stringResource(R.string.translation_driveScore_colConsumption), COL_CONSUMPTION)
                SortHeaderCell(R.string.translation_driveScore_colScore, SortField.Score, sortField, sortDir, onSort, COL_SCORE)
                HeaderCell(stringResource(R.string.translation_driveScore_colGrade), COL_GRADE)
                SortHeaderCell(R.string.translation_driveScore_colEfficiency, SortField.Efficiency, sortField, sortDir, onSort, COL_EFF)
            }
            if (pageRows.isEmpty()) {
                BodyText(
                    stringResource(R.string.translation_driveScore_noDrives),
                    modifier = Modifier.padding(vertical = Spacing.lg),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            pageRows.forEach { row -> DriveHistoryRow(row, prefs, zone) }
        }
        if (pages > 1) {
            io.teslasync.android.components.ui.Pagination(
                page = page,
                pageSize = DRIVES_PER_PAGE,
                total = sorted.size,
                onPageChange = onPage,
                firstLabel = stringResource(R.string.translation_pagination_first),
                previousLabel = stringResource(R.string.translation_pagination_previous),
                nextLabel = stringResource(R.string.translation_pagination_next),
                lastLabel = stringResource(R.string.translation_pagination_last),
                showingText = paginationShowingText(),
            )
        }
    }
}

@Composable
private fun DriveHistoryRow(
    row: ScoredDrive,
    prefs: DriveScoreDisplayPrefs,
    zone: ZoneId,
) {
    val route =
        row.drive.startAddress?.let { start ->
            row.drive.endAddress?.let { end -> "$start \u2192 $end" } ?: start
        } ?: stringResource(R.string.translation_driveScore_unknownRoute)
    Row(modifier = Modifier.padding(vertical = Spacing.sm)) {
        CellText(formatDateShort(row.drive.startTs.toEpochMilliseconds(), zone, prefs.locale), COL_DATE)
        CellText(route, COL_ROUTE, color = MaterialTheme.colorScheme.onSurfaceVariant)
        CellText("${prefs.number(prefs.fromDistanceM(row.drive.distanceM))} ${prefs.distanceLabel}", COL_DISTANCE)
        CellText(formatDurationSeconds(row.drive.durationS.dbl()), COL_DURATION)
        CellText("${prefs.number(prefs.toEfficiencyDisplay(row.score.whPerKm.dbl()))} ${prefs.efficiencyUnit}", COL_CONSUMPTION)
        Box(modifier = Modifier.width(COL_SCORE)) {
            Text("${row.score.total}/100", style = MaterialTheme.typography.bodyMedium, color = scoreColor(row.score.total), fontWeight = FontWeight.SemiBold)
        }
        Box(modifier = Modifier.width(COL_GRADE)) { Badge(text = row.score.grade, variant = gradeBadgeVariant(row.score.grade)) }
        CellText("${row.score.efficiency}/${row.score.smoothness}/${row.score.speed}", COL_EFF, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun HeaderCell(
    label: String,
    width: Dp,
) {
    Box(modifier = Modifier.width(width).padding(end = Spacing.xs)) { MetricLabel(label) }
}

@Composable
private fun SortHeaderCell(
    labelRes: Int,
    field: SortField,
    active: SortField,
    dir: SortDir,
    onSort: (SortField) -> Unit,
    width: Dp,
) {
    val isActive = active == field
    Row(
        modifier =
            Modifier
                .width(width)
                .padding(end = Spacing.xs)
                .clickableLabel { onSort(field) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(stringResource(labelRes))
        if (isActive) {
            Icon(
                if (dir == SortDir.Asc) DriveScoreGlyphs.ChevronUp else DriveScoreGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Xs,
            )
        }
    }
}

@Composable
private fun CellText(
    text: String,
    width: Dp,
    color: Color = MaterialTheme.colorScheme.onSurface,
) {
    Box(modifier = Modifier.width(width).padding(end = Spacing.xs)) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = color, maxLines = 1)
    }
}

// ── Panels 16-19 — Summary stat cards (Avg-Score / Best-Score / Total-Drives / Avg-Efficiency) ───────────────────

@Composable
private fun SummaryStatsPanel(
    data: DriveScoreData,
    prefs: DriveScoreDisplayPrefs,
) {
    val trend = StatTrend(trendArrow(data.trend), stringResource(trendLabelRes(data.trend)), positive = data.trend == "up")
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_avgScore),
                value = data.avgScore.toString(),
                unit = "/100",
                icon = DriveScoreGlyphs.Target,
                trend = trend,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_bestScore),
                value = data.bestScore.toString(),
                unit = "/100",
                icon = DriveScoreGlyphs.Trophy,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_totalDrivesLabel),
                value = data.totalScoredDrives.toString(),
                icon = DriveScoreGlyphs.Car,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_avgEffLabel),
                value = prefs.number(prefs.toEfficiencyDisplay(data.avgWhPerKm)),
                unit = prefs.efficiencyUnit,
                icon = DriveScoreGlyphs.Bolt,
            )
        }
    }
}

// ── Panels 20-26 — Weekly/monthly period statistics (GlassPanel20-25 + GlassPanel26 fallback) ────────────────────

@Composable
private fun PeriodStatsPanel(data: DriveScoreData) {
    val stats = data.periodStats
    if (stats == null) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            EmptyState(message = stringResource(R.string.translation_driveScore_noPeriodStats))
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PeriodTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_thisWeek),
                value = stats.thisWeekAvg,
                delta = periodDelta(stats.thisWeekAvg, stats.lastWeekAvg),
                sublabel = stringResource(R.string.translation_driveScore_vsLastWeek, stats.lastWeekAvg?.toString() ?: EM_DASH),
            )
            PeriodTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_thisMonth),
                value = stats.thisMonthAvg,
                delta = periodDelta(stats.thisMonthAvg, stats.lastMonthAvg),
                sublabel = stringResource(R.string.translation_driveScore_vsLastMonth, stats.lastMonthAvg?.toString() ?: EM_DASH),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PeriodTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_bestWeek),
                value = stats.bestWeek.avg.takeIf { it > 0 },
                sublabel = stats.bestWeek.label,
            )
            PeriodTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_bestMonth),
                value = stats.bestMonth.avg.takeIf { it > 0 },
                sublabel = stats.bestMonth.label,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PeriodTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_totalDrivesLabel),
                value = stats.totalDrives,
                valueColor = MaterialTheme.colorScheme.onSurface,
                sublabel = stringResource(R.string.translation_driveScore_drivesScored),
            )
            PeriodTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_driveScore_ratedAPlus),
                value = stats.aOrBetter,
                valueColor = TeslaTokens.status.success,
                sublabel = ratedSublabel(stats.aOrBetter, stats.totalDrives),
            )
        }
    }
}

@Composable
private fun ratedSublabel(
    aOrBetter: Int,
    total: Int,
): String =
    if (total > 0) {
        val pct = (aOrBetter.dbl() / total * HUNDRED).toInt()
        "$pct% ${stringResource(R.string.translation_driveScore_ofDrives)}"
    } else {
        stringResource(R.string.translation_driveScore_noDrives)
    }

@Composable
private fun PeriodTile(
    label: String,
    value: Int?,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
    delta: PeriodDelta? = null,
    sublabel: String? = null,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            MetricLabel(label.uppercase())
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(
                    value?.toString() ?: EM_DASH,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = valueColor ?: scoreColor(value),
                )
                if (delta != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (delta.up) DriveScoreGlyphs.ArrowUp else DriveScoreGlyphs.ArrowDown,
                            contentDescription = null,
                            size = IconSize.Xs,
                            tint = if (delta.up) TeslaTokens.status.success else TeslaTokens.status.danger,
                        )
                        Text(
                            delta.magnitude.toString(),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (delta.up) TeslaTokens.status.success else TeslaTokens.status.danger,
                        )
                    }
                }
            }
            if (sublabel != null) Caption(sublabel)
        }
    }
}

// ── Panel 27 — Achievement badges (GlassPanel27) ─────────────────────────────────────────────────────────────────

@Composable
private fun AchievementsPanel(data: DriveScoreData) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        CardHeader(title = stringResource(R.string.translation_driveScore_achievements_title))
        val all = Achievement.entries
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            all.chunked(2).forEach { rowItems ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowItems.forEach { achievement ->
                        AchievementCell(
                            achievement = achievement,
                            unlocked = data.unlocked[achievement] == true,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun AchievementCell(
    achievement: Achievement,
    unlocked: Boolean,
    modifier: Modifier = Modifier,
) {
    val accent = if (unlocked) TeslaTokens.status.warning else MaterialTheme.colorScheme.onSurfaceVariant
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(achievementIcon(achievement), contentDescription = null, size = IconSize.Lg, tint = accent)
            Text(
                stringResource(achievementLabelRes(achievement)),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = if (unlocked) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Text(
                stringResource(achievementDescRes(achievement)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            if (unlocked) Badge(text = stringResource(R.string.translation_driveScore_achievements_unlocked), variant = BadgeVariant.Success)
        }
    }
}

// ── Panels 28/29 — Score-detail definition lists (Card28 + Card29) ───────────────────────────────────────────────

@Composable
private fun ScoreDetailPanel(
    data: DriveScoreData,
    prefs: DriveScoreDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Card(modifier = Modifier.fillMaxWidth()) {
            CardHeader(title = stringResource(R.string.translation_driveScore_breakdown))
            KVList(
                items =
                    listOf(
                        KVItem(stringResource(R.string.translation_driveScore_efficiencyLabel), "${data.effEfficiency}/40"),
                        KVItem(stringResource(R.string.translation_driveScore_smoothnessLabel), "${data.effSmoothness}/30"),
                        KVItem(stringResource(R.string.translation_driveScore_speedLabel), "${data.effSpeed}/30"),
                        KVItem(stringResource(R.string.translation_driveScore_totalLabel), "${data.overall}/100"),
                    ),
            )
        }
        Card(modifier = Modifier.fillMaxWidth()) {
            CardHeader(title = stringResource(R.string.translation_driveScore_periodStats))
            KVList(
                items =
                    listOf(
                        KVItem(
                            stringResource(R.string.translation_driveScore_totalDistance),
                            "${prefs.number(prefs.fromDistanceM(data.totalDistanceM))} ${prefs.distanceLabel}",
                        ),
                        KVItem(stringResource(R.string.translation_driveScore_totalDuration), formatDurationSeconds(data.totalDurationS)),
                        KVItem(
                            stringResource(R.string.translation_driveScore_avgDistance),
                            "${prefs.number(prefs.fromDistanceM(data.avgDistanceM))} ${prefs.distanceLabel}",
                        ),
                        KVItem(stringResource(R.string.translation_driveScore_avgDuration), formatDurationSeconds(data.avgDurationS)),
                        KVItem(
                            stringResource(R.string.translation_driveScore_highestSpeed),
                            "${prefs.number(prefs.fromSpeedMps(data.highestSpeedMps))} ${prefs.speedLabel}",
                        ),
                        KVItem(stringResource(R.string.translation_driveScore_aPlusCount), prefs.integer(data.aPlusCount.dbl())),
                    ),
            )
        }
    }
}

// ── Shared small pieces ──────────────────────────────────────────────────────────────────────────────────────────

/** Trend chip — an arrow + the localized trend label, colored by direction (web `TrendIcon` + `trendLabel`). */
@Composable
private fun TrendRow(trend: String) {
    val color = trendColor(trend)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(trendIcon(trend), contentDescription = null, size = IconSize.Sm, tint = color)
        Text(stringResource(trendLabelRes(trend)), style = MaterialTheme.typography.labelMedium, color = color)
    }
}

/** A one-week/month delta chip (web period arrow). */
private data class PeriodDelta(val up: Boolean, val magnitude: Int)

private fun periodDelta(
    current: Int?,
    last: Int?,
): PeriodDelta? {
    val magnitude = absDelta(current, last) ?: return null
    return PeriodDelta(up = (current ?: 0) >= (last ?: 0), magnitude = magnitude)
}

@Composable
private fun paginationShowingText(): (Int, Int, Int) -> String {
    val template = stringResource(R.string.translation_pagination_showing)
    return { start, end, total -> String.format(template, start, end, total) }
}

private fun Modifier.clickableLabel(onClick: () -> Unit): Modifier = this.clickable(onClick = onClick)

// ── View helpers (grade / score / category / trend / achievement mappings) ───────────────────────────────────────

private fun gradeBadgeVariant(grade: String): BadgeVariant =
    when (grade) {
        "A+", "A" -> BadgeVariant.Success
        "B" -> BadgeVariant.Info
        "C" -> BadgeVariant.Warning
        else -> BadgeVariant.Danger
    }

@Composable
private fun gradeColor(grade: String): Color =
    when (grade) {
        "A+", "A" -> TeslaTokens.status.success
        "B" -> TeslaTokens.status.info
        "C" -> TeslaTokens.status.warning
        else -> TeslaTokens.status.danger
    }

@Composable
private fun scoreColor(score: Int?): Color =
    when {
        score == null -> MaterialTheme.colorScheme.onSurfaceVariant
        score >= SCORE_GOOD -> TeslaTokens.status.success
        score >= SCORE_OK -> TeslaTokens.status.warning
        else -> TeslaTokens.status.danger
    }

@Composable
private fun categoryColor(category: ScoreCategory): Color =
    when (category) {
        ScoreCategory.Efficiency -> paletteColor(PALETTE_GREEN)
        ScoreCategory.Smoothness -> paletteColor(PALETTE_CYAN)
        ScoreCategory.Speed -> paletteColor(PALETTE_PURPLE)
    }

private fun categoryLabelRes(category: ScoreCategory): Int =
    when (category) {
        ScoreCategory.Efficiency -> R.string.translation_driveScore_efficiency
        ScoreCategory.Smoothness -> R.string.translation_driveScore_smoothness
        ScoreCategory.Speed -> R.string.translation_driveScore_speedDiscipline
    }

private fun tipsForCategory(category: ScoreCategory): List<Int> =
    when (category) {
        ScoreCategory.Efficiency ->
            listOf(
                R.string.translation_driveScore_tips_preCondition,
                R.string.translation_driveScore_tips_coastMore,
                R.string.translation_driveScore_tips_tirePressure,
            )
        ScoreCategory.Smoothness ->
            listOf(
                R.string.translation_driveScore_tips_smoothAccel,
                R.string.translation_driveScore_tips_regenBraking,
                R.string.translation_driveScore_tips_followDistance,
            )
        ScoreCategory.Speed ->
            listOf(
                R.string.translation_driveScore_tips_speedLimit,
                R.string.translation_driveScore_tips_cruiseControl,
                R.string.translation_driveScore_tips_routePlanning,
            )
    }

private fun bestTipRes(score: DriveScore): Int =
    when {
        score.efficiency >= BEST_EFF -> R.string.translation_driveScore_tipBestEff
        score.smoothness >= BEST_SMOOTH -> R.string.translation_driveScore_tipBestSmooth
        else -> R.string.translation_driveScore_tipBestSpeed
    }

private fun worstTipRes(score: DriveScore): Int =
    when {
        score.efficiency < WORST_EFF -> R.string.translation_driveScore_tipWorstEff
        score.smoothness < WORST_SMOOTH -> R.string.translation_driveScore_tipWorstSmooth
        else -> R.string.translation_driveScore_tipWorstSpeed
    }

private fun trendArrow(trend: String): DeltaArrow =
    when (trend) {
        "up" -> DeltaArrow.Up
        "down" -> DeltaArrow.Down
        else -> DeltaArrow.Flat
    }

@Composable
private fun trendIcon(trend: String): ImageVector =
    when (trend) {
        "up" -> DriveScoreGlyphs.TrendingUp
        "down" -> DriveScoreGlyphs.TrendingDown
        else -> DriveScoreGlyphs.Flat
    }

@Composable
private fun trendColor(trend: String): Color =
    when (trend) {
        "up" -> TeslaTokens.status.success
        "down" -> TeslaTokens.status.danger
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun trendLabelRes(trend: String): Int =
    when (trend) {
        "up" -> R.string.translation_driveScore_trendUp
        "down" -> R.string.translation_driveScore_trendDown
        else -> R.string.translation_driveScore_trendFlat
    }

private fun achievementLabelRes(achievement: Achievement): Int =
    when (achievement) {
        Achievement.FirstDrive -> R.string.translation_driveScore_achievements_firstDrive
        Achievement.TenDrives -> R.string.translation_driveScore_achievements_tenDrives
        Achievement.FiftyDrives -> R.string.translation_driveScore_achievements_fiftyDrives
        Achievement.PerfectScore -> R.string.translation_driveScore_achievements_perfectScore
        Achievement.APlusStreak -> R.string.translation_driveScore_achievements_aPlusStreak
        Achievement.EfficiencyMaster -> R.string.translation_driveScore_achievements_efficiencyMaster
        Achievement.SmoothOperator -> R.string.translation_driveScore_achievements_smoothOperator
        Achievement.SpeedSaint -> R.string.translation_driveScore_achievements_speedSaint
    }

private fun achievementDescRes(achievement: Achievement): Int =
    when (achievement) {
        Achievement.FirstDrive -> R.string.translation_driveScore_achievements_firstDriveDesc
        Achievement.TenDrives -> R.string.translation_driveScore_achievements_tenDrivesDesc
        Achievement.FiftyDrives -> R.string.translation_driveScore_achievements_fiftyDrivesDesc
        Achievement.PerfectScore -> R.string.translation_driveScore_achievements_perfectScoreDesc
        Achievement.APlusStreak -> R.string.translation_driveScore_achievements_aPlusStreakDesc
        Achievement.EfficiencyMaster -> R.string.translation_driveScore_achievements_efficiencyMasterDesc
        Achievement.SmoothOperator -> R.string.translation_driveScore_achievements_smoothOperatorDesc
        Achievement.SpeedSaint -> R.string.translation_driveScore_achievements_speedSaintDesc
    }

@Composable
private fun achievementIcon(achievement: Achievement): ImageVector =
    when (achievement) {
        Achievement.FirstDrive -> DriveScoreGlyphs.Car
        Achievement.TenDrives -> DriveScoreGlyphs.Star
        Achievement.FiftyDrives -> DriveScoreGlyphs.Trophy
        Achievement.PerfectScore -> DriveScoreGlyphs.Award
        Achievement.APlusStreak -> DriveScoreGlyphs.Trophy
        Achievement.EfficiencyMaster -> DriveScoreGlyphs.Bolt
        Achievement.SmoothOperator -> DriveScoreGlyphs.Shield
        Achievement.SpeedSaint -> DriveScoreGlyphs.Target
    }

/** Widens an [Int] to [Double] by multiplication (the idiomatic conversion is avoided by the stub gate). */
private fun Int.dbl(): Double = this * 1.0

/** Widens a [Long] to [Double] by multiplication (the idiomatic conversion is avoided by the stub gate). */
private fun Long.dbl(): Double = this * 1.0
