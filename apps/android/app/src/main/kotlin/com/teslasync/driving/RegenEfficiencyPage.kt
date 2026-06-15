// The native Jetpack Compose + Material 3 RegenEfficiencyPage driving surface — a parity port of
// web/src/features/driving/pages/RegenEfficiencyPage.tsx, the regenerative-braking energy-recovery dashboard. It
// reproduces the page's ten panels (the hero regen-ratio gauge with its recovered-energy caption, the six overview
// stat cards, the monthly-regen-trend composed chart, the four-bar regen-metrics strip, and the recent-regen-drives
// table), all three charts (RadialGauge + ChartContainer + the composed line/bar chart), every data state (loading
// skeleton / empty / error-retry / content, plus the cache-then-network stale/offline tier the bound state holders
// carry), and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [RegenEfficiencyPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the regen-analytics feed + the drives feed + the range + the
// live display preferences); [RegenEfficiencyPageContent] is the stateless render layer. The backend `useRegenEfficiency`
// envelope powers the gauge/cards/bars; the `useDrives` feed is narrowed to the picked window and folded by the
// framework-free model (monthlyTrend / recentRegenDrives) into the trend chart + the table — exactly as the web page
// threads its loaded data through the useMemo chain. SI values are converted to the user's units only here at the
// display boundary via the model's [RegenDisplayPrefs] helpers (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)

package io.teslasync.android.driving.regenefficiency

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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpTooltip
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate
import java.time.ZoneId

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The trend chart height (web `ChartContainer height={260}`). */
private val TREND_CHART_HEIGHT = 260.dp

/** The hero gauge diameter (web `RadialGauge size={160}`). */
private val GAUGE_SIZE = 160.dp

/** Stat cards per row in the overview grid (web `lg:grid-cols-6`, narrowed to 3 on a phone). */
private const val STAT_CARDS_PER_ROW = 3

/** Min denominator for the "total regen" metric bar so an all-zero state never has a full bar (web `Math.max(…)`). */
private const val TOTAL_REGEN_BAR_MAX = 100_000.0

/** Min denominator for the "monthly avg" metric bar (web `Math.max(monthlyAvgRegen, 50)`). */
private const val MONTHLY_AVG_BAR_MAX = 50.0

/** Min denominator for the "free charges" metric bar (web `Math.max(freeCharges, 10)`). */
private const val FREE_CHARGES_BAR_MAX = 10.0

/** The hero gauge max + the regen-ratio bar max — a whole percentage (web `max={100}`). */
private const val PERCENT_MAX = 100.0

/** The em dash shown for the always-null lifetime figures (web `lifetimeRegenKwh != null ? … : '—'`). */
private const val EM_DASH = "\u2014"

// The web's data-viz accent hexes (dynamic chart / semantic values, not static theme tokens — the sibling
// DrivesListPage `TREND_COLORS` precedent). Used for the gauge sweep, the metric-bar fills, the stat-card glyph
// tints, and the per-drive ratio coloring.
private val REGEN_GREEN = Color(0xFF10B981)
private val REGEN_CYAN = Color(0xFF00F0FF)
private val REGEN_AMBER = Color(0xFFF59E0B)
private val REGEN_PURPLE = Color(0xFFA855F7)
private val REGEN_EMERALD = Color(0xFF34D399)
private val REGEN_ORANGE = Color(0xFFFB923C)
private val REGEN_RED = Color(0xFFEF4444)

/** Maps a regen ratio (0–100, higher is better) to its semantic color — the verbatim web `regenColor`. */
private fun regenColor(ratio: Double): Color =
    when {
        ratio >= 25.0 -> REGEN_GREEN
        ratio >= 15.0 -> REGEN_CYAN
        ratio >= 8.0 -> REGEN_AMBER
        else -> REGEN_RED
    }

/** The page's interaction callbacks, wired to the [RegenEfficiencyPageViewModel] (web event handlers). */
data class RegenEfficiencyActions(
    val onSetRange: (LocalDate, LocalDate) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [RegenEfficiencyPageViewModel] over the supplied [source] (the host wires the shared
 * driving repository + settings holder + the app-scoped active-vehicle selection via [regenEfficiencyPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun RegenEfficiencyPage(
    source: RegenEfficiencyPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: RegenEfficiencyPageViewModel =
        viewModel(
            key = RegenEfficiencyPageRegistration.SLUG,
            factory = viewModelFactory { initializer { RegenEfficiencyPageViewModel(source, logger) } },
        )
    RegenEfficiencyPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] regen feed + drives feed + range + display prefs to the content. */
@Composable
fun RegenEfficiencyPage(
    viewModel: RegenEfficiencyPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val regenState by viewModel.regenState.collectAsStateWithLifecycle()
    val drivesState by viewModel.drivesState.collectAsStateWithLifecycle()
    val range by viewModel.range.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            RegenEfficiencyActions(
                onSetRange = viewModel::setRange,
                onRetry = viewModel::retry,
            )
        }

    RegenEfficiencyPageContent(
        regenState = regenState,
        drivesState = drivesState,
        range = range,
        prefs = prefs,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading regen feed (with nothing cached) renders the full-page skeleton; otherwise
 * the page header is drawn, then the hard-error retry surface, the no-data empty surface, or the loaded body (which
 * itself renders the trend-chart + recent-drives empty states inline — so no region ever blanks).
 */
@Composable
fun RegenEfficiencyPageContent(
    regenState: UiState<RegenEfficiencyAnalytics>,
    drivesState: UiState<List<Drive>>,
    range: RegenRange,
    prefs: RegenDisplayPrefs,
    actions: RegenEfficiencyActions,
    modifier: Modifier = Modifier,
) {
    if (regenState.isLoading) {
        RegenLoading(modifier)
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        RegenHeader(regenState = regenState, range = range, onSetRange = actions.onSetRange)

        val analytics = regenState.data
        when {
            regenState.isError -> RegenError(onRetry = actions.onRetry)
            analytics == null || !analytics.present -> RegenEmpty()
            else ->
                RegenLoaded(
                    analytics = analytics,
                    drives = drivesState.data.orEmpty(),
                    range = range,
                    prefs = prefs,
                )
        }
    }
}

/** The full-page loading skeleton shown before the first regen payload (web `PageContainer loading`). */
@Composable
private fun RegenLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        ChartBlockSkeleton(height = GAUGE_SIZE)
        StatGridSkeleton(count = STAT_CARDS_PER_ROW)
        StatGridSkeleton(count = STAT_CARDS_PER_ROW)
        ChartBlockSkeleton(height = TREND_CHART_HEIGHT)
        StatGridSkeleton(count = 2)
        ChartBlockSkeleton()
    }
}

/** The page header — the title + muted subtitle + query-freshness chip + the date-range filter (web `PageContainer`). */
@Composable
private fun RegenHeader(
    regenState: UiState<RegenEfficiencyAnalytics>,
    range: RegenRange,
    onSetRange: (LocalDate, LocalDate) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_regen_title))
                BodyText(
                    stringResource(R.string.translation_regen_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = regenState.fetchedAt?.takeIf { it > 0L },
                isFetching = regenState.refreshing,
                isStale = regenState.stale,
                isError = regenState.hasError,
                compact = true,
            )
        }
        DateRangeFilter(
            startEpochDay = range.start.toEpochDay(),
            endEpochDay = range.end.toEpochDay(),
            onRangeChange = { start, end ->
                onSetRange(
                    start?.let(LocalDate::ofEpochDay) ?: range.start,
                    end?.let(LocalDate::ofEpochDay) ?: range.end,
                )
            },
        )
    }
}

/** The hard-error surface for the regen feed (no cached fallback) — a retry-able error panel (web `error` prop). */
@Composable
private fun RegenError(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_error_serverError_message),
                title = stringResource(R.string.translation_error_serverError_title),
                onRetry = onRetry,
                retryLabel = stringResource(R.string.translation_common_retry),
            )
        }
    }
}

/** The no-data empty surface (web `<EmptyState message={t('regen.noData', …)} />`). */
@Composable
private fun RegenEmpty() {
    FadeIn {
        EmptyState(
            icon = DataDisplayGlyphs.Gauge,
            message = stringResource(R.string.translation_regen_noData),
        )
    }
}

// ── Loaded body ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The loaded surface — the hero gauge panel, the six overview stat cards, the monthly-regen-trend chart, the
 * regen-metrics bar strip, and the recent-regen-drives table. The backend analytics drive the gauge/cards/bars; the
 * drives feed is windowed to the picked [range] and folded by the framework-free model into the trend + table.
 */
@Composable
private fun RegenLoaded(
    analytics: RegenEfficiencyAnalytics,
    drives: List<Drive>,
    range: RegenRange,
    prefs: RegenDisplayPrefs,
) {
    val zone = remember { ZoneId.systemDefault() }
    val windowed = remember(drives, range, zone) { filterDrivesToRange(drives, range, zone) }
    val trend = remember(windowed, prefs) { monthlyTrend(windowed, prefs) }
    val recent = remember(windowed, prefs, zone) { recentRegenDrives(windowed, prefs, zone) }

    FadeIn(delayMs = 0) { RegenHeroPanel(analytics = analytics, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS) { RegenStatCards(analytics = analytics, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 2) { RegenMonthlyTrendPanel(points = trend) }
    FadeIn(delayMs = FADE_STEP_MS * 3) { RegenMetricsPanel(analytics = analytics, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 4) { RegenRecentDrivesPanel(rows = recent) }
}

/** GlassPanel1 — the hero regen-ratio [RadialGauge] + the recovered-energy caption. */
@Composable
private fun RegenHeroPanel(
    analytics: RegenEfficiencyAnalytics,
    prefs: RegenDisplayPrefs,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = Math.round(analytics.regenRatio).toDouble(), // parity:allow numeric widening, not a TODO stub
                max = PERCENT_MAX,
                label = stringResource(R.string.translation_regen_regenRatio),
                unit = "%",
                color = regenColor(analytics.regenRatio),
                size = GAUGE_SIZE,
            )
            Caption(
                stringResource(
                    R.string.translation_regen_recoveredInfo,
                    prefs.energyKwhBare(analytics.totalRegenWh, 1),
                    prefs.number(analytics.freeCharges),
                ),
            )
        }
    }
}

/** GlassPanel2–GlassPanel7 — the six overview stat cards, three per row. */
@Composable
private fun RegenStatCards(
    analytics: RegenEfficiencyAnalytics,
    prefs: RegenDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RegenStatCard(
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Bolt,
                iconTint = REGEN_GREEN,
                label = stringResource(R.string.translation_regen_totalRegen),
            ) { MetricValue(prefs.energy(analytics.totalRegenWh, 1)) }
            RegenStatCard(
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Gauge,
                iconTint = REGEN_CYAN,
                label = stringResource(R.string.translation_regen_ratioLabel),
            ) { MetricValue(prefs.percent(analytics.regenRatio)) }
            RegenStatCard(
                modifier = Modifier.weight(1f),
                icon = FormsGlyphs.Calendar,
                iconTint = REGEN_AMBER,
                label = stringResource(R.string.translation_regen_monthlyAvg),
            ) { MetricValue(prefs.power(analytics.monthlyAvgRegen, 1)) }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RegenStatCard(
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Bolt,
                iconTint = REGEN_PURPLE,
                label = stringResource(R.string.translation_regen_freeCharges),
            ) { AnimatedNumber(value = analytics.freeCharges, decimals = 1, locale = prefs.locale) }
            RegenStatCard(
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Bolt,
                iconTint = REGEN_EMERALD,
                label = stringResource(R.string.translation_regen_lifetimeRegen),
            ) { MetricValue(EM_DASH) }
            RegenStatCard(
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Gauge,
                iconTint = REGEN_ORANGE,
                label = stringResource(R.string.translation_regen_lifetimeDrive),
            ) { MetricValue(EM_DASH) }
        }
    }
}

@Composable
private fun RegenStatCard(
    icon: ImageVector,
    iconTint: Color,
    label: String,
    modifier: Modifier = Modifier,
    value: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Md, tint = iconTint)
            value()
            MetricLabel(label)
        }
    }
}

/** Monthly-Regen-Trend — the composed line (regen kWh) + bar (drives) chart, framed by [ChartContainer]. */
@Composable
private fun RegenMonthlyTrendPanel(points: List<RegenMonthlyPoint>) {
    val months = points.map { it.month }
    val ready = points.size > 1
    ChartContainer(
        title = stringResource(R.string.translation_regen_monthlyTrend),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        height = TREND_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_regen_monthlyTrend_aria),
        emptyMessage = stringResource(R.string.translation_common_noData),
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_regen_col_month),
                stringResource(R.string.translation_regen_col_regenKwh),
                stringResource(R.string.translation_regen_col_drives),
            ),
        dataTableRows = points.map { listOf(it.month, it.regenKwh.toString(), it.drives.toString()) },
    ) {
        ComboChart(
            series =
                listOf(
                    ChartSeries(
                        key = "drives",
                        label = stringResource(R.string.translation_regen_drives),
                        values = points.map { it.drives.toDouble() }, // parity:allow numeric widening, not a TODO stub
                        kind = ChartSeriesKind.Bar,
                        color = REGEN_PURPLE,
                    ),
                    ChartSeries(
                        key = "regenKwh",
                        label = stringResource(R.string.translation_regen_regenKwh),
                        values = points.map { it.regenKwh },
                        kind = ChartSeriesKind.Line,
                        color = REGEN_GREEN,
                    ),
                ),
            xLabels = months,
            height = TREND_CHART_HEIGHT,
        )
    }
}

/** GlassPanel9 — the regen-metrics strip: a help-annotated title + four [MetricBar]s in a 2×2 grid. */
@Composable
private fun RegenMetricsPanel(
    analytics: RegenEfficiencyAnalytics,
    prefs: RegenDisplayPrefs,
) {
    GlassPanel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(DataDisplayGlyphs.Gauge, contentDescription = null, size = IconSize.Md, tint = REGEN_CYAN)
            Spacer(Modifier.width(Spacing.xs))
            HelpTooltip(
                title = stringResource(R.string.translation_regen_metrics),
                helpText = stringResource(R.string.translation_help_regenEfficiency_body),
                helpContentDescription = stringResource(R.string.translation_help_regenEfficiency_iconLabel),
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                MetricBar(
                    modifier = Modifier.weight(1f),
                    value = analytics.totalRegenWh,
                    max = maxOf(analytics.totalRegenWh, TOTAL_REGEN_BAR_MAX),
                    label = stringResource(R.string.translation_regen_totalRegenLabel),
                    valueText = prefs.energy(analytics.totalRegenWh, 1),
                    color = REGEN_GREEN,
                )
                MetricBar(
                    modifier = Modifier.weight(1f),
                    value = analytics.regenRatio,
                    max = PERCENT_MAX,
                    label = stringResource(R.string.translation_regen_regenRatioBar),
                    valueText = prefs.percent(analytics.regenRatio),
                    color = REGEN_CYAN,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                MetricBar(
                    modifier = Modifier.weight(1f),
                    value = analytics.monthlyAvgRegen,
                    max = maxOf(analytics.monthlyAvgRegen, MONTHLY_AVG_BAR_MAX),
                    label = stringResource(R.string.translation_regen_monthlyAvgBar),
                    valueText = prefs.power(analytics.monthlyAvgRegen, 1),
                    color = REGEN_PURPLE,
                )
                MetricBar(
                    modifier = Modifier.weight(1f),
                    value = analytics.freeCharges,
                    max = maxOf(analytics.freeCharges, FREE_CHARGES_BAR_MAX),
                    label = stringResource(R.string.translation_regen_freeChargesBar),
                    valueText = prefs.number(analytics.freeCharges),
                    color = REGEN_AMBER,
                )
            }
        }
    }
}

/** GlassPanel10 — the recent-regen-drives table, or its inline empty state when no drive recovered energy. */
@Composable
private fun RegenRecentDrivesPanel(rows: List<RegenDriveRow>) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(DataDisplayGlyphs.Bolt, contentDescription = null, size = IconSize.Md, tint = REGEN_GREEN)
            Spacer(Modifier.width(Spacing.xs))
            SectionTitle(stringResource(R.string.translation_regen_recentDrives))
        }
        Spacer(Modifier.height(Spacing.sm))
        if (rows.isEmpty()) {
            EmptyState(
                icon = DataDisplayGlyphs.Gauge,
                message = stringResource(R.string.translation_common_noData),
            )
        } else {
            RegenDrivesTableHeader()
            rows.forEach { row -> RegenDrivesTableRow(row) }
        }
    }
}

@Composable
private fun RegenDrivesTableHeader() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(stringResource(R.string.translation_regen_date), modifier = Modifier.weight(1f))
        Caption(stringResource(R.string.translation_regen_distanceCol), modifier = Modifier.weight(1f))
        Caption(stringResource(R.string.translation_regen_maxRegenCol), modifier = Modifier.weight(1f))
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            Caption(stringResource(R.string.translation_regen_ratioCol))
        }
    }
}

@Composable
private fun RegenDrivesTableRow(row: RegenDriveRow) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(
            row.date,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BodyText(row.distance, modifier = Modifier.weight(1f))
        BodyText(row.maxRegen, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.primary)
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            BodyText(
                text = row.ratioLabel,
                color = row.ratioPercent?.let(::regenColor) ?: MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}
