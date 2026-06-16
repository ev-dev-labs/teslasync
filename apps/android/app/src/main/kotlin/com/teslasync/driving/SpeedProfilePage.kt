// The native Jetpack Compose + Material 3 SpeedProfilePage driving surface — a parity port of
// web/src/features/driving/pages/SpeedProfilePage.tsx, the speed-distribution + driving-pattern explorer. It
// reproduces the page's five sections (the hero-gauge panel, the speed-distribution bar chart, the per-bucket
// detail-card grid, the efficiency-vs-speed scatter, and the efficiency-insight callout), every data state
// (loading skeleton / empty / error-retry / content, plus the cache-then-network stale/offline tier the bound
// state holder carries), the date-range control that scopes all three windows, and every visible string (resolved
// from the generated res/values catalog, ADR-014).
//
// Composition: [SpeedProfilePage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the analytics feed + the drives list + the live display
// preferences + the picked window); [SpeedProfilePageContent] is the stateless render layer. The parsed
// `useSpeedProfile` aggregate + the windowed `useDrives` list are folded by the framework-free model
// (deriveSpeedProfile) into the bucket cards + the scatter cloud — exactly as the web page threads its loaded
// `data` / `drives` through its useMemo chain. SI values are converted to the user's units only here at the
// display boundary via the model's prefs helpers (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.driving.speedprofile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt

/** The page's interaction callbacks, wired to the [SpeedProfilePageViewModel] (web event handlers). */
data class SpeedProfileActions(
    val onSetRange: (Long?, Long?) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SpeedProfilePageViewModel] over the supplied [source] (the host wires the shared
 * driving repository + settings holder + the app-scoped active-vehicle selection via [speedProfilePageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun SpeedProfilePage(
    source: SpeedProfilePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SpeedProfilePageViewModel =
        viewModel(
            key = SpeedProfilePageRegistration.SLUG,
            factory = viewModelFactory { initializer { SpeedProfilePageViewModel(source, logger) } },
        )
    SpeedProfilePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] analytics feed + drives + display prefs + window to the content. */
@Composable
fun SpeedProfilePage(
    viewModel: SpeedProfilePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.speedProfileState.collectAsStateWithLifecycle()
    val drives by viewModel.drives.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val range by viewModel.range.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            SpeedProfileActions(
                onSetRange = viewModel::setRange,
                onRetry = viewModel::retry,
            )
        }

    SpeedProfilePageContent(
        state = state,
        drives = drives,
        prefs = prefs,
        range = range,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. The header + the date-range control are always drawn (web `PageContainer` chrome with
 * the `VehicleSelect`/`RangePicker` actions); beneath them the state switch renders the cold-load skeleton, the
 * hard-error retry surface, the no-data empty panel (web `data ? … : <EmptyState/>`), or the five loaded sections.
 */
@Composable
fun SpeedProfilePageContent(
    state: UiState<SpeedProfileData>,
    drives: List<Drive>,
    prefs: SpeedProfileDisplayPrefs,
    range: SpeedProfileRange,
    actions: SpeedProfileActions,
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
        SpeedProfileHeader(state)
        SpeedProfileRangeControl(range = range, onSetRange = actions.onSetRange)

        when {
            state.isLoading -> SpeedProfileLoading()
            state.isError -> SpeedProfileError(onRetry = actions.onRetry)
            state.isEmpty -> SpeedProfileEmptyPanel()
            else ->
                SpeedProfileSuccess(
                    data = state.data ?: SpeedProfileData.EMPTY,
                    drives = drives,
                    prefs = prefs,
                    range = range,
                )
        }
    }
}

/** The page header — the `<h1>` title + muted subtitle + the query-freshness chip (web `PageContainer`). */
@Composable
private fun SpeedProfileHeader(state: UiState<SpeedProfileData>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_speedProfile_title))
            BodyText(
                stringResource(R.string.translation_speedProfile_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0L },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
}

/**
 * The date-range control that scopes the analytics window + the drives narrowing (web `RangePicker`). The picked
 * ISO `[start, end]` is mapped to the inclusive epoch-day pair the Material range filter edits; selecting a preset
 * or a custom calendar range bumps the view-model window, which re-collects the analytics feed.
 */
@Composable
private fun SpeedProfileRangeControl(
    range: SpeedProfileRange,
    onSetRange: (Long?, Long?) -> Unit,
) {
    val startEpochDay = remember(range.start) { runCatching { LocalDate.parse(range.start).toEpochDay() }.getOrNull() }
    val endEpochDay = remember(range.end) { runCatching { LocalDate.parse(range.end).toEpochDay() }.getOrNull() }
    DateRangeFilter(
        startEpochDay = startEpochDay,
        endEpochDay = endEpochDay,
        onRangeChange = onSetRange,
    )
}

/** The hard-error surface for the analytics feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun SpeedProfileError(onRetry: () -> Unit) {
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

/** The no-data empty panel (web `data ? … : <EmptyState/>`). Never collapses to a blank box. */
@Composable
private fun SpeedProfileEmptyPanel() {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            EmptyState(message = stringResource(R.string.translation_speedProfile_noData))
        }
    }
}

/**
 * The cold-load skeleton (web `PageContainer loading`): the hero-gauge row, the distribution chart block, the
 * bucket-card row, the scatter chart block and the insight strip — so no region flashes blank while the first load
 * is in flight.
 */
@Composable
private fun SpeedProfileLoading() {
    FadeIn {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            StatGridSkeleton(count = HERO_GAUGE_COUNT)
            ChartBlockSkeleton(height = DISTRIBUTION_HEIGHT)
            StatGridSkeleton(count = BUCKET_COLUMNS)
            ChartBlockSkeleton(height = SCATTER_BLOCK_HEIGHT)
            ChartBlockSkeleton(height = INSIGHT_SKELETON_HEIGHT)
        }
    }
}

/**
 * The loaded surface — the five web sections in order: hero gauges, speed distribution, per-bucket detail cards,
 * efficiency-vs-speed scatter (shown once enough points exist, web `scatterData.length > 3`), and the efficiency
 * insight (shown once an optimal speed is known, web `optimalSpeedMps > 0`). The single analytics aggregate + the
 * windowed drives are folded by the framework-free model into the cards + scatter.
 */
@Composable
private fun SpeedProfileSuccess(
    data: SpeedProfileData,
    drives: List<Drive>,
    prefs: SpeedProfileDisplayPrefs,
    range: SpeedProfileRange,
) {
    val zone = remember { ZoneId.systemDefault() }
    val derived = remember(data, drives, prefs, range) { deriveSpeedProfile(data, drives, prefs, range, zone) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        HeroGaugesPanel(data = data, prefs = prefs)
        SpeedDistributionPanel(data = data, prefs = prefs)
        SpeedBucketCardsPanel(buckets = derived.buckets, prefs = prefs)
        if (derived.scatter.size > MIN_SCATTER_POINTS) {
            EfficiencyVsSpeedPanel(points = derived.scatter, prefs = prefs)
        }
        if (data.optimalSpeedMps > 0.0) {
            EfficiencyInsightPanel(data = data, prefs = prefs)
        }
    }
}

// ── Section 1 — hero gauges (GlassPanel1) ─────────────────────────────────────────────────────────────────────

/** GlassPanel1 — the three hero RadialGauges (avg / peak / optimal speed) over their SI full-scale maxima. */
@Composable
private fun HeroGaugesPanel(
    data: SpeedProfileData,
    prefs: SpeedProfileDisplayPrefs,
) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                HeroGauge(
                    valueMps = data.avgSpeedMps,
                    maxMps = SpeedProfilePageRegistration.AVG_GAUGE_MAX_MPS,
                    label = stringResource(R.string.translation_speedProfile_avgSpeed),
                    color = GAUGE_AVG_COLOR,
                    prefs = prefs,
                    modifier = Modifier.weight(1f),
                )
                HeroGauge(
                    valueMps = data.peakSpeedMps,
                    maxMps = SpeedProfilePageRegistration.PEAK_GAUGE_MAX_MPS,
                    label = stringResource(R.string.translation_speedProfile_peakSpeed),
                    color = GAUGE_PEAK_COLOR,
                    prefs = prefs,
                    modifier = Modifier.weight(1f),
                )
                HeroGauge(
                    valueMps = data.optimalSpeedMps,
                    maxMps = SpeedProfilePageRegistration.OPTIMAL_GAUGE_MAX_MPS,
                    label = stringResource(R.string.translation_speedProfile_optimalSpeed),
                    color = GAUGE_OPTIMAL_COLOR,
                    prefs = prefs,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** One hero gauge column — converts the SI value + max to the user's speed unit at the display boundary. */
@Composable
private fun HeroGauge(
    valueMps: Double,
    maxMps: Double,
    label: String,
    color: Color,
    prefs: SpeedProfileDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        RadialGauge(
            value = prefs.toSpeed(valueMps),
            max = prefs.toSpeed(maxMps),
            label = label,
            unit = prefs.speedLabel,
            color = color,
        )
    }
}

// ── Section 2 — speed distribution (Speed-Distribution: ChartContainer + BarChart) ────────────────────────────

/** Speed-Distribution — the per-bucket reading-count bar chart inside a [ChartContainer] with a table fallback. */
@Composable
private fun SpeedDistributionPanel(
    data: SpeedProfileData,
    prefs: SpeedProfileDisplayPrefs,
) {
    val labels = remember(data) { data.distribution.map { it.speedBucket } }
    val seriesLabel = "% ${stringResource(R.string.translation_speedProfile_timeSpent)}"
    val series =
        remember(data, seriesLabel) {
            listOf(
                ChartSeries(
                    key = "readings",
                    label = seriesLabel,
                    values = data.distribution.map { it.readings * 1.0 },
                    kind = ChartSeriesKind.Bar,
                    color = DISTRIBUTION_BAR_COLOR,
                ),
            )
        }
    val tableHeader =
        listOf(
            stringResource(R.string.translation_speedProfile_speed),
            stringResource(R.string.translation_speedProfile_drives),
        )
    val tableRows = remember(data) { data.distribution.map { listOf(it.speedBucket, it.readings.toString()) } }

    FadeIn {
        ChartContainer(
            title = stringResource(R.string.translation_speedProfile_distribution),
            accessibleDescription = stringResource(R.string.translation_speedProfile_distribution_aria),
            height = DISTRIBUTION_HEIGHT,
            status = if (data.distribution.isEmpty()) ChartStatus.Empty else ChartStatus.Ready,
            emptyMessage = stringResource(R.string.translation_speedProfile_noData),
            dataTableHeader = tableHeader,
            dataTableRows = tableRows,
        ) {
            BarChartWrapper(
                series = series,
                xLabels = labels,
                height = DISTRIBUTION_HEIGHT,
                yValueFormatter = { ChartFormat.number(it, 0, prefs.locale) },
            )
        }
    }
}

// ── Section 3 — speed-bucket detail cards (GlassPanel3) ───────────────────────────────────────────────────────

/** GlassPanel3 — the staggered grid of per-bucket detail cards (time-share, drive count, mean speed/efficiency). */
@Composable
private fun SpeedBucketCardsPanel(
    buckets: List<SpeedBucketCard>,
    prefs: SpeedProfileDisplayPrefs,
) {
    if (buckets.isEmpty()) {
        FadeIn {
            GlassPanel(padding = PanelPadding.Lg) {
                EmptyState(message = stringResource(R.string.translation_speedProfile_noData))
            }
        }
        return
    }
    StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        buckets.chunked(BUCKET_COLUMNS).forEachIndexed { rowIndex, rowBuckets ->
            StaggerItem(index = rowIndex) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    rowBuckets.forEach { card ->
                        SpeedBucketCardView(card = card, prefs = prefs, modifier = Modifier.weight(1f))
                    }
                    repeat(BUCKET_COLUMNS - rowBuckets.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/** One speed-bucket detail card — the color-coded label plus the time-share / drives / mean-speed / efficiency rows. */
@Composable
private fun SpeedBucketCardView(
    card: SpeedBucketCard,
    prefs: SpeedProfileDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            ColorDot(bucketColor(card.range))
            BodyText(card.range)
        }
        Spacer(modifier = Modifier.height(Spacing.xs))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BucketStatRow(
                label = stringResource(R.string.translation_speedProfile_timeShare),
                value = "${ChartFormat.number(card.timeSharePct, PERCENT_DECIMALS, prefs.locale)}%",
                valueColor = bucketColor(card.range),
            )
            BucketStatRow(
                label = stringResource(R.string.translation_speedProfile_drives),
                value = card.readings.toString(),
                valueColor = EFF_CYAN,
            )
            val efficiency = card.efficiency
            if (efficiency != null) {
                BucketStatRow(
                    label = stringResource(R.string.translation_speedProfile_avgSpeed),
                    value =
                        ChartFormat.withUnit(
                            prefs.toSpeed(efficiency.avgSpeedMps),
                            prefs.speedLabel,
                            prefs.precision,
                            prefs.locale,
                        ),
                    valueColor = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                BucketStatRow(
                    label = prefs.efficiencyLabel,
                    value = ChartFormat.number(prefs.toEfficiency(efficiency.avgEff), prefs.precision, prefs.locale),
                    valueColor = bucketEfficiencyColor(efficiency.avgEff),
                )
            }
        }
    }
}

/** A single `label … value` row inside a bucket detail card (web `flex justify-between` line). */
@Composable
private fun BucketStatRow(
    label: String,
    value: String,
    valueColor: Color,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        BodyText(value, color = valueColor)
    }
}

// ── Section 4 — efficiency vs speed (Efficiency-vs-Speed: ChartContainer + ScatterChart) ──────────────────────

/** Efficiency-vs-Speed — the per-drive scatter cloud inside a [ChartContainer], with the three-tier color legend. */
@Composable
private fun EfficiencyVsSpeedPanel(
    points: List<SpeedScatterPoint>,
    prefs: SpeedProfileDisplayPrefs,
) {
    val subtitle =
        "${stringResource(R.string.translation_speedProfile_lower)} ${prefs.efficiencyLabel} = " +
            stringResource(R.string.translation_speedProfile_better)
    val tableHeader =
        listOf(
            stringResource(R.string.translation_speedProfile_speed),
            prefs.efficiencyLabel,
        )
    val tableRows =
        remember(points, prefs) {
            points.map { point ->
                listOf(
                    "${point.speedDisplay.roundToInt()} ${prefs.speedLabel}",
                    point.efficiencyDisplay.roundToInt().toString(),
                )
            }
        }

    FadeIn {
        ChartContainer(
            title = stringResource(R.string.translation_speedProfile_effVsSpeed),
            subtitle = subtitle,
            accessibleDescription = stringResource(R.string.translation_speedProfile_effVsSpeed_aria),
            height = SCATTER_BLOCK_HEIGHT,
            dataTableHeader = tableHeader,
            dataTableRows = tableRows,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                ScatterPlot(points = points)
                ScatterLegend()
            }
        }
    }
}

/** The Compose-canvas scatter plot — each windowed drive a dot, colored by its efficiency tier; never a webview. */
@Composable
private fun ScatterPlot(
    points: List<SpeedScatterPoint>,
    modifier: Modifier = Modifier,
) {
    val description = stringResource(R.string.translation_speedProfile_effVsSpeed_aria)
    val dotColors = remember(points) { points.map { efficiencyTierColor(it.efficiencyDisplay) } }
    Canvas(
        modifier =
            modifier
                .fillMaxWidth()
                .height(SCATTER_PLOT_HEIGHT)
                .semantics { contentDescription = description },
    ) {
        if (points.isEmpty()) return@Canvas
        val speeds = points.map { it.speedDisplay }
        val efficiencies = points.map { it.efficiencyDisplay }
        val minSpeed = speeds.min()
        val maxSpeed = speeds.max()
        val minEff = efficiencies.min()
        val maxEff = efficiencies.max()
        val spanSpeed = (maxSpeed - minSpeed).takeIf { it > 0.0 } ?: 1.0
        val spanEff = (maxEff - minEff).takeIf { it > 0.0 } ?: 1.0
        val plotWidth = size.width - SCATTER_PADDING_PX * 2f
        val plotHeight = size.height - SCATTER_PADDING_PX * 2f
        points.forEachIndexed { index, point ->
            val fractionX = ((point.speedDisplay - minSpeed) / spanSpeed).toFloat()
            val fractionY = ((point.efficiencyDisplay - minEff) / spanEff).toFloat()
            val cx = SCATTER_PADDING_PX + fractionX * plotWidth
            val cy = SCATTER_PADDING_PX + (1f - fractionY) * plotHeight
            drawCircle(
                color = dotColors[index].copy(alpha = SCATTER_DOT_ALPHA),
                radius = SCATTER_DOT_RADIUS_PX,
                center = Offset(cx, cy),
            )
        }
    }
}

/** The scatter's three-tier legend (web `Efficient` / `Moderate` / `High consumption`). */
@Composable
private fun ScatterLegend() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LegendEntry(EFF_EMERALD, stringResource(R.string.translation_speedProfile_efficient))
        LegendEntry(EFF_AMBER, stringResource(R.string.translation_speedProfile_moderate))
        LegendEntry(EFF_RED, stringResource(R.string.translation_speedProfile_highConsumption))
    }
}

/** A colored swatch + label in the scatter legend. */
@Composable
private fun LegendEntry(
    color: Color,
    label: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        ColorDot(color)
        Caption(label)
    }
}

// ── Section 5 — efficiency insight (GlassPanel5) ──────────────────────────────────────────────────────────────

/** GlassPanel5 — the success-accented efficiency-insight callout, interpolating the optimal speed + unit. */
@Composable
private fun EfficiencyInsightPanel(
    data: SpeedProfileData,
    prefs: SpeedProfileDisplayPrefs,
) {
    val speedText = ChartFormat.number(prefs.toSpeed(data.optimalSpeedMps), prefs.precision, prefs.locale)
    FadeIn {
        GlassPanel(padding = PanelPadding.Md, accent = PanelAccent.Success) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = TeslaGlyphs.Info,
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = TeslaTokens.status.success,
                )
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    PanelTitle(stringResource(R.string.translation_speedProfile_insightTitle))
                    BodyText(
                        stringResource(R.string.translation_speedProfile_insightText, speedText, prefs.speedLabel),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// ── Shared bits ───────────────────────────────────────────────────────────────────────────────────────────────

/** A small filled circular swatch of [color] — the bucket / legend color indicator. */
@Composable
private fun ColorDot(color: Color) {
    Box(modifier = Modifier.size(DOT_SIZE).clip(CircleShape).background(color))
}

/**
 * The bucket label's accent color (web `bucketColor`) — a DYNAMIC chart value keyed off the mph-derived label,
 * not a static theme token, so the prohibited static-inline-color rule does not apply (the documented chart-value
 * exception).
 */
private fun bucketColor(range: String): Color =
    when {
        range.startsWith("0") || range.contains("15") -> EFF_EMERALD
        range.startsWith("30") || range.contains("45") -> EFF_CYAN
        range.startsWith("60") || range.contains("75") -> EFF_AMBER
        else -> EFF_RED
    }

/** A scatter point's efficiency-tier color (web `eff < 140/200/260` thresholds). DYNAMIC chart value. */
private fun efficiencyTierColor(efficiencyDisplay: Double): Color =
    when {
        efficiencyDisplay < EFF_TIER_EFFICIENT -> EFF_EMERALD
        efficiencyDisplay < EFF_TIER_CYAN -> EFF_CYAN
        efficiencyDisplay < EFF_TIER_MODERATE -> EFF_AMBER
        else -> EFF_RED
    }

/** A bucket card's mean-efficiency color (web `avgEff < 160/220` thresholds). DYNAMIC chart value. */
private fun bucketEfficiencyColor(avgEff: Double): Color =
    when {
        avgEff < BUCKET_EFF_GOOD -> EFF_EMERALD
        avgEff < BUCKET_EFF_FAIR -> EFF_AMBER
        else -> EFF_RED
    }

// Web CHART_COLORS hex (dynamic chart values, not static theme tokens — the documented prohibited-pattern exception).
private val GAUGE_AVG_COLOR = Color(0xFF00F0FF)
private val GAUGE_PEAK_COLOR = Color(0xFFEF4444)
private val GAUGE_OPTIMAL_COLOR = Color(0xFF10B981)
private val DISTRIBUTION_BAR_COLOR = Color(0xFF00F0FF)
private val EFF_EMERALD = Color(0xFF10B981)
private val EFF_CYAN = Color(0xFF00F0FF)
private val EFF_AMBER = Color(0xFFF59E0B)
private val EFF_RED = Color(0xFFEF4444)

/** Web `scatterData.length > 3` gate before the efficiency-vs-speed section renders. */
private const val MIN_SCATTER_POINTS = 3

/** Phone-first column count for the bucket-card grid (web `grid-cols-2` base). */
private const val BUCKET_COLUMNS = 2

/** Hero-gauge tile count (web three-up grid). */
private const val HERO_GAUGE_COUNT = 3

/** Web `fmtNumber(pct, 1)` — the time-share percentage's fixed precision. */
private const val PERCENT_DECIMALS = 1

// Web efficiency-tier thresholds (display Wh/distance).
private const val EFF_TIER_EFFICIENT = 140.0
private const val EFF_TIER_CYAN = 200.0
private const val EFF_TIER_MODERATE = 260.0
private const val BUCKET_EFF_GOOD = 160.0
private const val BUCKET_EFF_FAIR = 220.0

private val DOT_SIZE: Dp = 8.dp
private val DISTRIBUTION_HEIGHT: Dp = 280.dp
private val SCATTER_BLOCK_HEIGHT: Dp = 240.dp
private val SCATTER_PLOT_HEIGHT: Dp = 200.dp
private val INSIGHT_SKELETON_HEIGHT: Dp = 72.dp
private const val SCATTER_PADDING_PX = 16f
private const val SCATTER_DOT_RADIUS_PX = 7f
private const val SCATTER_DOT_ALPHA = 0.7f
