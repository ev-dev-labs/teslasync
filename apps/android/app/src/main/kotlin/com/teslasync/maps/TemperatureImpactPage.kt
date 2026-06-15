// The native Jetpack Compose + Material 3 TemperatureImpactPage maps surface — a parity port of
// web/src/features/maps/pages/TemperatureImpactPage.tsx, the "how outside temperature affects driving efficiency"
// dashboard. It reproduces the page's eight panels (the four summary metric cards — avg-efficiency, best/worst temp
// range, total data points — the temperature-vs-efficiency scatter, the per-bucket efficiency line, the optimal-
// temperature analysis, and the contextual tips), both charts (the native Canvas scatter with its average reference
// line + the A3 line wrapper), every data state (loading skeleton / empty / error-with-retry / content), and every
// visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [TemperatureImpactPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the points feed + the live display preferences);
// [TemperatureImpactPageContent] is the stateless render layer. The backend `points[]` feed is folded by the
// framework-free model (deriveTemperatureStats / scatterPoints / computeScatterLayout / temperatureTips) into the
// cards, charts, analysis, and tips — exactly as the web page threads its loaded data through the useMemo chain. SI
// values are converted to the user's units only here at the display boundary via the model's [TemperatureDisplayPrefs]
// helpers (Phase-48 SI-canonical); no region is ever hidden — each renders its own empty surface instead.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete set.
// `ExperimentalLayoutApi` is opted in for the wrapping badge `FlowRow` (the established EnergyProductsPage precedent).
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
)
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package io.teslasync.android.maps.temperatureimpact

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The em dash shown for the summary cards before any data loads (web `value={… ?? '—'}`). */
private const val EM_DASH = "\u2014"

/** The scatter Canvas plot height; the framing [ChartContainer] sizes its empty/loading states to match. */
private val SCATTER_CANVAS_HEIGHT = 232.dp
private val SCATTER_PANEL_HEIGHT = 300.dp

/** The per-bucket efficiency line-chart height (web `<div className="h-64">`). */
private val LINE_CHART_HEIGHT = 256.dp

private val DOT_RADIUS = 4.dp
private val PLOT_PAD = 10.dp
private val GRID_STROKE = 1.dp
private val REF_STROKE = 1.5.dp
private const val GRID_DIVISIONS = 4
private const val REF_LINE_ALPHA = 0.6f
private val DASH_INTERVALS = floatArrayOf(10f, 10f)

// The web's data-viz accent hexes (dynamic chart / semantic values, not static theme tokens — the sibling
// RegenEfficiencyPage `REGEN_*` precedent). The five bucket fills mirror web `TEMP_BUCKETS_C[].color`
// (blue→cyan→green→amber→red); the card glyph tints reuse the same palette.
private val TEMP_BLUE = Color(0xFF3B82F6)
private val TEMP_CYAN = Color(0xFF06B6D4)
private val TEMP_GREEN = Color(0xFF10B981)
private val TEMP_AMBER = Color(0xFFF59E0B)
private val TEMP_RED = Color(0xFFEF4444)
private val TEMP_PURPLE = Color(0xFFA855F7)
private val TEMP_EMERALD = Color(0xFF34D399)

/** The five bucket fills, by SI bucket ordinal (web `TEMP_BUCKETS_C[].color`). */
private val TEMP_BUCKET_COLORS = listOf(TEMP_BLUE, TEMP_CYAN, TEMP_GREEN, TEMP_AMBER, TEMP_RED)

/** The bucket fill for a (clamped) SI bucket ordinal. */
private fun bucketColor(index: Int): Color = TEMP_BUCKET_COLORS[index.coerceIn(0, TEMP_BUCKET_COLORS.lastIndex)]

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TemperatureImpactPageViewModel] over the supplied [source] (the host wires the
 * shared resilient client + settings holder + the app-scoped active-vehicle selection via
 * [temperatureImpactPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun TemperatureImpactPage(
    source: TemperatureImpactPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: TemperatureImpactPageViewModel =
        viewModel(
            key = TemperatureImpactPageRegistration.SLUG,
            factory = viewModelFactory { initializer { TemperatureImpactPageViewModel(source, logger) } },
        )
    TemperatureImpactPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] points feed + display prefs to the stateless content. */
@Composable
fun TemperatureImpactPage(
    viewModel: TemperatureImpactPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.pointsState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    TemperatureImpactPageContent(
        state = state,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. The page chrome (title + subtitle + the global vehicle-scope picker) always renders;
 * then a still-loading feed with nothing cached shows the full-page skeleton, otherwise the optional error banner is
 * drawn above the eight panels. Every panel renders its own fallback (em-dash cards / empty charts / tips empty
 * state) so no region ever blanks — the `temperature.title` document title is exposed as the screen's accessible
 * name (web `usePageTitle`).
 */
@Composable
fun TemperatureImpactPageContent(
    state: UiState<List<TempEfficiencyPoint>>,
    prefs: TemperatureDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pageTitle = stringResource(R.string.translation_temperature_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { contentDescription = pageTitle },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TemperatureChrome()

        if (state.isLoading) {
            TemperatureLoading()
            return@Column
        }

        if (state.hasError) {
            TemperatureErrorBanner(onRetry = onRetry)
        }

        val points = state.data.orEmpty()
        val stats = remember(points, prefs) { deriveTemperatureStats(points, prefs) }
        val scatter = remember(points, prefs) { scatterPoints(points, prefs) }
        val tips = remember(stats) { temperatureTips(stats) }

        FadeIn { TemperatureMetricCards(stats = stats, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS) {
            TemperatureScatterPanel(scatter = scatter, avgEff = stats?.avgEff, prefs = prefs)
        }
        FadeIn(delayMs = FADE_STEP_MS * 2) { TemperatureBucketPanel(stats = stats, prefs = prefs) }
        if (stats?.best != null) {
            FadeIn(delayMs = FADE_STEP_MS * 3) { TemperatureOptimalPanel(stats = stats, prefs = prefs) }
        }
        FadeIn(delayMs = FADE_STEP_MS * 4) { TemperatureTipsPanel(tips = tips) }
    }
}

/** The page chrome — the title + muted subtitle (web `PageContainer` title/subtitle) + the vehicle-scope picker. */
@Composable
private fun TemperatureChrome() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_tempImpact_title))
            BodyText(
                stringResource(R.string.translation_tempImpact_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // web `actions={<VehicleSelect />}` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/** The full-page loading skeleton shown before the first points payload (web `PageContainer loading`). */
@Composable
private fun TemperatureLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        PageHeaderSkeleton()
        StatGridSkeleton(count = 2)
        StatGridSkeleton(count = 2)
        ChartBlockSkeleton(height = SCATTER_CANVAS_HEIGHT)
        ChartBlockSkeleton(height = LINE_CHART_HEIGHT)
    }
}

/** The data-load error surface (web `<AlertBanner variant="danger">`) — a retry-able danger banner. */
@Composable
private fun TemperatureErrorBanner(onRetry: () -> Unit) {
    AlertBanner(
        message = stringResource(R.string.translation_error_loadFailed),
        tone = Tone.Danger,
        action =
            BannerAction(
                label = stringResource(R.string.translation_common_retry),
                onClick = onRetry,
            ),
    )
}

// ── Panels 1–4 — Summary metric cards ────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel1–4 — the four summary [MetricCard]s (avg-efficiency, best/worst temp range, total data points), laid
 * out two-per-row (web `grid-cols-2`). Each shows its em-dash / zero fallback until [stats] loads.
 */
@Composable
private fun TemperatureMetricCards(
    stats: TemperatureStats?,
    prefs: TemperatureDisplayPrefs,
) {
    val eff = prefs.efficiencyLabel
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tempImpact_avgEfficiency),
                value = stats?.let { "${prefs.number(it.avgEff)} $eff" } ?: EM_DASH,
                icon = TemperatureImpactGlyphs.Thermometer,
                accent = TEMP_CYAN,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tempImpact_bestRange),
                value = stats?.best?.label ?: EM_DASH,
                icon = TemperatureImpactGlyphs.TrendingUp,
                accent = TEMP_GREEN,
                subtitle = stats?.best?.let { "${prefs.number(it.avg)} $eff" },
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tempImpact_worstRange),
                value = stats?.worst?.label ?: EM_DASH,
                icon = TemperatureImpactGlyphs.Sun,
                accent = TEMP_PURPLE,
                subtitle = stats?.worst?.let { "${prefs.number(it.avg)} $eff" },
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tempImpact_totalPoints),
                value = (stats?.total ?: 0).toString(),
                icon = TemperatureImpactGlyphs.Thermometer,
                accent = TEMP_CYAN,
            )
        }
    }
}

// ── Panel 5 — Scatter: Temperature vs Efficiency ─────────────────────────────────────────────────────────────

/**
 * GlassPanel5 — the temperature-vs-efficiency scatter (web `<ScatterChart>`), framed by [ChartContainer] with its
 * accessible data table. The native Canvas plots every drive coloured by its SI temperature bucket, with the
 * average-efficiency reference line (web `<ReferenceLine y={avgEff}>`); the y-axis efficiency unit + x-axis
 * temperature labels + the "Drives" series legend bracket the plot. Empty when no drive has data.
 */
@Composable
private fun TemperatureScatterPanel(
    scatter: List<ScatterPoint>,
    avgEff: Double?,
    prefs: TemperatureDisplayPrefs,
) {
    val layout = remember(scatter, avgEff) { computeScatterLayout(scatter, avgEff) }
    val title = stringResource(R.string.translation_tempImpact_scatterTitle)
    val temperatureAxis = "${stringResource(R.string.translation_tempImpact_temperature)} (${prefs.temperatureLabel})"
    val efficiencyAxis = "${stringResource(R.string.translation_tempImpact_efficiency)} (${prefs.efficiencyLabel})"
    ChartContainer(
        title = title,
        status = if (layout.hasData) ChartStatus.Ready else ChartStatus.Empty,
        height = SCATTER_PANEL_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_a11y_chartFigure, title),
        emptyMessage = stringResource(R.string.translation_common_noData),
        dataTableHeader = listOf(temperatureAxis, efficiencyAxis),
        dataTableRows = scatter.map { listOf(prefs.number(it.tempDisplay), prefs.number(it.effDisplay)) },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(efficiencyAxis)
            TemperatureScatterCanvas(
                layout = layout,
                modifier = Modifier.fillMaxWidth().height(SCATTER_CANVAS_HEIGHT),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Caption(temperatureAxis)
                Badge(
                    text = stringResource(R.string.translation_tempImpact_scatterName),
                    variant = BadgeVariant.Info,
                    dot = true,
                )
            }
        }
    }
}

/** The pure-Canvas scatter plot: light gridlines, the dashed average-efficiency reference line, and a coloured dot
 *  per drive — all positioned from the JVM-tested [ScatterLayout] fractions. */
@Composable
private fun TemperatureScatterCanvas(
    layout: ScatterLayout,
    modifier: Modifier = Modifier,
) {
    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val refColor = paletteColor(1).copy(alpha = REF_LINE_ALPHA)
    Canvas(modifier = modifier) {
        val pad = PLOT_PAD.toPx()
        val plotWidth = size.width - pad * 2
        val plotHeight = size.height - pad * 2
        if (plotWidth <= 0f || plotHeight <= 0f) return@Canvas

        for (i in 0..GRID_DIVISIONS) {
            val y = pad + plotHeight * i / GRID_DIVISIONS
            drawLine(gridColor, Offset(pad, y), Offset(pad + plotWidth, y), GRID_STROKE.toPx())
            val x = pad + plotWidth * i / GRID_DIVISIONS
            drawLine(gridColor, Offset(x, pad), Offset(x, pad + plotHeight), GRID_STROKE.toPx())
        }

        layout.avgFraction?.let { fraction ->
            val y = pad + plotHeight * (1f - fraction)
            drawLine(
                color = refColor,
                start = Offset(pad, y),
                end = Offset(pad + plotWidth, y),
                strokeWidth = REF_STROKE.toPx(),
                pathEffect = PathEffect.dashPathEffect(DASH_INTERVALS, 0f),
            )
        }

        val radius = DOT_RADIUS.toPx()
        layout.dots.forEach { dot ->
            val cx = pad + plotWidth * dot.xFraction
            val cy = pad + plotHeight * (1f - dot.yFraction)
            drawCircle(color = bucketColor(dot.bucketIndex), radius = radius, center = Offset(cx, cy), alpha = 0.9f)
        }
    }
}

// ── Panel 6 — Line: Efficiency by Temperature Range ──────────────────────────────────────────────────────────

/**
 * GlassPanel6 — the per-bucket average-efficiency line (web `<LineChart data={bucketAvgs}>`), framed by
 * [ChartContainer]. Plots all five buckets (zero-count buckets render a zero point) over the A3 [LineChartWrapper];
 * empty until at least one bucket has data.
 */
@Composable
private fun TemperatureBucketPanel(
    stats: TemperatureStats?,
    prefs: TemperatureDisplayPrefs,
) {
    val buckets = stats?.bucketAvgs.orEmpty()
    val hasData = buckets.any { it.count > 0 }
    val title = stringResource(R.string.translation_tempImpact_bucketTitle)
    val seriesLabel = "${stringResource(R.string.translation_tempImpact_avgEff)} (${prefs.efficiencyLabel})"
    val rangeHeader = stringResource(R.string.translation_tempImpact_temperature)
    ChartContainer(
        title = title,
        status = if (hasData) ChartStatus.Ready else ChartStatus.Empty,
        height = LINE_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_a11y_chartFigure, title),
        emptyMessage = stringResource(R.string.translation_common_noData),
        dataTableHeader = listOf(rangeHeader, prefs.efficiencyLabel),
        dataTableRows = buckets.map { listOf(it.label, prefs.number(it.avg)) },
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "avg",
                        label = seriesLabel,
                        values = buckets.map { it.avg },
                        kind = ChartSeriesKind.Line,
                        color = TEMP_CYAN,
                    ),
                ),
            xLabels = buckets.map { it.label },
            height = LINE_CHART_HEIGHT,
            yValueFormatter = { prefs.number(it) },
            emptyMessage = stringResource(R.string.translation_common_noData),
        )
    }
}

// ── Panel 7 — Optimal temperature analysis ───────────────────────────────────────────────────────────────────

/**
 * GlassPanel7 — the optimal-temperature analysis (web `{stats?.best && (<GlassPanel glow="green">…)}`). Renders the
 * best-range narrative, the best-vs-worst savings line, and a wrapping strip of per-bucket badges (the best bucket
 * highlighted). Invoked only when a best bucket exists, exactly as the web guards it.
 */
@Composable
private fun TemperatureOptimalPanel(
    stats: TemperatureStats,
    prefs: TemperatureDisplayPrefs,
) {
    val best = stats.best ?: return
    val eff = prefs.efficiencyLabel
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = PanelAccent.Success) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.Top) {
            Icon(
                TemperatureImpactGlyphs.Thermometer,
                contentDescription = null,
                size = IconSize.Lg,
                tint = TEMP_EMERALD,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                SectionTitle(stringResource(R.string.translation_tempImpact_optimalTitle))
                BodyText(
                    stringResource(
                        R.string.translation_tempImpact_optimalDesc,
                        best.label,
                        prefs.number(best.avg),
                        eff,
                        best.count.toString(),
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val worst = stats.worst
                if (worst != null && worst.label != best.label) {
                    HelperText(
                        stringResource(
                            R.string.translation_tempImpact_optimalDelta,
                            worst.label,
                            prefs.number(worst.avg - best.avg),
                            eff,
                        ),
                    )
                }
                FlowRow(
                    modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    stats.bucketAvgs
                        .filter { it.count > 0 }
                        .forEach { bucket ->
                            Badge(
                                text = "${bucket.label}: ${prefs.number(bucket.avg)} $eff",
                                variant = if (bucket.label == best.label) BadgeVariant.Success else BadgeVariant.Neutral,
                            )
                        }
                }
            }
        }
    }
}

// ── Panel 8 — Tips & recommendations ─────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel8 — the contextual tips (web tips `<GlassPanel>`): a lightbulb-headed list of recommendation badges, or
 * the friendly empty state (web `<EmptyState message={t('common.noData')} />`) when no tip applies.
 */
@Composable
private fun TemperatureTipsPanel(tips: List<TemperatureTip>) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(TemperatureImpactGlyphs.Lightbulb, contentDescription = null, size = IconSize.Md, tint = TEMP_AMBER)
            Spacer(Modifier.width(Spacing.xs))
            SectionTitle(stringResource(R.string.translation_tempImpact_tipsTitle))
        }
        Spacer(Modifier.height(Spacing.sm))
        if (tips.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                tips.forEach { tip -> TemperatureTipRow(tip) }
            }
        } else {
            EmptyState(
                icon = TemperatureImpactGlyphs.Activity,
                message = stringResource(R.string.translation_common_noData),
            )
        }
    }
}

/** One recommendation row — a kind-specific icon + a coloured [Badge] carrying the localized tip text. */
@Composable
private fun TemperatureTipRow(tip: TemperatureTip) {
    val icon =
        when (tip.kind) {
            TemperatureTipKind.Optimal -> TemperatureImpactGlyphs.TrendingUp
            TemperatureTipKind.Cold -> TemperatureImpactGlyphs.Snowflake
            TemperatureTipKind.Hot -> TemperatureImpactGlyphs.Sun
        }
    val variant =
        when (tip.kind) {
            TemperatureTipKind.Optimal -> BadgeVariant.Success
            TemperatureTipKind.Cold -> BadgeVariant.Info
            TemperatureTipKind.Hot -> BadgeVariant.Warning
        }
    val text =
        when (tip.kind) {
            TemperatureTipKind.Optimal ->
                stringResource(R.string.translation_tempImpact_tipOptimal, tip.range ?: EM_DASH)
            TemperatureTipKind.Cold -> stringResource(R.string.translation_tempImpact_tipCold)
            TemperatureTipKind.Hot -> stringResource(R.string.translation_tempImpact_tipHot)
        }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Badge(text = text, variant = variant, dot = true)
    }
}
