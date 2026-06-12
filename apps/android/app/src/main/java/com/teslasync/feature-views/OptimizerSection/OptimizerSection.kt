// The native Jetpack Compose + Material 3 OptimizerSection feature view — a parity port of
// web/src/features/charging/components/charging-list/OptimizerSection.tsx. The web component is a section of
// the charging page: an optional savings banner, a three-up grid (Charging Habits key/value rows, a
// Battery-Friendly Score radial gauge, a Cost Analysis breakdown), the weekly cost heatmap, and an
// optimization-recommendations list (or its empty state). On a phone the three-up grid stacks vertically
// (web `grid-cols-1 lg:grid-cols-3`); the rest of the composition, data, states, and i18n keys are reproduced
// end to end.
//
// This port performs NO HTTP and binds no data hook of its own (its only web hook is `useTranslation`, mapped
// here to the i18n catalog). The owning page supplies the optimizer payload through the shared P1/S8
// state-holder layer as a [UiState], so this feature view renders every lifecycle state that layer can carry
// — loading skeleton chrome, hard error with retry, empty, content, and stale/offline ("last known") — without
// ever fetching. A web-parity overload that takes the raw `optimizer` value is also provided for hosts that
// already hold the loaded value. Every value derivation flows through the pure [OptimizerProjection]; the
// composable is a thin render layer.
//
// The cost heatmap (web child `CostHeatmap`) is rendered INLINE here as a private composable — it is a section
// of OptimizerSection's own parity, so the surface never drops a visible section. Its per-cell hover tooltip
// (a web affordance with no touch analogue) is replaced by one combined grid content description for TalkBack,
// exactly as the sibling ChargingBreakdownSlide donut does; the meaningful Cheap→Expensive legend stays
// individually readable. Heatmap day labels come from the platform locale (java.time.DayOfWeek) rather than
// the web's hardcoded English, so they localize for free.
//
// Colors come from the per-theme TeslaTokens.status palette and the Material 3 scheme (never raw hex); the
// heatmap's red→cool cost gradient is the one exception the inline-style rule allows — a dynamically computed
// data-viz color, theme-invariant by design like a chart palette. Entrance fades honor reduced motion via the
// shared [FadeIn]. Section header icons are decorative (the localized title carries the meaning), so they are
// hidden from TalkBack.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OptimizerSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.optimizersection

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale

// ── Layout geometry (web Tailwind values, reproduced) ────────────────────────────────────────────────

/** Max battery score for the gauge (web `max={100}`). */
private const val SCORE_MAX = 100.0

/** Web `size={150}` radial gauge. */
private val BATTERY_GAUGE_SIZE: Dp = 150.dp

/** Heatmap cell edge — a compact square (web flex-1 aspect-square inside a 600px min-width grid). */
private val HEATMAP_CELL: Dp = 14.dp

/** Gap between heatmap cells / rows (web `gap-0.5`). */
private val HEATMAP_CELL_GAP: Dp = 2.dp

/** Width of the day-label gutter (web `w-10`). */
private val HEATMAP_DAY_LABEL_WIDTH: Dp = 30.dp

/** Corner radius of a heatmap cell / legend swatch (web `rounded-sm`). */
private val HEATMAP_CELL_RADIUS: Dp = 2.dp

/** Cheap→Expensive legend swatch edge (web `w-3 h-3`). */
private val LEGEND_SWATCH: Dp = 12.dp

/** Tiny axis-label type for the heatmap hour / day gutters (web `text-[8px]/[10px]`). */
private val HEATMAP_AXIS_FONT = 9.sp

/** Web `i % 3 === 0` hour-axis label cadence. */
private const val HEATMAP_HOUR_AXIS_STEP = 3

/** Number of skeleton panels drawn while the first fetch is in flight. */
private const val OPTIMIZER_LOADING_PANELS = 3

/** Loading title-bar height + width fraction. */
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private const val SKELETON_TITLE_FRACTION = 0.4f
private const val SKELETON_BODY_LINES = 3

/** Recommendation title clamp before the detail line. */
private const val RECOMMENDATION_TITLE_MAX_LINES = 2

// Soft tints (mirroring the web `/[0.06]` bg + `/10` border + `/20` chip opacities).
private const val CARD_BG_ALPHA = 0.08f
private const val CARD_BORDER_ALPHA = 0.22f
private const val CARD_NEUTRAL_BG_ALPHA = 0.04f
private const val CHIP_BG_ALPHA = 0.2f
private const val EMPTY_CELL_ALPHA = 0.05f
private val CHIP_VERTICAL_PADDING: Dp = 2.dp
private const val RGB_MAX = 255f

// Staggered entrance delays (web framer-motion `delay`, seconds → ms).
private const val DELAY_BANNER_MS = 0
private const val DELAY_HABITS_MS = 40
private const val DELAY_BATTERY_MS = 60
private const val DELAY_COST_MS = 80
private const val DELAY_HEATMAP_MS = 100
private const val DELAY_RECS_MS = 120

private val DAY_ORDER: List<DayOfWeek> =
    listOf(
        DayOfWeek.SUNDAY,
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
    )

// ── Public entry points ────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry point for the charging optimizer section. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared optimizer feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the optimizer payload (web `optimizer`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun OptimizerSection(
    state: UiState<ChargingOptimizerData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { OptimizerSectionDiagnostics.recordViewOpened(logger) }
    OptimizerSectionContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `optimizer: ChargingOptimizerData` prop, for hosts that
 * already hold the loaded value. A `null` value renders the empty state; a present value renders the section.
 * Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun OptimizerSection(
    optimizer: ChargingOptimizerData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(optimizer) {
            if (optimizer == null) {
                UiState(UiPhase.Empty)
            } else {
                UiState(UiPhase.Content, data = optimizer)
            }
        }
    OptimizerSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * section (savings banner, habits / battery / cost panels, heatmap, recommendations) and adds the lifecycle
 * chrome the host's feed implies: a loading skeleton, a hard-error retry surface, a friendly empty state, and
 * a freshness chip that reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the freshness contract.
 */
@Composable
fun OptimizerSectionContent(
    state: UiState<ChargingOptimizerData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val locale = rememberLocale()
    when {
        state.isLoading -> OptimizerLoading(label = stringResource(R.string.translation_a11y_loading), modifier = modifier)
        state.isError -> OptimizerError(onRetry = onRetry, modifier = modifier)
        else -> {
            val display = remember(state.data, locale) { state.data?.let { OptimizerProjection.project(it, locale) } }
            if (display == null) {
                OptimizerEmpty(modifier = modifier)
            } else {
                Column(
                    modifier = modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    if (shouldShowFreshness(state)) {
                        OptimizerFreshnessRow(state = state, modifier = Modifier.align(Alignment.End))
                    }
                    OptimizerSectionBody(display = display)
                }
            }
        }
    }
}

// ── Body + sections ───────────────────────────────────────────────────────────────────────────────

/**
 * The populated section — the savings banner (only when the saving clears the web `> 5` gate), the three
 * stacked panels, the cost heatmap (only when there are readings), and the recommendations. Each block fades
 * in on its web stagger delay.
 */
@Composable
private fun OptimizerSectionBody(
    display: OptimizerDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (display.showSavingsBanner) {
            FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = DELAY_BANNER_MS) {
                SavingsBanner(amount = display.savingsAmount)
            }
        }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = DELAY_HABITS_MS) { HabitsPanel(habits = display.habits) }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = DELAY_BATTERY_MS) {
            BatteryScorePanel(score = display.batteryScore, band = display.scoreBand)
        }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = DELAY_COST_MS) { CostAnalysisPanel(cost = display.cost) }
        if (display.heatmap.visible) {
            FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = DELAY_HEATMAP_MS) { HeatmapPanel(heatmap = display.heatmap) }
        }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = DELAY_RECS_MS) {
            RecommendationsPanel(recommendations = display.recommendations)
        }
    }
}

/** The success savings banner (web `AlertBanner variant="success"`), shown only when the saving is material. */
@Composable
private fun SavingsBanner(
    amount: String,
    modifier: Modifier = Modifier,
) {
    AlertBanner(
        message = stringResource(R.string.translation_charging_optimizer_savingsDetail),
        modifier = modifier,
        tone = Tone.Success,
        title = stringResource(R.string.translation_charging_optimizer_savingsBanner, amount),
        icon = OptimizerSectionGlyphs.DollarSign,
    )
}

/** The "Charging Habits" panel — five label/value rows (web `current_schedule`). */
@Composable
private fun HabitsPanel(
    habits: HabitValues,
    modifier: Modifier = Modifier,
) {
    SectionPanel(
        title = stringResource(R.string.translation_charging_optimizer_habits),
        icon = OptimizerSectionGlyphs.Calendar,
        accent = MaterialTheme.colorScheme.primary,
        modifier = modifier,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LabeledValueRow(label = stringResource(R.string.translation_charging_optimizer_sessionsWeek), value = habits.sessionsPerWeek)
            LabeledValueRow(label = stringResource(R.string.translation_charging_optimizer_homePct), value = habits.homePct)
            LabeledValueRow(label = stringResource(R.string.translation_charging_optimizer_avgTarget), value = habits.avgTargetPct)
            LabeledValueRow(label = stringResource(R.string.translation_charging_optimizer_commonHour), value = habits.commonHour)
            LabeledValueRow(label = stringResource(R.string.translation_charging_optimizer_commonDay), value = habits.commonDay)
        }
    }
}

/** The "Battery-Friendly Score" panel — a radial gauge colored by band with a band message below. */
@Composable
private fun BatteryScorePanel(
    score: Double,
    band: ScoreBand,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = score,
                max = SCORE_MAX,
                label = stringResource(R.string.translation_charging_optimizer_batteryScore),
                color = scoreColor(band),
                size = BATTERY_GAUGE_SIZE,
            )
            Text(
                text = stringResource(scoreMessageRes(band)),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The "Cost Analysis" panel — peak/off-peak rates, peak-session emphasis, and the peak/off-peak hour lists. */
@Composable
private fun CostAnalysisPanel(
    cost: CostAnalysisDisplay,
    modifier: Modifier = Modifier,
) {
    val danger = TeslaTokens.status.danger
    val success = TeslaTokens.status.success
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    SectionPanel(
        title = stringResource(R.string.translation_charging_optimizer_costAnalysis),
        icon = OptimizerSectionGlyphs.DollarSign,
        accent = success,
        modifier = modifier,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LabeledValueRow(stringResource(R.string.translation_charging_optimizer_peakRate), cost.peakRate, valueColor = danger)
            LabeledValueRow(stringResource(R.string.translation_charging_optimizer_offpeakRate), cost.offpeakRate, valueColor = success)
            LabeledValueRow(
                label = stringResource(R.string.translation_charging_optimizer_peakSessions),
                value = cost.sessionsDuringPeakPct,
                valueColor = if (cost.sessionsDuringPeakHigh) danger else success,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            LabeledValueRow(stringResource(R.string.translation_charging_optimizer_peakHours), cost.peakHours, valueColor = muted)
            LabeledValueRow(stringResource(R.string.translation_charging_optimizer_offpeakHours), cost.offpeakHours, valueColor = muted)
        }
    }
}

/** The "Optimization Recommendations" panel — priority cards, or the friendly empty state when there are none. */
@Composable
private fun RecommendationsPanel(
    recommendations: List<RecommendationDisplay>,
    modifier: Modifier = Modifier,
) {
    SectionPanel(
        title = stringResource(R.string.translation_charging_optimizer_recommendations),
        icon = OptimizerSectionGlyphs.Lightbulb,
        accent = TeslaTokens.status.warning,
        modifier = modifier,
    ) {
        if (recommendations.isEmpty()) {
            EmptyState(message = stringResource(R.string.translation_charging_optimizer_noRecs))
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                recommendations.forEach { RecommendationCard(recommendation = it) }
            }
        }
    }
}

/** One recommendation card — a Shield-led, priority-tinted row with a title, priority chip, savings chip, and detail. */
@Composable
private fun RecommendationCard(
    recommendation: RecommendationDisplay,
    modifier: Modifier = Modifier,
) {
    val accent = levelAccent(recommendation.level)
    val isLow = recommendation.level == RecommendationLevel.Low
    val background =
        if (isLow) MaterialTheme.colorScheme.onSurface.copy(alpha = CARD_NEUTRAL_BG_ALPHA) else accent.copy(alpha = CARD_BG_ALPHA)
    val border = if (isLow) MaterialTheme.colorScheme.outlineVariant else accent.copy(alpha = CARD_BORDER_ALPHA)
    val success = TeslaTokens.status.success
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.lg),
        color = background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(OptimizerSectionGlyphs.Shield, contentDescription = null, size = IconSize.Md, tint = accent)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Text(
                        text = recommendation.title,
                        modifier = Modifier.weight(1f, fill = false),
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = RECOMMENDATION_TITLE_MAX_LINES,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (recommendation.priorityLabel.isNotBlank()) {
                        OptimizerChip(text = recommendation.priorityLabel, foreground = accent)
                    }
                    if (recommendation.savingsBadge != null) {
                        OptimizerChip(text = recommendation.savingsBadge, foreground = success)
                    }
                }
                HelperText(recommendation.detail)
            }
        }
    }
}

// ── Cost heatmap (inline; web child CostHeatmap) ──────────────────────────────────────────────────

/** The "Charging Cost Heatmap" panel — a horizontally-scrollable 7×24 intensity grid with a Cheap→Expensive legend. */
@Composable
private fun HeatmapPanel(
    heatmap: HeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.translation_charging_optimizer_heatmap)
    val dayLabels = rememberDayLabels()
    SectionPanel(title = title, icon = OptimizerSectionGlyphs.Clock, accent = TeslaTokens.chart.power, modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            HeatmapGrid(heatmap = heatmap, dayLabels = dayLabels, contentDescription = title)
            HeatmapLegend(
                cheap = stringResource(R.string.translation_charging_optimizer_cheap),
                expensive = stringResource(R.string.translation_charging_optimizer_expensive),
            )
        }
    }
}

/** The scrollable grid — an hour axis row over seven day rows. Exposes one combined TalkBack description. */
@Composable
private fun HeatmapGrid(
    heatmap: HeatmapDisplay,
    dayLabels: List<String>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .horizontalScroll(rememberScrollState())
                .clearAndSetSemantics { this.contentDescription = contentDescription },
        verticalArrangement = Arrangement.spacedBy(HEATMAP_CELL_GAP),
    ) {
        HeatmapHourAxis()
        heatmap.rows.forEachIndexed { dayIndex, cells ->
            HeatmapDayRow(label = dayLabels.getOrElse(dayIndex) { "" }, cells = cells)
        }
    }
}

/** The hour-axis labels (web `i % 3 === 0 ? i : ''`), gutter-aligned with the day rows below. */
@Composable
private fun HeatmapHourAxis() {
    Row(horizontalArrangement = Arrangement.spacedBy(HEATMAP_CELL_GAP), verticalAlignment = Alignment.CenterVertically) {
        Spacer(modifier = Modifier.width(HEATMAP_DAY_LABEL_WIDTH))
        for (hour in 0 until OptimizerProjection.HOURS_PER_DAY) {
            Box(modifier = Modifier.width(HEATMAP_CELL), contentAlignment = Alignment.Center) {
                if (hour % HEATMAP_HOUR_AXIS_STEP == 0) {
                    Text(
                        text = hour.toString(),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = HEATMAP_AXIS_FONT),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/** One day row — a right-aligned day label gutter followed by 24 colored cells. */
@Composable
private fun HeatmapDayRow(
    label: String,
    cells: List<HeatCell>,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(HEATMAP_CELL_GAP), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.width(HEATMAP_DAY_LABEL_WIDTH), contentAlignment = Alignment.CenterEnd) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = HEATMAP_AXIS_FONT),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        cells.forEach { HeatCellBox(cell = it) }
    }
}

/** A single heatmap cell — the cost-gradient fill for a populated hour, a theme-neutral fill when idle. */
@Composable
private fun HeatCellBox(cell: HeatCell) {
    val color =
        if (cell.sessions > 0) {
            OptimizerProjection.heatColor(cell.intensity, cell.sessions).toColor()
        } else {
            MaterialTheme.colorScheme.onSurface.copy(alpha = EMPTY_CELL_ALPHA)
        }
    Box(
        modifier =
            Modifier
                .size(HEATMAP_CELL)
                .clip(RoundedCornerShape(HEATMAP_CELL_RADIUS))
                .background(color),
    )
}

/** The right-aligned Cheap→Expensive legend (web fixed-alpha swatches over the same gradient). */
@Composable
private fun HeatmapLegend(
    cheap: String,
    expensive: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spacer(modifier = Modifier.weight(1f))
        Caption(cheap)
        Row(horizontalArrangement = Arrangement.spacedBy(HEATMAP_CELL_GAP)) {
            OptimizerProjection.LEGEND_STOPS.forEach { stop ->
                Box(
                    modifier =
                        Modifier
                            .size(LEGEND_SWATCH)
                            .clip(RoundedCornerShape(HEATMAP_CELL_RADIUS))
                            .background(OptimizerProjection.legendColor(stop).toColor()),
                )
            }
        }
        Caption(expensive)
    }
}

// ── Reusable section chrome + rows ────────────────────────────────────────────────────────────────

/** A titled glass panel with an accent-tinted leading icon — the web `<h3><Icon/> Title</h3>` + `<GlassPanel>`. */
@Composable
private fun SectionPanel(
    title: String,
    icon: ImageVector,
    accent: Color,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(icon, contentDescription = null, size = IconSize.Sm, tint = accent)
                PanelTitle(title)
            }
            content()
        }
    }
}

/** One label/value row (web `flex items-center justify-between text-xs`); [valueColor] carries any emphasis. */
@Composable
private fun LabeledValueRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium,
            color = valueColor,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End,
        )
    }
}

/** A small rounded chip — a tinted pill for the priority + savings badges (web `rounded-full` micro-chips). */
@Composable
private fun OptimizerChip(
    text: String,
    foreground: Color,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = foreground.copy(alpha = CHIP_BG_ALPHA),
        contentColor = foreground,
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = Spacing.xs, vertical = CHIP_VERTICAL_PADDING),
            style = MaterialTheme.typography.labelSmall,
            color = foreground,
        )
    }
}

// ── Lifecycle chrome ────────────────────────────────────────────────────────────────────────────────

/** First-load skeleton — stacked panel-shaped blocks so the section is never blank. Carries one "Loading" label. */
@Composable
private fun OptimizerLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(OPTIMIZER_LOADING_PANELS) {
            GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
                    SkeletonLines(lines = SKELETON_BODY_LINES)
                }
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun OptimizerError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        modifier = modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** Empty state — shown when the host resolves no optimizer data, so the section is never a blank box. */
@Composable
private fun OptimizerEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip — the honest "last known + retry" affordance, shown when cached data is refreshing /
 * stale / offline. Offline reads the localized "Offline" label; a reachable-but-stale value reads its age.
 */
@Composable
private fun OptimizerFreshnessRow(
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        modifier = modifier,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberOptimizerFreshnessFormatter(),
    )
}

// ── Render-only helpers ───────────────────────────────────────────────────────────────────────────

/** True when cached data is refreshing / stale / offline and the section content (not loading/error) is shown. */
private fun shouldShowFreshness(state: UiState<*>): Boolean =
    !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

/** The gauge color for a score [band] — semantic green / amber / red (web `#22c55e / #f59e0b / #ef4444`). */
@Composable
@ReadOnlyComposable
private fun scoreColor(band: ScoreBand): Color =
    when (band) {
        ScoreBand.Good -> TeslaTokens.status.success
        ScoreBand.Fair -> TeslaTokens.status.warning
        ScoreBand.Poor -> TeslaTokens.status.danger
    }

/** The accent (icon + chip) color for a recommendation [level] — danger / warning / success. */
@Composable
@ReadOnlyComposable
private fun levelAccent(level: RecommendationLevel): Color =
    when (level) {
        RecommendationLevel.High -> TeslaTokens.status.danger
        RecommendationLevel.Medium -> TeslaTokens.status.warning
        RecommendationLevel.Low -> TeslaTokens.status.success
    }

/** The band → message string id (web `scoreGood / scoreFair / scorePoor`). */
private fun scoreMessageRes(band: ScoreBand): Int =
    when (band) {
        ScoreBand.Good -> R.string.translation_charging_optimizer_scoreGood
        ScoreBand.Fair -> R.string.translation_charging_optimizer_scoreFair
        ScoreBand.Poor -> R.string.translation_charging_optimizer_scorePoor
    }

/** Convert a pure [HeatRgba] data-viz color into a Compose [Color]. */
private fun HeatRgba.toColor(): Color = Color(red = red / RGB_MAX, green = green / RGB_MAX, blue = blue / RGB_MAX, alpha = alpha.toFloat())

/** The active display locale (drives number formatting + heatmap day labels), reacting to config changes. */
@Composable
private fun rememberLocale(): Locale {
    val configuration = LocalConfiguration.current
    return configuration.locales.get(0) ?: Locale.getDefault()
}

/** The seven localized short day labels (Sun→Sat), from the platform locale rather than hardcoded English. */
@Composable
private fun rememberDayLabels(): List<String> {
    val locale = rememberLocale()
    return remember(locale) { DAY_ORDER.map { it.getDisplayName(TextStyle.SHORT, locale) } }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberOptimizerFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Em dash for an absent relative-age stamp (the freshness chip's Unknown branch). */
private const val EM_DASH = "\u2014"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_DATA =
    ChargingOptimizerData(
        currentSchedule =
            OptimizerSchedule(
                mostCommonStartHour = 22,
                mostCommonDay = "Monday",
                avgSessionsPerWeek = 4.5,
                homeChargingPct = 80.0,
                avgChargeToPct = 85.0,
            ),
        costAnalysis =
            OptimizerCostAnalysis(
                peakHours = listOf(16, 17, 18),
                offpeakHours = listOf(0, 1, 2),
                peakCostPerKwh = 0.32,
                offpeakCostPerKwh = 0.12,
                sessionsDuringPeakPct = 40.0,
                potentialMonthlySavings = 24.0,
            ),
        batteryHealthScore = 82.0,
        recommendations =
            listOf(
                OptimizerRecommendation(
                    type = "shift",
                    priority = "high",
                    title = "Shift charging to off-peak hours",
                    detail = "Most of your sessions land in the peak window. Starting after midnight cuts cost.",
                    estimatedSavings = 12.0,
                ),
            ),
        weeklyHeatmap = listOf(OptimizerHeatmapEntry(day = 1, hour = 22, sessions = 3, avgCostPerKwh = 0.30)),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun OptimizerContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OptimizerSectionContent(state = UiState(UiPhase.Content, data = PREVIEW_DATA), onRetry = {})
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun OptimizerLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OptimizerSectionContent(state = UiState(UiPhase.Loading), onRetry = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun OptimizerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OptimizerSectionContent(state = UiState(UiPhase.Empty), onRetry = {})
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun OptimizerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OptimizerSectionContent(state = UiState(UiPhase.Error), onRetry = {})
    }
}
