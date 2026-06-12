// The native Jetpack Compose + Material 3 DrivingSection feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/DrivingSection.tsx. The web component is one section of
// the Weekly Digest: a `<GlassPanel>` (space-y-6 p-6) holding a bold "Driving" title with a car glyph, an
// inner panel with a Daily-Distance `<BarChart>` (height 260, or a friendly empty state when the week has no
// distance), a responsive 1 / 2 / 4-column row of four `MiniStat`s (Avg Efficiency, Total Driving Time,
// Efficiency Change, Drives), and an inner Top-Drive panel (a "Top Drive" success badge + a 2 / 4-column grid
// of Date / Distance / Duration / Efficiency, or a friendly empty state when the week has no top drive). The
// whole section fades in (web `<FadeIn delay={0.1}>`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The owning Weekly-Digest page supplies the
// metrics + daily-distance bars through the shared P1/S8 state-holder layer as a [UiState], so this feature
// view renders every lifecycle state that layer can carry — a first-load skeleton, a hard error with retry,
// the empty week (zeros + the two internal empty states, never a blank box), the populated content, and
// stale / offline ("last known") via a freshness chip with auto-refresh — without ever fetching. A web-parity
// overload that takes the loaded value directly is also provided for hosts that already hold it. Every value
// derivation flows through the pure [DrivingSectionProjection]; the composable is a thin render layer.
//
// Parity-faithful units: the web component reads `metrics.avgEfficiency` / `topDrive.distance` /
// `topDrive.efficiency_wh_km` WITHOUT `useUnits` and hard-labels them "Wh/km" / "km", so this port does the
// same — no SI → display conversion (the projection bakes the literal unit suffixes exactly as the web
// template strings do). The trend glyph mirrors the web icon choice: lower Wh/km is better, so an improved
// week shows `TrendingDown` in the success color and a worsened week shows `TrendingUp` in the danger color.
//
// The entrance animation honors the reduced-motion preference (P1/S9, the shared `FadeIn` collapses to a
// static final state). Decorative glyphs (the title car, the mini-stat icons) are hidden from TalkBack — the
// adjacent text carries the meaning — and the bar chart exposes its accessible fallback through the shared
// chart layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingsection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

// ── Layout + parity constants ─────────────────────────────────────────────────────────────────────

/** Web `<FadeIn delay={0.1}>` — 0.1s, in milliseconds. */
private const val SECTION_FADE_DELAY_MS: Int = 100

/** Web `<ResponsiveContainer height={260}>` Daily-Distance bar plot. */
private val BAR_HEIGHT: Dp = 260.dp

/** Web `CHART_COLORS[0]` — the Daily-Distance bar fill, resolved from the brand palette by position. */
private const val BAR_COLOR_INDEX: Int = 0

/** Bar series key; the y-axis uses integer ticks (web `tickFormatter={(v) => fmtInt(v)}`). */
private const val DISTANCE_SERIES_KEY: String = "distance"

/** Web Tailwind `lg` breakpoint (1024px): the mini-stat row lays out four-per-row at or above this width. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): two-per-row (mini-stats) / four-per-row (top-drive) above this. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val MINI_STATS_COLUMNS_LG: Int = 4
private const val MINI_STATS_COLUMNS_SM: Int = 2
private const val MINI_STATS_COLUMNS_BASE: Int = 1
private const val TOP_DRIVE_COLUMNS_WIDE: Int = 4
private const val TOP_DRIVE_COLUMNS_NARROW: Int = 2

/** Loading-skeleton bar geometry. */
private val TITLE_SKELETON_HEIGHT: Dp = 24.dp
private const val TITLE_SKELETON_WIDTH_FRACTION: Float = 0.4f
private val STAT_SKELETON_HEIGHT: Dp = 64.dp
private val TOP_DRIVE_SKELETON_HEIGHT: Dp = 72.dp

// ── Public entry points ───────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry point for the Driving section. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared Weekly-Digest feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the digest metrics + daily-distance bars (web props).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param locale resolves the locale-grouped number/date formatting (web global locale).
 * @param zone resolves zoned top-drive timestamps to a local calendar day (web local-zone `toLocaleDateString`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingSection(
    state: UiState<DrivingSectionData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DrivingSectionDiagnostics.recordViewOpened(logger) }
    DrivingSectionContent(state = state, onRetry = onRetry, modifier = modifier, locale = locale, zone = zone)
}

/**
 * Web-parity overload mirroring the web component's `metrics` + `dailyDistanceData` props, for hosts that
 * already hold the loaded value. A `null` value renders the empty week (zeros + the two internal empty
 * states); a present value renders the populated section. Records `view.opened` like the stateful entry.
 * There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun DrivingSection(
    data: DrivingSectionData?,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            if (data == null) UiState(UiPhase.Empty) else UiState(UiPhase.Content, data = data)
        }
    DrivingSection(state = state, onRetry = {}, modifier = modifier, locale = locale, zone = zone, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * section (title, Daily-Distance chart, mini-stats, Top-Drive card) and adds the lifecycle chrome the host's
 * feed implies: a first-load skeleton, a hard-error retry surface, and a freshness chip that reflects
 * refreshing / stale / offline. The content branch projects `state.data ?: EMPTY`, so an empty week still
 * renders the full section (zeros + the internal empty states), mirroring the web component, which always
 * renders its body. Stale (non-error) data auto-refreshes, mirroring the freshness contract.
 */
@Composable
fun DrivingSectionContent(
    state: UiState<DrivingSectionData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier, delayMs = SECTION_FADE_DELAY_MS) {
        when {
            state.isLoading -> DrivingSectionLoading(label = stringResource(R.string.translation_a11y_loading))
            state.isError -> DrivingSectionError(onRetry = onRetry)
            else -> {
                val display =
                    remember(state.data, locale, zone) {
                        DrivingSectionProjection.project(state.data ?: DrivingSectionData.EMPTY, locale, zone)
                    }
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    if (state.stale || state.refreshing || state.hasError) {
                        DrivingFreshnessRow(state = state)
                    }
                    DrivingSectionBody(display = display, locale = locale)
                }
            }
        }
    }
}

// ── Section body ────────────────────────────────────────────────────────────────────────────────────

/**
 * The populated section — the faithful `<GlassPanel className="space-y-6 p-6">`: the "Driving" title, the
 * Daily-Distance chart panel, the four mini-stats, and the Top-Drive panel, stacked with the web `space-y-6`
 * rhythm. Always renders every block (the chart and the top drive fall back to their own empty states when
 * the week has no data), so the section is never a blank box.
 */
@Composable
private fun DrivingSectionBody(
    display: DrivingSectionDisplay,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            DrivingSectionTitle()
            DailyDistancePanel(display = display, locale = locale)
            DrivingMiniStats(display = display)
            TopDrivePanel(topDrive = display.topDrive)
        }
    }
}

/** The "Driving" title row — the web `<span class="flex items-center gap-2 …"><Car …neon-cyan/> Driving`. */
@Composable
private fun DrivingSectionTitle(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DrivingSectionGlyphs.Car,
            contentDescription = null,
            size = IconSize.Lg,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clearAndSetSemantics {},
        )
        SectionTitle(stringResource(R.string.translation_analytics_weeklyDigest_drivingSection))
    }
}

/**
 * The Daily-Distance panel — an inner `<GlassPanel>` with the "Daily Distance (km)" caption over the bar
 * chart. Mirrors the web `dailyDistanceData.length > 0 ? <BarChart> : <EmptyState>` branch: a populated week
 * draws the shared [BarChartWrapper] (integer y ticks like the web `fmtInt`), an empty week shows the
 * localized "No driving distance data…" empty state, so the panel is never blank.
 */
@Composable
private fun DailyDistancePanel(
    display: DrivingSectionDisplay,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val seriesLabel = stringResource(R.string.translation_analytics_weeklyDigest_distance)
    val emptyMessage = stringResource(R.string.translation_analytics_weeklyDigest_noDailyDistance)
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Caption(stringResource(R.string.translation_analytics_weeklyDigest_dailyDistance))
            if (display.hasDailyDistance) {
                val color = paletteColor(BAR_COLOR_INDEX)
                val series =
                    remember(display.dailyDistance, seriesLabel, color) {
                        listOf(
                            ChartSeries(
                                key = DISTANCE_SERIES_KEY,
                                label = seriesLabel,
                                values = display.distanceValues,
                                kind = ChartSeriesKind.Bar,
                                color = color,
                            ),
                        )
                    }
                BarChartWrapper(
                    series = series,
                    xLabels = display.dayLabels,
                    height = BAR_HEIGHT,
                    yValueFormatter = { value -> DrivingSectionProjection.fmtInt(value, locale) },
                    emptyMessage = emptyMessage,
                )
            } else {
                EmptyState(message = emptyMessage, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * The four driving mini-stats — the web `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">` of
 * Avg Efficiency / Total Driving Time / Efficiency Change / Drives. The grid reflows at the web `sm` (640dp)
 * and `lg` (1024dp) breakpoints. The Efficiency-Change icon + color track the trend (web emerald `TrendingDown`
 * when improved, red `TrendingUp` when worsened); the other three use the muted icon tint.
 */
@Composable
private fun DrivingMiniStats(
    display: DrivingSectionDisplay,
    modifier: Modifier = Modifier,
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val improved = display.efficiencyTrend == EfficiencyTrend.Improved
    val trendIcon = if (improved) DataDisplayGlyphs.TrendingDown else DrivingSectionGlyphs.TrendingUp
    val trendColor = if (improved) TeslaTokens.status.success else TeslaTokens.status.danger
    val items =
        listOf(
            MiniStatItem(
                label = stringResource(R.string.translation_analytics_weeklyDigest_avgEfficiency),
                value = display.avgEfficiency,
                icon = DrivingSectionGlyphs.BarChart,
                tint = muted,
            ),
            MiniStatItem(
                label = stringResource(R.string.translation_analytics_weeklyDigest_totalDrivingTime),
                value = display.totalDrivingTime,
                icon = DataDisplayGlyphs.Clock,
                tint = muted,
            ),
            MiniStatItem(
                label = stringResource(R.string.translation_analytics_weeklyDigest_efficiencyChange),
                value = display.efficiencyChange,
                icon = trendIcon,
                tint = trendColor,
            ),
            MiniStatItem(
                label = stringResource(R.string.translation_analytics_weeklyDigest_drivesCount),
                value = display.drives,
                icon = DrivingSectionGlyphs.Activity,
                tint = muted,
            ),
        )
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> MINI_STATS_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> MINI_STATS_COLUMNS_SM
                else -> MINI_STATS_COLUMNS_BASE
            }
        ResponsiveGrid(rows = items.chunked(columns), columns = columns) { item ->
            MiniStat(item = item, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** One driving mini-stat: an icon beside a stacked label + value, in a `<GlassPanel>` (web `MiniStat`). */
@Composable
private fun MiniStat(
    item: MiniStatItem,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                item.icon,
                contentDescription = null,
                size = IconSize.Sm,
                tint = item.tint,
                modifier = Modifier.clearAndSetSemantics {},
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(item.label)
                Text(
                    text = item.value,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

/**
 * The Top-Drive panel — an inner `<GlassPanel>` mirroring the web `metrics.topDrive ? <card> : <EmptyState>`
 * branch: a present top drive renders the "Top Drive" success badge over a 2 / 4-column grid of Date /
 * Distance / Duration / Efficiency; an absent one shows the localized "No top drive…" empty state, so the
 * panel is never blank.
 */
@Composable
private fun TopDrivePanel(
    topDrive: TopDriveDisplay?,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        if (topDrive == null) {
            EmptyState(
                message = stringResource(R.string.translation_analytics_weeklyDigest_noTopDrive),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Badge(
                    text = stringResource(R.string.translation_analytics_weeklyDigest_topDrive),
                    variant = BadgeVariant.Success,
                )
                TopDriveFields(topDrive = topDrive)
            }
        }
    }
}

/** The Date / Distance / Duration / Efficiency fields of the Top-Drive card (web `grid-cols-2 sm:grid-cols-4`). */
@Composable
private fun TopDriveFields(
    topDrive: TopDriveDisplay,
    modifier: Modifier = Modifier,
) {
    val fields =
        listOf(
            TopDriveFieldItem(stringResource(R.string.translation_analytics_weeklyDigest_date), topDrive.date),
            TopDriveFieldItem(
                stringResource(R.string.translation_analytics_weeklyDigest_distance),
                topDrive.distance,
            ),
            TopDriveFieldItem(
                stringResource(R.string.translation_analytics_weeklyDigest_duration),
                topDrive.duration,
            ),
            TopDriveFieldItem(
                stringResource(R.string.translation_analytics_weeklyDigest_efficiency),
                topDrive.efficiency,
            ),
        )
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) TOP_DRIVE_COLUMNS_WIDE else TOP_DRIVE_COLUMNS_NARROW
        ResponsiveGrid(rows = fields.chunked(columns), columns = columns) { field ->
            TopDriveField(field = field, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** One Top-Drive field: a muted label over a semibold value (web `text-xs text-secondary` + `font-semibold`). */
@Composable
private fun TopDriveField(
    field: TopDriveFieldItem,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(field.label)
        Text(
            text = field.value,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

// ── Lifecycle chrome ──────────────────────────────────────────────────────────────────────────────

/** First-load skeleton — title bar, chart block, four stat tiles, and a top-drive bar, in a `<GlassPanel>`. */
@Composable
private fun DrivingSectionLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        padding = PanelPadding.Lg,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Skeleton(widthFraction = TITLE_SKELETON_WIDTH_FRACTION, height = TITLE_SKELETON_HEIGHT)
            ChartBlockSkeleton(height = BAR_HEIGHT)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
                repeat(MINI_STATS_COLUMNS_LG) {
                    Box(modifier = Modifier.weight(1f)) {
                        Skeleton(height = STAT_SKELETON_HEIGHT)
                    }
                }
            }
            Skeleton(height = TOP_DRIVE_SKELETON_HEIGHT)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DrivingSectionError(
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
private fun DrivingFreshnessRow(
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberDrivingFreshnessFormatter(),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDrivingFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> DRIVING_SECTION_EM_DASH
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

// ── Small responsive grid + item holders ────────────────────────────────────────────────────────────

/**
 * A simple equal-width responsive grid: lays [rows] (already chunked to [columns] items each) as a column of
 * rows, each cell taking an equal weight, padding the final partial row so cells keep their width. The web
 * Tailwind `grid` analogue used by the mini-stats and the Top-Drive fields.
 */
@Composable
private fun <T> ResponsiveGrid(
    rows: List<List<T>>,
    columns: Int,
    modifier: Modifier = Modifier,
    itemContent: @Composable (T) -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        rows.forEach { rowItems ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                rowItems.forEach { item ->
                    Box(modifier = Modifier.weight(1f)) { itemContent(item) }
                }
                repeat(columns - rowItems.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/** Render model for one mini-stat tile (label + value + icon + already-resolved icon tint). */
private data class MiniStatItem(
    val label: String,
    val value: String,
    val icon: ImageVector,
    val tint: Color,
)

/** Render model for one Top-Drive field (label + value). */
private data class TopDriveFieldItem(
    val label: String,
    val value: String,
)

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_DATA =
    DrivingSectionData(
        avgEfficiency = 168.4,
        prevAvgEfficiency = 175.0,
        totalDuration = 372.0,
        totalDrives = 14.0,
        topDrive =
            DrivingTopDrive(
                startDate = "2026-03-14",
                distance = 182.6,
                durationMin = 145.0,
                efficiencyWhKm = 158.2,
            ),
        dailyDistanceData =
            listOf(
                DailyDistanceEntry("Mon", 42.0),
                DailyDistanceEntry("Tue", 18.5),
                DailyDistanceEntry("Wed", 0.0),
                DailyDistanceEntry("Thu", 64.2),
                DailyDistanceEntry("Fri", 31.7),
                DailyDistanceEntry("Sat", 120.4),
                DailyDistanceEntry("Sun", 12.0),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DrivingSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingSectionContent(state = UiState(UiPhase.Loading), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DrivingSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingSectionContent(state = UiState(UiPhase.Empty), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DrivingSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun DrivingSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun DrivingSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
        )
    }
}
