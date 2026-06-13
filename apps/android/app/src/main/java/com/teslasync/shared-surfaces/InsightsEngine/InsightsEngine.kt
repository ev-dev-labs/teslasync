// The native Jetpack Compose + Material 3 InsightsEngine shared surface — a parity port of the web
// "smart insights" panel web/src/components/data-display/InsightsEngine.tsx and the hook it reads,
// web/src/hooks/useFormatting.ts.
//
// [InsightsEngine] is the stateful entry: it binds the [InsightsEngineViewModel] over the
// [InsightsFormattingSource] seam (the settings-backed P1/S8 boundary the web `useFormatting` ports
// to), records the one-shot `view.opened` diagnostic, collects the live [InsightsFormatting], and
// classifies the caller-supplied [InsightData] + feed status with the pure [classifyInsights].
// [InsightsEngineContent] is the stateless renderer (the test / preview entry point) that paints the
// classified branch.
//
// The faithful mapping of the web behaviour:
//   * the eight analyzers + the per-insight card (icon box, title, trend arrow, description) →
//     [InsightCard], laid out in a 1-column / 2-column adaptive grid (web `grid-cols-1 md:grid-cols-2`);
//   * the "Smart Insights" header with the amber lightbulb (web `<Lightbulb className="text-neon-amber"/>`)
//     → [InsightsHeader];
//   * the web `return null` empty branch → a friendly [InsightsEmpty] (P3 forbids a hidden surface);
//   * the loading / stale / offline / error feed chrome the P3 contract requires → the skeleton, the
//     freshness chip, and the QueryError branch (documented in InsightsEngineModel.kt as feed-status
//     chrome, not fabricated web behaviour).
// Every visible string resolves through the P1/S10 Android string catalog (`translation_insights_*`);
// no English literal lives in this file. The icons reuse the shared data-display glyph set where it
// already carries the lucide shape and add the few it lacks ([InsightsGlyphs]); each card carries a
// merged TalkBack description (title + body), and the trend arrow is decorative.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/InsightsEngine) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.insightsengine

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.android.components.datadisplay.FreshnessStatus
import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.datadisplay.deltaToneColor
import io.teslasync.android.components.datadisplay.freshnessColor
import io.teslasync.android.components.datadisplay.severityColor
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.DataContainer
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the insights grid root — used by the per-state instrumented UI test. */
const val INSIGHTS_GRID_TEST_TAG: String = "insights-grid"

/** Test tag identifying one rendered insight card. */
const val INSIGHT_CARD_TEST_TAG: String = "insight-card"

/** Test tag identifying the loading skeleton region. */
const val INSIGHTS_LOADING_TEST_TAG: String = "insights-loading"

/** Test tag identifying the friendly empty state. */
const val INSIGHTS_EMPTY_TEST_TAG: String = "insights-empty"

/** Test tag identifying the failure (QueryError) region. */
const val INSIGHTS_FAILED_TEST_TAG: String = "insights-failed"

/** Hand-staggered entry delay matching the web `<FadeIn delay={0.15}>`. */
private const val FADE_DELAY_MS: Int = 150

/** The `md:` breakpoint at / above which the grid switches to two columns (web `md:grid-cols-2`). */
private val GRID_BREAKPOINT: Dp = 600.dp

/** The square icon-chip dimension (web `rounded-lg p-2` around an `h-5 w-5` icon). */
private val ICON_BOX_SIZE: Dp = 40.dp

/** Low-alpha wash behind a card's severity-tinted icon (web `bg ${borderColor}15`). */
private const val ICON_BOX_ALPHA: Float = 0.12f

/** Chip fill / border alphas for the stale / offline freshness chip (mirrors the shared chip wash). */
private const val CHIP_BG_ALPHA: Float = 0.14f
private const val CHIP_BORDER_ALPHA: Float = 0.32f

/** Skeleton rows shown while the feed loads. */
private const val SKELETON_ROWS: Int = 2

// ── Stateful + stateless entry points ────────────────────────────────────────────────────────

/**
 * Builds (and remembers) the production [InsightsFormattingSource] from the app [DataContainer] — the
 * settings feed the web `useFormatting` derives from. Remembered per container so the mapped flow is
 * not rebuilt every recomposition.
 */
@Composable
fun rememberInsightsFormattingSource(container: DataContainer = LocalDataContainer.current): InsightsFormattingSource =
    remember(container) { SettingsInsightsFormattingSource(container.settingsStore.settings()) }

/**
 * Stateful entry point bound to the shared settings state holder — the faithful port of the web
 * `InsightsEngine` resolving `useFormatting()` and rendering the smart-insights panel. Binds the
 * [InsightsEngineViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the live
 * [InsightsFormatting], and classifies the caller-supplied [data] into the branch
 * [InsightsEngineContent] paints. The surface performs no HTTP.
 *
 * @param data the analysis inputs (the web `data` prop) — already-resolved feeds the host supplies.
 * @param status the parent's feed lifecycle (default [InsightsFeedStatus.Ready] = pure web behaviour).
 * @param onRetry the host's refetch, surfaced by the failure state's retry affordance; `null` hides it
 *   (the surface fetches nothing, so retry is delegated to the feed-backed parent).
 * @param source the formatting seam; defaults to the settings-backed production source.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 * @param instanceKey scopes the ViewModel per placement.
 */
@Composable
fun InsightsEngine(
    data: InsightData,
    modifier: Modifier = Modifier,
    status: InsightsFeedStatus = InsightsFeedStatus.Ready,
    onRetry: (() -> Unit)? = null,
    source: InsightsFormattingSource = rememberInsightsFormattingSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = INSIGHTS_ENGINE_SLUG,
) {
    val viewModel: InsightsEngineViewModel =
        viewModel(key = instanceKey, factory = InsightsEngineViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val formatting by viewModel.formatting.collectAsStateWithLifecycle()
    val surface = classifyInsights(data, status, formatting)
    InsightsEngineContent(surface = surface, modifier = modifier, onRetry = onRetry)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the classified branch inside
 * a [FadeIn]: a loading skeleton, the resolved grid (with an optional stale / offline chip), a
 * friendly empty state, or a QueryError-equivalent. Every branch renders a non-blank surface (never a
 * hidden one) so the P3 "every state renders" contract holds.
 */
@Composable
fun InsightsEngineContent(
    surface: InsightsSurface,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    FadeIn(modifier = modifier.fillMaxWidth(), delayMs = FADE_DELAY_MS) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when (surface) {
                InsightsSurface.Loading -> InsightsLoading()
                is InsightsSurface.Content -> {
                    InsightsHeader(freshness = surface.freshness)
                    InsightsGrid(insights = surface.insights)
                }

                InsightsSurface.Empty -> {
                    InsightsHeader()
                    InsightsEmpty()
                }

                is InsightsSurface.Failed -> {
                    InsightsHeader()
                    InsightsFailed(offline = surface.offline, onRetry = onRetry)
                }
            }
        }
    }
}

// ── Header + freshness chip ──────────────────────────────────────────────────────────────────

/**
 * The "Smart Insights" section header — the amber lightbulb (decorative) plus the localized title,
 * with an optional stale / offline [freshness] chip (web has no chip; this is the P3 freshness
 * affordance for the stale / offline content states).
 */
@Composable
private fun InsightsHeader(
    freshness: InsightsFreshness = InsightsFreshness.Fresh,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = InsightsGlyphs.Lightbulb,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.warning,
        )
        SectionTitle(stringResource(R.string.translation_insights_title))
        FreshnessChip(freshness)
    }
}

/** The stale / offline freshness chip; renders nothing for [InsightsFreshness.Fresh]. */
@Composable
private fun FreshnessChip(
    freshness: InsightsFreshness,
    modifier: Modifier = Modifier,
) {
    if (freshness == InsightsFreshness.Fresh) return
    val status = if (freshness == InsightsFreshness.Stale) FreshnessStatus.Stale else FreshnessStatus.Offline
    val labelRes =
        if (freshness == InsightsFreshness.Stale) R.string.translation_insights_stale else R.string.translation_insights_offline
    val color = freshnessColor(status)
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.small,
        color = color.copy(alpha = CHIP_BG_ALPHA),
        contentColor = color,
        border = BorderStroke(1.dp, color.copy(alpha = CHIP_BORDER_ALPHA)),
    ) {
        Text(
            text = stringResource(labelRes),
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            style = MaterialTheme.typography.labelSmall,
            color = color,
        )
    }
}

// ── Grid + card ──────────────────────────────────────────────────────────────────────────────

/**
 * The adaptive insights grid — one column on a compact width, two at / above [GRID_BREAKPOINT] (web
 * `grid-cols-1 md:grid-cols-2`). A trailing odd card is balanced with a flexible spacer so it does
 * not stretch across the row.
 */
@Composable
private fun InsightsGrid(
    insights: List<Insight>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth().testTag(INSIGHTS_GRID_TEST_TAG)) {
        val columns = if (maxWidth >= GRID_BREAKPOINT) 2 else 1
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            insights.chunked(columns).forEach { rowItems ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                    rowItems.forEach { insight -> InsightCard(insight = insight, modifier = Modifier.weight(1f)) }
                    if (rowItems.size < columns) {
                        Spacer(modifier = Modifier.weight((columns - rowItems.size).toFloat()))
                    }
                }
            }
        }
    }
}

/** One insight card — severity-accented panel with an icon chip, title + trend arrow, and the body. */
@Composable
private fun InsightCard(
    insight: Insight,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(titleRes(insight.titleKey))
    val description = insightDescription(insight.body)
    val cardLabel = insightCardAccessibilityLabel(title, description)
    GlassPanel(
        modifier =
            modifier
                .testTag(INSIGHT_CARD_TEST_TAG)
                .semantics(mergeDescendants = true) { contentDescription = cardLabel },
        padding = PanelPadding.Md,
        accent = severityAccent(insight.severity),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            InsightIconChip(icon = insight.icon, severity = insight.severity)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Subhead(text = title, modifier = Modifier.weight(1f, fill = false))
                    Icon(
                        imageVector = trendGlyph(insight.trend),
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = deltaToneColor(insight.tone),
                    )
                }
                BodyText(text = description, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The severity-tinted icon chip leading a card. */
@Composable
private fun InsightIconChip(
    icon: InsightIcon,
    severity: InsightSeverity,
    modifier: Modifier = Modifier,
) {
    val color = severityColor(toSeverity(severity))
    Box(
        modifier =
            modifier
                .size(ICON_BOX_SIZE)
                .clip(RoundedCornerShape(Radius.md))
                .background(color.copy(alpha = ICON_BOX_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = iconVector(icon), contentDescription = null, size = IconSize.Lg, tint = color)
    }
}

/**
 * Resolves an insight's localized description from its segments. `map` is inline so `stringResource`
 * is callable per segment; the resolved parts are then joined plainly, mirroring the web
 * `description +=` concatenation.
 */
@Composable
private fun insightDescription(body: List<InsightSegment>): String {
    val parts = body.map { segment -> resolveSegment(segment) }
    return parts.joinToString(" ")
}

/** Resolves one segment: each [InsightArg.Res] becomes a nested catalog phrase, then substituted. */
@Suppress("SpreadOperator")
@Composable
private fun resolveSegment(segment: InsightSegment): String {
    val resolved =
        segment.args
            .map<InsightArg, Any> { arg ->
                when (arg) {
                    is InsightArg.Raw -> arg.text
                    is InsightArg.Res -> stringResource(bodyRes(arg.key))
                }
            }.toTypedArray()
    return stringResource(bodyRes(segment.key), *resolved)
}

// ── Loading / empty / failed branches ────────────────────────────────────────────────────────

/** The loading state — the header plus a skeleton grid, kept non-blank and labelled for TalkBack. */
@Composable
private fun InsightsLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_insights_loading)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(INSIGHTS_LOADING_TEST_TAG)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        InsightsHeader()
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val columns = if (maxWidth >= GRID_BREAKPOINT) 2 else 1
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                repeat(SKELETON_ROWS) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                        repeat(columns) {
                            GlassPanel(modifier = Modifier.weight(1f), padding = PanelPadding.Md) { InsightCardSkeleton() }
                        }
                    }
                }
            }
        }
    }
}

/** Skeleton shape of a single card — an icon-chip block plus a title line and two body lines. */
@Composable
private fun InsightCardSkeleton(modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Box(modifier = Modifier.size(ICON_BOX_SIZE)) { Skeleton(height = ICON_BOX_SIZE, rounded = true) }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
            SkeletonLines(lines = 2, lineHeight = SKELETON_BODY_HEIGHT)
        }
    }
}

/** The empty state — a friendly, discoverable card (the web `return null`, P3-adapted). */
@Composable
private fun InsightsEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_insights_empty_message),
        modifier = modifier.testTag(INSIGHTS_EMPTY_TEST_TAG),
        icon = InsightsGlyphs.Lightbulb,
        title = stringResource(R.string.translation_insights_empty_title),
    )
}

/** The failure state — a QueryError-equivalent; [onRetry] (the host refetch) drives the retry CTA. */
@Composable
private fun InsightsFailed(
    offline: Boolean,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    QueryError(
        kind = if (offline) QueryErrorKind.Offline else QueryErrorKind.ServerError,
        modifier = modifier.testTag(INSIGHTS_FAILED_TEST_TAG),
        onRetry = onRetry,
    )
}

private const val SKELETON_TITLE_FRACTION: Float = 0.5f
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_BODY_HEIGHT: Dp = 10.dp

// ── Enum → resource / theme / glyph mapping ──────────────────────────────────────────────────

/** Card-title catalog keys (kept as a map so the resolver stays trivially simple, not a wide `when`). */
private val TITLE_RES: Map<InsightTitleKey, Int> =
    mapOf(
        InsightTitleKey.ChargingCost to R.string.translation_insights_chargingCost_title,
        InsightTitleKey.EfficiencyTrend to R.string.translation_insights_efficiencyTrend_title,
        InsightTitleKey.BatteryHealth to R.string.translation_insights_batteryHealth_title,
        InsightTitleKey.OptimalCharging to R.string.translation_insights_optimalCharging_title,
        InsightTitleKey.VampireDrain to R.string.translation_insights_vampireDrain_title,
        InsightTitleKey.DrivingPatterns to R.string.translation_insights_drivingPatterns_title,
        InsightTitleKey.CostSavings to R.string.translation_insights_costSavings_title,
        InsightTitleKey.RangeOptimization to R.string.translation_insights_rangeOptimization_title,
    )

/** Body / phrase catalog keys (a map keeps the resolver complexity at one). */
private val BODY_RES: Map<InsightBodyKey, Int> =
    mapOf(
        InsightBodyKey.ChargingCostAvg to R.string.translation_insights_chargingCost_avg,
        InsightBodyKey.ChargingCostHomeSavings to R.string.translation_insights_chargingCost_homeSavings,
        InsightBodyKey.ChargingCostHomeHigher to R.string.translation_insights_chargingCost_homeHigher,
        InsightBodyKey.EfficiencyImproved to R.string.translation_insights_efficiencyTrend_improved,
        InsightBodyKey.EfficiencyDecreased to R.string.translation_insights_efficiencyTrend_decreased,
        InsightBodyKey.BatteryHealthBody to R.string.translation_insights_batteryHealth_body,
        InsightBodyKey.BatteryAgingExpected to R.string.translation_insights_batteryHealth_agingExpected,
        InsightBodyKey.BatteryAgingWorse to R.string.translation_insights_batteryHealth_agingWorse,
        InsightBodyKey.BatteryAgingBetter to R.string.translation_insights_batteryHealth_agingBetter,
        InsightBodyKey.OptimalChargingAvg to R.string.translation_insights_optimalCharging_avg,
        InsightBodyKey.OptimalChargingExceed to R.string.translation_insights_optimalCharging_exceed,
        InsightBodyKey.OptimalChargingIdeal to R.string.translation_insights_optimalCharging_ideal,
        InsightBodyKey.VampireSentry to R.string.translation_insights_vampireDrain_sentry,
        InsightBodyKey.VampireSummary to R.string.translation_insights_vampireDrain_summary,
        InsightBodyKey.DrivingPatternsBody to R.string.translation_insights_drivingPatterns_body,
        InsightBodyKey.DaySunday to R.string.translation_insights_day_sunday,
        InsightBodyKey.DayMonday to R.string.translation_insights_day_monday,
        InsightBodyKey.DayTuesday to R.string.translation_insights_day_tuesday,
        InsightBodyKey.DayWednesday to R.string.translation_insights_day_wednesday,
        InsightBodyKey.DayThursday to R.string.translation_insights_day_thursday,
        InsightBodyKey.DayFriday to R.string.translation_insights_day_friday,
        InsightBodyKey.DaySaturday to R.string.translation_insights_day_saturday,
        InsightBodyKey.CostSavingsBody to R.string.translation_insights_costSavings_body,
        InsightBodyKey.RangeOptimizationBody to R.string.translation_insights_rangeOptimization_body,
        InsightBodyKey.RangeAdviceImprove to R.string.translation_insights_rangeOptimization_adviceImprove,
        InsightBodyKey.RangeAdviceGood to R.string.translation_insights_rangeOptimization_adviceGood,
    )

private fun titleRes(key: InsightTitleKey): Int = TITLE_RES.getValue(key)

private fun bodyRes(key: InsightBodyKey): Int = BODY_RES.getValue(key)

/** Maps a card severity onto the canonical component [Severity] used by the token palette. */
private fun toSeverity(severity: InsightSeverity): Severity =
    when (severity) {
        InsightSeverity.Info -> Severity.Info
        InsightSeverity.Success -> Severity.Success
        InsightSeverity.Warning -> Severity.Warn
        InsightSeverity.Alert -> Severity.Critical
    }

/** Maps a card severity onto the [GlassPanel] accent (web's left-border color). */
private fun severityAccent(severity: InsightSeverity): PanelAccent =
    when (severity) {
        InsightSeverity.Info -> PanelAccent.Info
        InsightSeverity.Success -> PanelAccent.Success
        InsightSeverity.Warning -> PanelAccent.Warning
        InsightSeverity.Alert -> PanelAccent.Danger
    }

/** Maps an insight icon onto its concrete vector — shared data-display glyphs plus the local extras. */
private fun iconVector(icon: InsightIcon): ImageVector =
    when (icon) {
        InsightIcon.DollarSign -> InsightsGlyphs.DollarSign
        InsightIcon.Efficiency -> DataDisplayGlyphs.Bolt
        InsightIcon.Battery -> DataDisplayGlyphs.Battery
        InsightIcon.BatteryCharging -> DataDisplayGlyphs.BatteryCharging
        InsightIcon.Shield -> DataDisplayGlyphs.Shield
        InsightIcon.Car -> InsightsGlyphs.Car
        InsightIcon.Leaf -> InsightsGlyphs.Leaf
        InsightIcon.Clock -> DataDisplayGlyphs.Clock
    }

/** Maps a trend onto its arrow glyph (web `TREND_ICON`). */
private fun trendGlyph(trend: InsightTrend): ImageVector =
    when (trend) {
        InsightTrend.Up -> InsightsGlyphs.TrendingUp
        InsightTrend.Down -> DataDisplayGlyphs.TrendingDown
        InsightTrend.Neutral -> DataDisplayGlyphs.ArrowRight
    }

// ── Local lucide glyphs the shared data-display set does not carry ────────────────────────────

/**
 * The lucide glyphs the InsightsEngine needs that `DataDisplayGlyphs` does not already provide,
 * authored as 24×24 stroked vectors (the same approach `DataDisplayGlyphs` / `TeslaGlyphs` take, as
 * Android has no bundled lucide equivalent without the frozen `material-icons-extended` artifact).
 * Each is monochrome and recolored at render time by the `Icon` composable's tint.
 */
private object InsightsGlyphs {
    val Lightbulb: ImageVector =
        stroked("Lightbulb") {
            moveTo(9f, 18f)
            lineTo(15f, 18f)
            moveTo(10f, 21f)
            lineTo(14f, 21f)
            moveTo(9f, 18f)
            curveTo(9f, 14f, 6f, 13f, 6f, 9.5f)
            curveTo(6f, 6.4f, 8.7f, 4f, 12f, 4f)
            curveTo(15.3f, 4f, 18f, 6.4f, 18f, 9.5f)
            curveTo(18f, 13f, 15f, 14f, 15f, 18f)
        }

    val TrendingUp: ImageVector =
        stroked("TrendingUp") {
            moveTo(4f, 17f)
            lineTo(11f, 10f)
            lineTo(14f, 13f)
            lineTo(20f, 7f)
            moveTo(15f, 7f)
            lineTo(20f, 7f)
            lineTo(20f, 12f)
        }

    val DollarSign: ImageVector =
        stroked("DollarSign") {
            moveTo(12f, 2f)
            lineTo(12f, 22f)
            moveTo(17f, 6f)
            curveTo(16f, 4.5f, 14f, 4f, 12f, 4f)
            curveTo(9f, 4f, 7f, 5.5f, 7f, 8f)
            curveTo(7f, 10.5f, 9f, 11.5f, 12f, 12f)
            curveTo(15f, 12.5f, 17f, 13.5f, 17f, 16f)
            curveTo(17f, 18.5f, 15f, 20f, 12f, 20f)
            curveTo(10f, 20f, 8f, 19.5f, 7f, 18f)
        }

    val Car: ImageVector =
        stroked("Car") {
            moveTo(6f, 11f)
            lineTo(7.5f, 7f)
            lineTo(15f, 7f)
            lineTo(18f, 11f)
            moveTo(3f, 11f)
            lineTo(21f, 11f)
            lineTo(21f, 15f)
            lineTo(3f, 15f)
            close()
            circle(7.5f, 16f, 1.3f)
            circle(16f, 16f, 1.3f)
        }

    val Leaf: ImageVector =
        stroked("Leaf") {
            moveTo(4f, 20f)
            curveTo(4f, 12f, 10f, 4f, 20f, 4f)
            curveTo(20f, 14f, 14f, 20f, 6f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14f, 10f)
        }
}

private fun stroked(
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Previews (tooling-only; sample values are never shipped UI) ───────────────────────────────

private fun previewInsights(): List<Insight> =
    listOf(
        Insight(
            id = "battery-health",
            icon = InsightIcon.Battery,
            titleKey = InsightTitleKey.BatteryHealth,
            body =
                listOf(
                    InsightSegment(
                        InsightBodyKey.BatteryHealthBody,
                        listOf(
                            InsightArg.Raw("95.2"),
                            InsightArg.Raw("2.1"),
                            InsightArg.Res(InsightBodyKey.BatteryAgingBetter),
                        ),
                    ),
                ),
            trend = InsightTrend.Up,
            tone = DeltaTone.Good,
            severity = InsightSeverity.Success,
        ),
        Insight(
            id = "optimal-charging",
            icon = InsightIcon.BatteryCharging,
            titleKey = InsightTitleKey.OptimalCharging,
            body =
                listOf(
                    InsightSegment(InsightBodyKey.OptimalChargingAvg, listOf(InsightArg.Raw("78"))),
                    InsightSegment(InsightBodyKey.OptimalChargingIdeal),
                ),
            trend = InsightTrend.Up,
            tone = DeltaTone.Good,
            severity = InsightSeverity.Success,
        ),
    )

@Preview(name = "InsightsEngine — content", showBackground = true)
@Composable
private fun InsightsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InsightsEngineContent(surface = InsightsSurface.Content(previewInsights(), InsightsFreshness.Fresh))
    }
}

@Preview(name = "InsightsEngine — stale content", showBackground = true)
@Composable
private fun InsightsStalePreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        InsightsEngineContent(surface = InsightsSurface.Content(previewInsights(), InsightsFreshness.Stale))
    }
}

@Preview(name = "InsightsEngine — empty", showBackground = true)
@Composable
private fun InsightsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InsightsEngineContent(surface = InsightsSurface.Empty)
    }
}

@Preview(name = "InsightsEngine — loading", showBackground = true)
@Composable
private fun InsightsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InsightsEngineContent(surface = InsightsSurface.Loading)
    }
}

@Preview(name = "InsightsEngine — offline failure", showBackground = true)
@Composable
private fun InsightsFailedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InsightsEngineContent(surface = InsightsSurface.Failed(offline = true))
    }
}
