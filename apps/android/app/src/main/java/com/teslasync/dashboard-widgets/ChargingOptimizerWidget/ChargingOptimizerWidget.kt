// The native Jetpack Compose + Material 3 Charging Optimizer dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a freshness header) wrapping the
// compact optimal-start hero (1 col), or — when wider — the three key-metric tiles (Optimal start /
// Target SOC / Savings) above the peak-usage + "Optimized"/"Can improve" schedule badge, the wide-only
// 24h rate timeline, and the recommendation tip cards (or a friendly empty state). All data flows through
// the shared [ChargingOptimizerWidgetViewModel]; the view never performs HTTP. Every string resolves
// through the i18n catalog and every interactive element / metric carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingOptimizerWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingoptimizer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val LOADING_BAR_COUNT = 3
private const val PEAK_FILL_ALPHA = 0.30f
private const val OFFPEAK_FILL_ALPHA = 0.30f
private const val STANDARD_FILL_ALPHA = 0.04f
private const val TILE_FILL_ALPHA = 0.05f
private const val TIP_BORDER_ALPHA = 0.10f
private val TIMELINE_HEIGHT = 24.dp

// Axis ticks for the 24h timeline (web "12 AM / 6 AM / 12 PM / 6 PM / 12 AM"), derived through the same
// formatHour so the labels stay localized-by-construction and never drift from the cell tooltips.
private val AXIS_HOURS = listOf(0, 6, 12, 18, 24)

/**
 * Stateful entry point. Binds the shared Charging optimizer feed via [source] into a
 * [ChargingOptimizerWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8 Charging
 * / Vehicles data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network optimizer seam (`ChargingStore`/`ChargingRepository` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingOptimizerWidget(
    source: ChargingOptimizerSource,
    modifier: Modifier = Modifier,
    size: ChargingOptimizerSize = ChargingOptimizerRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ChargingOptimizerRegistration.ID,
) {
    val viewModel: ChargingOptimizerWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ChargingOptimizerWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    ChargingOptimizerWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness header
 * over the compact hero / standard tiles / wide timeline + tip body.
 */
@Composable
fun ChargingOptimizerWidgetContent(
    state: UiState<ChargingOptimizerReport>,
    size: ChargingOptimizerSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberChargingOptimizerStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val display =
                remember(state.data, size, strings) {
                    state.data?.takeIf { it.hasData }?.let { ChargingOptimizerProjection.project(it, size, strings) }
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<ChargingOptimizerReport>,
    size: ChargingOptimizerSize,
    display: ChargingOptimizerDisplay?,
    onRefresh: () -> Unit,
    strings: ChargingOptimizerStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, size = size, onRefresh = onRefresh, strings = strings)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            when {
                display == null -> OptimizerEmpty(strings)
                size.isCompact -> CompactHero(display)
                else -> StandardBody(display)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<ChargingOptimizerReport>,
    size: ChargingOptimizerSize,
    onRefresh: () -> Unit,
    strings: ChargingOptimizerStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        // Web parity: the compact (1-col) shell renders no title; only standard/wide show the title row.
        if (size.isCompact) {
            Spacer(modifier = Modifier.weight(1f))
        } else {
            Icon(
                OptimizerGlyphs.Sparkles,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun CompactHero(display: ChargingOptimizerDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                DataDisplayGlyphs.Clock,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            MetricValue(display.optimalStartText)
        }
        Caption(display.targetSocShortText)
        if (display.showSavingsBadge) {
            Badge(text = display.savingsShortText, variant = BadgeVariant.Success)
        }
    }
}

@Composable
private fun StandardBody(display: ChargingOptimizerDisplay) {
    MetricsRow(display)
    ScheduleBadgeRow(display)
    if (display.isWide) {
        RateTimeline(display)
    }
    TipCards(display)
}

@Composable
private fun MetricsRow(display: ChargingOptimizerDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MetricTile(
            modifier = Modifier.weight(1f),
            glyph = DataDisplayGlyphs.Clock,
            tint = TeslaTokens.status.success,
            metric = display.optimalStartMetric,
        )
        MetricTile(
            modifier = Modifier.weight(1f),
            glyph = DataDisplayGlyphs.BatteryCharging,
            tint = TeslaTokens.status.info,
            metric = display.targetSocMetric,
        )
        MetricTile(
            modifier = Modifier.weight(1f),
            glyph = OptimizerGlyphs.DollarSign,
            tint = TeslaTokens.status.warning,
            metric = display.savingsMetric,
        )
    }
}

@Composable
private fun MetricTile(
    glyph: ImageVector,
    tint: Color,
    metric: OptimizerMetric,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = TILE_FILL_ALPHA))
                .padding(Spacing.sm)
                .clearAndSetSemantics { contentDescription = metric.contentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(glyph, contentDescription = null, size = IconSize.Md, tint = tint)
        Text(
            text = metric.value,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
        MetricLabel(metric.label)
    }
}

@Composable
private fun ScheduleBadgeRow(display: ChargingOptimizerDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(display.peakUsageText, modifier = Modifier.weight(1f))
        Badge(text = display.scheduleBadgeText, variant = badgeVariant(display.scheduleBadgeTone))
    }
}

@Composable
private fun RateTimeline(display: ChargingOptimizerDisplay) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(display.rateTimelineLabel)
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(TIMELINE_HEIGHT)
                    .clip(RoundedCornerShape(Radius.sm))
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = TIP_BORDER_ALPHA),
                        shape = RoundedCornerShape(Radius.sm),
                    ),
        ) {
            display.segments.forEach { segment ->
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .background(segmentColor(segment.kind))
                            .clearAndSetSemantics { contentDescription = segment.label },
                    contentAlignment = Alignment.Center,
                ) {
                    if (segment.isCurrentStart) {
                        Icon(
                            DataDisplayGlyphs.Bolt,
                            contentDescription = null,
                            size = IconSize.Xs,
                            tint = TeslaTokens.status.success,
                        )
                    }
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            AXIS_HOURS.forEach { hour -> Caption(ChargingOptimizerProjection.formatHour(hour)) }
        }
    }
}

@Composable
private fun TipCards(display: ChargingOptimizerDisplay) {
    val visible = display.tips.take(display.maxTips)
    if (visible.isEmpty()) {
        EmptyState(
            message = display.noRecommendationsMessage,
            icon = OptimizerGlyphs.Sparkles,
            modifier = Modifier.fillMaxWidth(),
        )
    } else {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            visible.forEach { tip -> TipCard(tip) }
        }
    }
}

@Composable
private fun TipCard(tip: OptimizerTip) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = TILE_FILL_ALPHA))
                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = TIP_BORDER_ALPHA), RoundedCornerShape(Radius.md))
                .padding(Spacing.sm)
                .clearAndSetSemantics { contentDescription = tip.contentDescription },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            OptimizerGlyphs.Sparkles,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Text(
                    text = tip.title,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                if (tip.hasImpact) {
                    Badge(text = tip.impactLabel, variant = badgeVariant(tip.impactTone))
                }
            }
            HelperText(tip.description)
        }
    }
}

@Composable
private fun OptimizerEmpty(strings: ChargingOptimizerStrings) {
    EmptyState(
        message = strings.noData,
        icon = OptimizerGlyphs.Sparkles,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

private fun badgeVariant(tone: OptimizerBadgeTone): BadgeVariant =
    when (tone) {
        OptimizerBadgeTone.Success -> BadgeVariant.Success
        OptimizerBadgeTone.Warning -> BadgeVariant.Warning
        OptimizerBadgeTone.Neutral -> BadgeVariant.Neutral
    }

@Composable
private fun segmentColor(kind: OptimizerRateKind): Color =
    when (kind) {
        OptimizerRateKind.Peak -> TeslaTokens.status.danger.copy(alpha = PEAK_FILL_ALPHA)
        OptimizerRateKind.Offpeak -> TeslaTokens.status.success.copy(alpha = OFFPEAK_FILL_ALPHA)
        OptimizerRateKind.Standard -> MaterialTheme.colorScheme.onSurface.copy(alpha = STANDARD_FILL_ALPHA)
    }

/**
 * Builds the localized [ChargingOptimizerStrings] from the i18n catalog (P1/S10): the title, the
 * empty-state copy, the metric labels + templated short strings, the schedule + timeline words, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip. The `*Short` /
 * `peakUsage` resources carry a single `%1$s` slot the projection fills.
 */
@Composable
private fun rememberChargingOptimizerStrings(): ChargingOptimizerStrings {
    val title = stringResource(R.string.translation_widget_chargingOptimizer_title)
    val noData = stringResource(R.string.translation_widget_chargingOptimizer_noData)
    val optimalStart = stringResource(R.string.translation_widget_chargingOptimizer_optimalStart)
    val targetSoc = stringResource(R.string.translation_widget_chargingOptimizer_targetSoc)
    val savingsLabel = stringResource(R.string.translation_widget_chargingOptimizer_savingsLabel)
    val peakUsage = stringResource(R.string.translation_widget_chargingOptimizer_peakUsage)
    val optimized = stringResource(R.string.translation_widget_chargingOptimizer_optimized)
    val canImprove = stringResource(R.string.translation_widget_chargingOptimizer_canImprove)
    val rateTimeline = stringResource(R.string.translation_widget_chargingOptimizer_rateTimeline)
    val peak = stringResource(R.string.translation_widget_chargingOptimizer_peak)
    val offpeak = stringResource(R.string.translation_widget_chargingOptimizer_offpeak)
    val standard = stringResource(R.string.translation_widget_chargingOptimizer_standard)
    val noRecommendations = stringResource(R.string.translation_widget_chargingOptimizer_noRecommendations)
    val targetSocShort = stringResource(R.string.translation_widget_chargingOptimizer_targetSocShort)
    val savingsShort = stringResource(R.string.translation_widget_chargingOptimizer_savingsShort)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        noData,
        optimalStart,
        targetSoc,
        savingsLabel,
        peakUsage,
        optimized,
        canImprove,
        rateTimeline,
        peak,
        offpeak,
        standard,
        noRecommendations,
        targetSocShort,
        savingsShort,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        ChargingOptimizerStrings(
            title = title,
            noData = noData,
            optimalStart = optimalStart,
            targetSoc = targetSoc,
            savingsLabel = savingsLabel,
            peakUsageTemplate = peakUsage,
            optimized = optimized,
            canImprove = canImprove,
            rateTimeline = rateTimeline,
            peak = peak,
            offpeak = offpeak,
            standard = standard,
            noRecommendations = noRecommendations,
            targetSocShortTemplate = targetSocShort,
            savingsShortTemplate = savingsShort,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> "\u2014"
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

/**
 * Self-contained line-style glyphs the web component uses (lucide `Sparkles` / `DollarSign`) that are not
 * already in the shared `DataDisplayGlyphs` / `FeedbackGlyphs` catalogs. Authored here as 24×24 stroked
 * vectors (the same approach as `components/ui/TeslaGlyphs`) and recolored at render time by [Icon]'s
 * `tint`, so they inherit every theme/state color automatically.
 */
private object OptimizerGlyphs {
    /** Lucide `Sparkles` — the header, empty-state and tip icon (web `<Sparkles />`). */
    val Sparkles: ImageVector =
        optimizerGlyph("Sparkles") {
            moveTo(11f, 3f)
            curveTo(11.6f, 7f, 13f, 8.4f, 17f, 9f)
            curveTo(13f, 9.6f, 11.6f, 11f, 11f, 15f)
            curveTo(10.4f, 11f, 9f, 9.6f, 5f, 9f)
            curveTo(9f, 8.4f, 10.4f, 7f, 11f, 3f)
            close()
            moveTo(18f, 14f)
            curveTo(18.2f, 15.4f, 18.6f, 15.8f, 20f, 16f)
            curveTo(18.6f, 16.2f, 18.2f, 16.6f, 18f, 18f)
            curveTo(17.8f, 16.6f, 17.4f, 16.2f, 16f, 16f)
            curveTo(17.4f, 15.8f, 17.8f, 15.4f, 18f, 14f)
            close()
        }

    /** Lucide `DollarSign` — the Savings/mo metric icon (web `<DollarSign />`). */
    val DollarSign: ImageVector =
        optimizerGlyph("DollarSign") {
            moveTo(12f, 3f)
            lineTo(12f, 21f)
            moveTo(16f, 7f)
            curveTo(16f, 5.5f, 14.5f, 5f, 12f, 5f)
            curveTo(9.5f, 5f, 8f, 6f, 8f, 8f)
            curveTo(8f, 10f, 10f, 10.5f, 12f, 11f)
            curveTo(14f, 11.5f, 16f, 12f, 16f, 14f)
            curveTo(16f, 16f, 14.5f, 17f, 12f, 17f)
            curveTo(9.5f, 17f, 8f, 16.5f, 8f, 15f)
        }
}

private fun optimizerGlyph(
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
