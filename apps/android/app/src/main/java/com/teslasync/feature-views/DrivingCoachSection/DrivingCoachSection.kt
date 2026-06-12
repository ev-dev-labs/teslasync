// The native Jetpack Compose + Material 3 DrivingCoachSection feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx. The web component is one
// section of the Driving-Dynamics page: a fragment of six staggered FadeIn blocks — a bold "Driving Coach"
// title; a 1 / 3-column row of a `<RadialGauge>` score panel (+ "{count} drives analyzed"), a Style-Breakdown
// panel (a proportional bar + a three-row legend, or a friendly empty state), and an Efficiency panel (two
// `<StatCard>`s); a Weekly-Score-Trend `<LineChart>` (or an empty state under two weeks of data); a Driving-
// Patterns panel of five threshold-colored bars; a Recommendations list (impact-colored badges + tips, or an
// empty state); and a sortable, paginated Per-Drive-Scores `<DataTable>` (or an empty state).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10). The owning Driving-Dynamics page
// supplies the coach payload through the shared P1/S8 state-holder layer as a [UiState], so this feature view
// renders every lifecycle state that layer can carry — a first-load skeleton, a hard error with retry, the
// empty coach (zeros + the four internal empty states, never a blank box), the populated content, and stale /
// offline ("last known") via a freshness chip with auto-refresh — without ever fetching. A web-parity overload
// that takes the loaded value directly is also provided for hosts that already hold it. Every value derivation
// flows through the pure [DrivingCoachProjection]; the composable is a thin render layer.
//
// Parity-faithful units: like the web DrivingSection, the web DrivingCoachSection reads `efficiency_wh_km` /
// `r.efficiency` / `r.distance` WITHOUT `useUnits` and hard-labels them "Wh/km" / "km", so the projection
// bakes those literal suffixes exactly as the web template strings do (no SI -> display conversion).
//
// The entrance animations honor the reduced-motion preference (P1/S9, the shared `FadeIn` collapses to a
// static final state). Decorative glyphs (the stat-card icons, the recommendations bulb) are hidden from
// TalkBack — the adjacent text carries the meaning — and the gauge / chart expose their own accessible
// descriptions through the shared chart layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingCoachSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingcoachsection

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

// ── Layout + parity constants ─────────────────────────────────────────────────────────────────────

/** Web `<FadeIn delay={0.42}>` — the section heading, in milliseconds. */
private const val HEADING_DELAY_MS: Int = 420

/** Web `<FadeIn delay={0.43}>` — the score panel. */
private const val SCORE_DELAY_MS: Int = 430

/** Web `<FadeIn delay={0.44}>` — the style-breakdown panel. */
private const val STYLE_DELAY_MS: Int = 440

/** Web `<FadeIn delay={0.45}>` — the efficiency panel. */
private const val EFFICIENCY_DELAY_MS: Int = 450

/** Web `<FadeIn delay={0.46}>` — the weekly-trend panel. */
private const val TREND_DELAY_MS: Int = 460

/** Web `<FadeIn delay={0.47}>` — the patterns panel. */
private const val PATTERNS_DELAY_MS: Int = 470

/** Web `<FadeIn delay={0.48}>` — the recommendations panel. */
private const val RECOMMENDATIONS_DELAY_MS: Int = 480

/** Web `<FadeIn delay={0.49}>` — the per-drive-scores panel. */
private const val PER_DRIVE_DELAY_MS: Int = 490

/** Web Tailwind `lg` breakpoint (1024px): the score/style/efficiency row lays out three-per-row at/above this. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web `<RadialGauge size={160} />`. */
private val GAUGE_SIZE: Dp = 160.dp

/** Web `<ResponsiveContainer height={200}>` weekly-trend plot. */
private val TREND_HEIGHT: Dp = 200.dp

/** Web style-breakdown bar `h-4` (16px). */
private val STYLE_BAR_HEIGHT: Dp = 16.dp

/** Web legend dot `h-2 w-2` (8px). */
private val LEGEND_DOT_SIZE: Dp = 8.dp

/** Rows per page in the per-drive table (the web `<DataTable pagination>` default page size). */
private const val PER_DRIVE_PAGE_SIZE: Int = 10

/** Weekly-trend line series key (web `<Line dataKey="score">`). */
private const val TREND_SERIES_KEY: String = "score"

/** Below this leftover share the style bar has no track gap to draw. */
private const val STYLE_BAR_EPSILON: Float = 0.01f

/** Loading-skeleton geometry. */
private const val TITLE_SKELETON_WIDTH_FRACTION: Float = 0.4f
private val TITLE_SKELETON_HEIGHT: Dp = 24.dp
private val TILE_SKELETON_HEIGHT: Dp = 132.dp
private val PATTERN_SKELETON_HEIGHT: Dp = 28.dp
private val REC_SKELETON_HEIGHT: Dp = 56.dp
private const val SCORE_TILE_COUNT: Int = 3
private const val PATTERN_SKELETON_COUNT: Int = 5
private const val REC_SKELETON_COUNT: Int = 3

// ── Public entry points ───────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry point for the Driving Coach section. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared coach feed can carry. The host owns the feed (P1/S8)
 * and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [DrivingCoachData] this section reads (web prop).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param locale resolves the locale-grouped number/date formatting (web global locale).
 * @param zone resolves zoned per-drive timestamps to a local calendar day (web local-zone `toLocaleDateString`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingCoachSection(
    state: UiState<DrivingCoachData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DrivingCoachSectionDiagnostics.recordViewOpened(logger) }
    DrivingCoachSectionContent(state = state, onRetry = onRetry, modifier = modifier, locale = locale, zone = zone)
}

/**
 * Web-parity overload mirroring the web component's `coachData` prop, for hosts that already hold the loaded
 * value. A `null` value renders the empty coach (zeros + the four internal empty states); a present value
 * renders the populated section. Records `view.opened` like the stateful entry. There is no fetch behind it, so
 * it offers no retry affordance.
 */
@Composable
fun DrivingCoachSection(
    data: DrivingCoachData?,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            if (data == null) UiState(UiPhase.Empty) else UiState(UiPhase.Content, data = data)
        }
    DrivingCoachSection(state = state, onRetry = {}, modifier = modifier, locale = locale, zone = zone, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * section (the six staggered blocks) and adds the lifecycle chrome the host's feed implies: a first-load
 * skeleton, a hard-error retry surface, and a freshness chip that reflects refreshing / stale / offline. The
 * content branch projects `state.data ?: EMPTY`, so an empty coach still renders the full section (zeros + the
 * internal empty states), mirroring the web component, which always renders its body. Stale (non-error) data
 * auto-refreshes, mirroring the freshness contract.
 */
@Composable
fun DrivingCoachSectionContent(
    state: UiState<DrivingCoachData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    when {
        state.isLoading -> DrivingCoachLoading(modifier = modifier, label = stringResource(R.string.translation_a11y_loading))
        state.isError -> DrivingCoachError(modifier = modifier, onRetry = onRetry)
        else -> {
            val display =
                remember(state.data, locale, zone) {
                    DrivingCoachProjection.project(state.data ?: DrivingCoachData.EMPTY, locale, zone)
                }
            DrivingCoachBody(display = display, state = state, locale = locale, modifier = modifier)
        }
    }
}

// ── Section body ────────────────────────────────────────────────────────────────────────────────────

/**
 * The populated section — the faithful fragment of six staggered blocks, stacked with the page's vertical
 * rhythm. Always renders every block (each falls back to its own empty state when the coach has no data), so
 * the section is never a blank box. A freshness chip leads the stack when the feed is refreshing/stale/offline.
 */
@Composable
private fun DrivingCoachBody(
    display: DrivingCoachDisplay,
    state: UiState<DrivingCoachData>,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (state.stale || state.refreshing || state.hasError) {
            DrivingCoachFreshnessRow(state = state)
        }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = HEADING_DELAY_MS) {
            SectionTitle(stringResource(R.string.translation_dynamics_coach_title), modifier = Modifier.semantics { heading() })
        }
        ScoreStyleEfficiencyRow(display = display)
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = TREND_DELAY_MS) {
            WeeklyTrendPanel(display = display, locale = locale)
        }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = PATTERNS_DELAY_MS) {
            PatternsPanel(display = display)
        }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = RECOMMENDATIONS_DELAY_MS) {
            RecommendationsPanel(display = display)
        }
        FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = PER_DRIVE_DELAY_MS) {
            PerDriveScoresPanel(display = display)
        }
    }
}

/**
 * The web `grid grid-cols-1 gap-4 lg:grid-cols-3` row of the Score, Style-Breakdown and Efficiency panels.
 * Reflows from a single stacked column to three equal-width columns at the web `lg` (1024dp) breakpoint; each
 * panel keeps its own staggered FadeIn delay (web 0.43 / 0.44 / 0.45).
 */
@Composable
private fun ScoreStyleEfficiencyRow(
    display: DrivingCoachDisplay,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= GRID_LG_MIN_WIDTH) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                FadeIn(modifier = Modifier.weight(1f), delayMs = SCORE_DELAY_MS) { ScorePanel(display) }
                FadeIn(modifier = Modifier.weight(1f), delayMs = STYLE_DELAY_MS) { StyleBreakdownPanel(display) }
                FadeIn(modifier = Modifier.weight(1f), delayMs = EFFICIENCY_DELAY_MS) { EfficiencyPanel(display) }
            }
        } else {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = SCORE_DELAY_MS) { ScorePanel(display) }
                FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = STYLE_DELAY_MS) { StyleBreakdownPanel(display) }
                FadeIn(modifier = Modifier.fillMaxWidth(), delayMs = EFFICIENCY_DELAY_MS) { EfficiencyPanel(display) }
            }
        }
    }
}

/** The score panel — a centered `<RadialGauge>` over the localized "{count} drives analyzed" line. */
@Composable
private fun ScorePanel(
    display: DrivingCoachDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = display.scoreValue,
                max = SCORE_MAX,
                label = stringResource(R.string.translation_dynamics_coach_overallScore),
                color = coachToneColor(display.scoreTone),
                size = GAUGE_SIZE,
                decimals = display.scoreDecimals,
            )
            Caption(stringResource(R.string.translation_dynamics_coach_drivesAnalyzed, display.drivesAnalyzedCountText))
        }
    }
}

/** The style-breakdown panel — the proportional bar + three-row legend, or the friendly "drive more" empty state. */
@Composable
private fun StyleBreakdownPanel(
    display: DrivingCoachDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_dynamics_coach_styleBreakdown))
            if (display.hasStyleData) {
                StyleBar(segments = display.styleSegments)
                StyleLegend(rows = display.styleLegend)
            } else {
                EmptyState(message = stringResource(R.string.translation_dynamics_coach_noData), modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** The proportional style bar — colored segments over a track; decorative, the legend carries the meaning. */
@Composable
private fun StyleBar(
    segments: List<StyleSegment>,
    modifier: Modifier = Modifier,
) {
    val used = segments.fold(0f) { acc, segment -> acc + segment.weight }
    val remaining = PERCENT_AS_WEIGHT - used
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .height(STYLE_BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clearAndSetSemantics {},
    ) {
        segments.forEach { segment ->
            Box(modifier = Modifier.weight(segment.weight).fillMaxHeight().background(coachToneColor(segment.style.tone)))
        }
        if (remaining > STYLE_BAR_EPSILON) {
            Spacer(modifier = Modifier.weight(remaining).fillMaxHeight())
        }
    }
}

/** The three-row style legend — a colored dot + the capitalized category beside its colored count. */
@Composable
private fun StyleLegend(
    rows: List<StyleLegendRow>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        rows.forEach { row ->
            val color = coachToneColor(row.style.tone)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Box(modifier = Modifier.size(LEGEND_DOT_SIZE).clip(CircleShape).background(color))
                    Caption(capitalize(row.style.wireId))
                }
                BodyText(text = row.countText, color = color)
            }
        }
    }
}

/** The efficiency panel — two stat cards (Avg + Best), with the zap / shield-check stat icons. */
@Composable
private fun EfficiencyPanel(
    display: DrivingCoachDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringResource(R.string.translation_dynamics_coach_avgEfficiency),
                value = display.avgEfficiencyText,
                icon = DrivingCoachSectionGlyphs.Zap,
                modifier = Modifier.fillMaxWidth(),
            )
            StatCard(
                label = stringResource(R.string.translation_dynamics_coach_bestEfficiency),
                value = display.bestEfficiencyText,
                icon = DrivingCoachSectionGlyphs.ShieldCheck,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The weekly-trend panel — the score line chart, or the "need two weeks" empty state under two data points. */
@Composable
private fun WeeklyTrendPanel(
    display: DrivingCoachDisplay,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val seriesLabel = stringResource(R.string.translation_Score)
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_dynamics_coach_weeklyTrend))
            if (display.hasWeeklyTrend) {
                val color = TeslaTokens.status.success
                val series =
                    remember(display.weekScores, seriesLabel, color) {
                        listOf(
                            ChartSeries(
                                key = TREND_SERIES_KEY,
                                label = seriesLabel,
                                values = display.weekScores,
                                kind = ChartSeriesKind.Line,
                                color = color,
                            ),
                        )
                    }
                LineChartWrapper(
                    series = series,
                    xLabels = display.weekLabels,
                    height = TREND_HEIGHT,
                    yValueFormatter = { value -> DrivingCoachProjection.fmtInt(value, locale) },
                )
            } else {
                EmptyState(message = stringResource(R.string.translation_dynamics_coach_needWeeks), modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** The driving-patterns panel — five threshold-colored bars (web `MetricBar`-style indicators). */
@Composable
private fun PatternsPanel(
    display: DrivingCoachDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_dynamics_coach_patterns))
            display.patterns.forEach { pattern ->
                MetricBar(
                    value = pattern.valuePercent,
                    max = SCORE_MAX,
                    label = patternLabel(pattern.kind),
                    valueText = pattern.valueText,
                    color = coachToneColor(pattern.tone),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** The recommendations panel — the bulb title over the impact-colored tip list, or the empty state. */
@Composable
private fun RecommendationsPanel(
    display: DrivingCoachDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(
                    DrivingCoachSectionGlyphs.Lightbulb,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.warning,
                    modifier = Modifier.clearAndSetSemantics {},
                )
                PanelTitle(stringResource(R.string.translation_dynamics_coach_recommendations))
            }
            if (display.hasRecommendations) {
                display.recommendations.forEach { RecommendationItem(it) }
            } else {
                EmptyState(message = stringResource(R.string.translation_dynamics_coach_noRecs), modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** One recommendation row — an impact badge beside the tip body (web bordered inner card). */
@Composable
private fun RecommendationItem(
    rec: CoachRecommendationRow,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Badge(text = rec.impactLabel, variant = coachBadgeVariant(rec.tone))
            BodyText(text = rec.tip, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The per-drive-scores panel — the sortable, paginated data table, or the friendly empty state. */
@Composable
private fun PerDriveScoresPanel(
    display: DrivingCoachDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_dynamics_coach_perDriveScores))
            if (display.hasPerDriveScores) {
                PerDriveTable(rows = display.driveRows)
            } else {
                EmptyState(message = stringResource(R.string.translation_dynamics_coach_noDrives), modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** The sortable + paginated per-drive table — sort + page state hoisted here, projection-pure ordering applied. */
@Composable
private fun PerDriveTable(
    rows: List<CoachDriveRow>,
    modifier: Modifier = Modifier,
) {
    var sortState by remember { mutableStateOf(SortState()) }
    val sorted =
        remember(rows, sortState) {
            DrivingCoachProjection.sortDriveRows(rows, sortState.key, sortState.direction == SortDirection.Asc)
        }
    val total = sorted.size
    var page by remember(total) { mutableIntStateOf(1) }
    val visible =
        remember(sorted, page) {
            if (total == 0) {
                emptyList()
            } else {
                val bounds = PaginationMath.sliceBounds(page, PER_DRIVE_PAGE_SIZE, total)
                sorted.subList(bounds.first, bounds.last + 1)
            }
        }
    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            { PerDrivePagination(page = page, total = total, onPageChange = { page = it }) }
        } else {
            null
        }
    DataTable(
        columns = perDriveColumns(),
        rows = visible,
        keyOf = { it.driveId },
        modifier = modifier.fillMaxWidth(),
        sortState = sortState,
        onSortChange = { sortState = sortState.toggledBy(it) },
        emptyText = stringResource(R.string.translation_dynamics_coach_noDrives),
        footer = footer,
    )
}

/** The five web columns: Date, Score (badge), Style (badge), Wh/km, Distance — all sortable. */
@Composable
private fun perDriveColumns(): List<TableColumn<CoachDriveRow>> =
    listOf(
        TableColumn(key = SORT_KEY_DATE, header = stringResource(R.string.translation_Date), sortable = true) { row ->
            Caption(row.dateText)
        },
        TableColumn(key = SORT_KEY_SCORE, header = stringResource(R.string.translation_Score), sortable = true) { row ->
            Badge(text = row.scoreText, variant = coachBadgeVariant(row.scoreTone))
        },
        TableColumn(key = SORT_KEY_STYLE, header = stringResource(R.string.translation_Style), sortable = true) { row ->
            Badge(text = row.styleLabel, variant = coachBadgeVariant(row.styleTone))
        },
        TableColumn(key = SORT_KEY_EFFICIENCY, header = stringResource(R.string.translation_units_whkm), sortable = true) { row ->
            BodyText(row.efficiencyText)
        },
        TableColumn(key = SORT_KEY_DISTANCE, header = stringResource(R.string.translation_Distance), sortable = true) { row ->
            BodyText(row.distanceText)
        },
    )

/** The per-drive table pagination footer (web `<DataTable pagination>` controls). */
@Composable
private fun PerDrivePagination(
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val context = LocalContext.current
    Pagination(
        page = page,
        pageSize = PER_DRIVE_PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count -> context.getString(R.string.translation_pagination_showing, start, end, count) },
    )
}

// ── Lifecycle chrome ──────────────────────────────────────────────────────────────────────────────

/** First-load skeleton — a title bar over skeleton stand-ins for each of the six section blocks. */
@Composable
private fun DrivingCoachLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Skeleton(widthFraction = TITLE_SKELETON_WIDTH_FRACTION, height = TITLE_SKELETON_HEIGHT)
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                repeat(SCORE_TILE_COUNT) {
                    Box(modifier = Modifier.weight(1f)) { Skeleton(height = TILE_SKELETON_HEIGHT) }
                }
            }
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Skeleton(widthFraction = TITLE_SKELETON_WIDTH_FRACTION, height = TITLE_SKELETON_HEIGHT)
                ChartBlockSkeleton(height = TREND_HEIGHT)
            }
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Skeleton(widthFraction = TITLE_SKELETON_WIDTH_FRACTION, height = TITLE_SKELETON_HEIGHT)
                repeat(PATTERN_SKELETON_COUNT) { Skeleton(height = PATTERN_SKELETON_HEIGHT) }
            }
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Skeleton(widthFraction = TITLE_SKELETON_WIDTH_FRACTION, height = TITLE_SKELETON_HEIGHT)
                repeat(REC_SKELETON_COUNT) { Skeleton(height = REC_SKELETON_HEIGHT) }
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DrivingCoachError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip shown above the section when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun DrivingCoachFreshnessRow(
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberCoachFreshnessFormatter(),
        )
    }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberCoachFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> DRIVING_COACH_EM_DASH
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

// ── Small mappers ───────────────────────────────────────────────────────────────────────────────────

/** Whole percent as a relative bar weight — the style-bar track is 100 weight units wide. */
private const val PERCENT_AS_WEIGHT: Float = 100f

/** Maps a semantic [CoachTone] onto its status token (never a raw hex in render code). */
@Composable
private fun coachToneColor(tone: CoachTone): Color =
    when (tone) {
        CoachTone.Success -> TeslaTokens.status.success
        CoachTone.Warning -> TeslaTokens.status.warning
        CoachTone.Danger -> TeslaTokens.status.danger
    }

/** Maps a semantic [CoachTone] onto the shared [BadgeVariant]. */
private fun coachBadgeVariant(tone: CoachTone): BadgeVariant =
    when (tone) {
        CoachTone.Success -> BadgeVariant.Success
        CoachTone.Warning -> BadgeVariant.Warning
        CoachTone.Danger -> BadgeVariant.Danger
    }

/** Resolves a pattern kind to its localized label (web `t('dynamics.coach.{key}', …)`). */
@Composable
private fun patternLabel(kind: CoachPatternKind): String =
    when (kind) {
        CoachPatternKind.HardAccel -> stringResource(R.string.translation_dynamics_coach_hardAccel)
        CoachPatternKind.HardBrake -> stringResource(R.string.translation_dynamics_coach_hardBrake)
        CoachPatternKind.Highway -> stringResource(R.string.translation_dynamics_coach_highway)
        CoachPatternKind.ShortTrips -> stringResource(R.string.translation_dynamics_coach_shortTrips)
        CoachPatternKind.ColdStarts -> stringResource(R.string.translation_dynamics_coach_coldStarts)
    }

/** Capitalizes a data category identifier for display (web legend `capitalize` over the raw style key). */
private fun capitalize(value: String): String =
    value.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_DATA =
    DrivingCoachData(
        overallScore = 82.0,
        efficiencyWhKm = 168.4,
        bestEfficiencyWhKm = 152.1,
        totalDrivesAnalyzed = 37.0,
        styleBreakdown = mapOf("efficient" to 20.0, "moderate" to 12.0, "aggressive" to 5.0),
        patterns =
            CoachPatterns(
                hardAccelPct = 18.0,
                hardBrakePct = 22.0,
                highwayPct = 61.0,
                shortTripPct = 44.0,
                coldStartPct = 9.0,
            ),
        weeklyTrend =
            listOf(
                CoachWeeklyTrend(week = "W1", score = 71.0),
                CoachWeeklyTrend(week = "W2", score = 78.0),
                CoachWeeklyTrend(week = "W3", score = 82.0),
            ),
        recommendations =
            listOf(
                CoachRecommendation(
                    category = "braking",
                    impact = "high",
                    tip = "Brake earlier and more gradually to recover more energy.",
                ),
                CoachRecommendation(category = "trips", impact = "low", tip = "Combine short errands into a single longer drive."),
            ),
        perDriveScores =
            listOf(
                CoachDriveScore(driveId = 1, date = "2026-03-14", score = 88.0, style = "efficient", efficiency = 151.2, distance = 42.6),
                CoachDriveScore(driveId = 2, date = "2026-03-12", score = 64.0, style = "moderate", efficiency = 178.9, distance = 12.1),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DrivingCoachSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingCoachSectionContent(state = UiState(UiPhase.Loading), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DrivingCoachSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingCoachSectionContent(state = UiState(UiPhase.Empty), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DrivingCoachSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingCoachSectionContent(state = UiState(UiPhase.Error), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun DrivingCoachSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingCoachSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
        )
    }
}
