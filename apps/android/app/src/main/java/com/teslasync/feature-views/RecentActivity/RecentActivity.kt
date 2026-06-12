// The native Jetpack Compose + Material 3 RecentActivity feature view — a parity port of
// web/src/features/dashboard/components/RecentActivity.tsx. The web component is purely presentational: its
// parent passes `recentDrives` / `recentCharges` / `analytics` (plus the unit props) and it composes three
// panels — a unified activity feed, a battery-percent area trend, and a fleet-performance stat block.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hooks are `useTranslation`, mapped to the i18n catalog, and `useFormatting`, mapped to the shared
// `UnitFormatter` + the currency preferences resolved from `/settings`). The host supplies the payload
// through the shared P1/S8 state-holder layer as a [UiState], so this feature view also renders every
// lifecycle state that layer can carry — loading chrome, hard error with retry, content, empty, and
// stale/offline (cached "last known") — without ever fetching. Two entry points are offered: a stateful one
// bound to a `UiState<RecentActivityData>` feed and a web-parity overload that takes the resolved payload
// exactly like the web component's props.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RecentActivity — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentactivity

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.Timeline
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.time.ZoneId
import java.util.Locale

/** Plot height for the battery trend — the web `h-36 sm:h-48`. */
private val CHART_HEIGHT: Dp = 160.dp

/** Container width at/above which the three panels lay out side by side instead of stacked. */
private val WIDE_LAYOUT_MIN_WIDTH: Dp = 720.dp

/** Drive distance precision — the web `fmtNumber(convertDistanceFromSI(...), 1)`. */
private const val DISTANCE_PRECISION: Int = 1

/** Charge energy precision — the web `fmtNumber(convertEnergyFromSI(..., 'kWh'), 1)`. */
private const val ENERGY_PRECISION: Int = 1

/** Whole-number precision for the CO2 + efficiency stats — the web `fmtInt`. */
private const val INTEGER_DECIMALS: Int = 0

/** Efficiency unit symbol — the web `efficiencyUnit` (SI-canonical Wh/km display). */
private const val EFFICIENCY_UNIT_SUFFIX: String = " Wh/km"

/** The single battery-percent area series key. */
private const val BATTERY_SERIES_KEY: String = "soc"

private const val ACTIVITY_SKELETON_ROWS: Int = 3
private const val PERF_SKELETON_ROWS: Int = 4
private const val SKELETON_TITLE_FRACTION: Float = 0.5f
private const val SKELETON_ROW_FRACTION: Float = 0.85f
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private val SKELETON_ROW_HEIGHT: Dp = 14.dp

private const val MOST_EFFICIENT_BG_ALPHA: Float = 0.08f
private const val MOST_EFFICIENT_BORDER_ALPHA: Float = 0.2f
private val MOST_EFFICIENT_BORDER_WIDTH: Dp = 1.dp

/**
 * Stateful entry point bound to the host's RecentActivity feed. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), reads the live currency/precision/locale (the native binding of `useFormatting`/
 * `useSettings`) and the live display [UnitFormatter] (`useUnits`) from the shared S8 layer, and renders
 * every lifecycle [state] the feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the
 * feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [RecentActivityData].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onViewAllDrives the activity feed's "View all" affordance (web `<Link to="/drives">`).
 * @param settings the shared live `/settings` feed backing the currency symbol + precision + locale.
 * @param unitFormatterFlow the shared live SI -> display formatter (web `useUnits`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RecentActivity(
    state: UiState<RecentActivityData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onViewAllDrives: () -> Unit = {},
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    unitFormatterFlow: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordRecentActivityOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val unitFormatter by unitFormatterFlow.collectAsStateWithLifecycle()
    val display = remember(settingsResource.cached) { RecentActivityDisplay.from(settingsResource.cached) }
    RecentActivityContent(
        state = state,
        onRetry = onRetry,
        onViewAllDrives = onViewAllDrives,
        modifier = modifier,
        display = display,
        unitFormatter = unitFormatter,
    )
}

/**
 * Web-parity overload mirroring the web component's `({ recentDrives, recentCharges, analytics, ... })`
 * props, for hosts that already hold the resolved payload. A `null`/empty payload renders the content grid
 * with each panel's own empty branch (web parity — the grid never collapses to a single blank), classified
 * as the empty phase. Records `view.opened` like the stateful entry; there is no fetch behind it, so it
 * offers no retry affordance.
 */
@Composable
fun RecentActivity(
    data: RecentActivityData?,
    modifier: Modifier = Modifier,
    onViewAllDrives: () -> Unit = {},
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    unitFormatterFlow: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            val payload = data ?: RecentActivityData()
            val phase = if (isEmptyPayload(payload)) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = payload)
        }
    RecentActivity(
        state = state,
        onRetry = {},
        modifier = modifier,
        onViewAllDrives = onViewAllDrives,
        settings = settings,
        unitFormatterFlow = unitFormatterFlow,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip is
 * shown above the grid when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes,
 * mirroring the shared cache-then-network freshness contract. Inside it switches between the loading
 * skeleton grid, a hard-error retry surface, and the resolved three-panel grid (whose panels reproduce the
 * web component's own empty branches), so the surface never blanks. [display]/[unitFormatter] format the
 * money/units; [nowMillis]/[zoneId] resolve each activity row's relative timestamp.
 */
@Composable
fun RecentActivityContent(
    state: UiState<RecentActivityData>,
    onRetry: () -> Unit,
    onViewAllDrives: () -> Unit,
    modifier: Modifier = Modifier,
    display: RecentActivityDisplay = RecentActivityDisplay.DEFAULT,
    unitFormatter: UnitFormatter = UnitFormatter.default(),
    nowMillis: Long = System.currentTimeMillis(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: RecentActivityUiStrings = rememberRecentActivityUiStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val isDegraded = state.stale || state.refreshing || state.hasError
    FadeIn(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (state.data != null && isDegraded) {
                RecentActivityFreshnessRow(state = state)
            }
            when {
                state.isLoading -> RecentActivityLoading()
                state.isError -> RecentActivityError(onRetry = onRetry)
                else -> {
                    val formatters = remember(unitFormatter, display) { buildFormatters(unitFormatter, display) }
                    val projectionStrings = remember(strings) { strings.toProjectionStrings() }
                    val result =
                        remember(state.data, formatters, projectionStrings) {
                            RecentActivityProjection.project(state.data, formatters, projectionStrings)
                        }
                    RecentActivityGrid(
                        result = result,
                        strings = strings,
                        onViewAllDrives = onViewAllDrives,
                        nowMillis = nowMillis,
                        zoneId = zoneId,
                        locale = display.locale,
                    )
                }
            }
        }
    }
}

/** The three-panel grid — side by side when wide, stacked otherwise, mirroring the web responsive grid. */
@Composable
private fun RecentActivityGrid(
    result: RecentActivityProjectionResult,
    strings: RecentActivityUiStrings,
    onViewAllDrives: () -> Unit,
    nowMillis: Long,
    zoneId: ZoneId,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val relativeFormatter = rememberRelativeTimeFormatter(zoneId, locale)
    PanelLayout(
        modifier = modifier,
        first = { panelModifier ->
            ActivityFeedPanel(
                result = result,
                strings = strings,
                onViewAllDrives = onViewAllDrives,
                relativeFormatter = relativeFormatter,
                nowMillis = nowMillis,
                modifier = panelModifier,
            )
        },
        second = { panelModifier ->
            BatteryTrendPanel(result = result, strings = strings, locale = locale, modifier = panelModifier)
        },
        third = { panelModifier ->
            FleetPerformancePanel(result = result, strings = strings, modifier = panelModifier)
        },
    )
}

/** Adaptive holder for the three panels: a weighted [Row] when wide, a spaced [Column] otherwise. */
@Composable
private fun PanelLayout(
    modifier: Modifier = Modifier,
    first: @Composable (Modifier) -> Unit,
    second: @Composable (Modifier) -> Unit,
    third: @Composable (Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= WIDE_LAYOUT_MIN_WIDTH) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                first(Modifier.weight(1f))
                second(Modifier.weight(1f))
                third(Modifier.weight(1f))
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                first(Modifier.fillMaxWidth())
                second(Modifier.fillMaxWidth())
                third(Modifier.fillMaxWidth())
            }
        }
    }
}

/** The unified activity feed — the web `<GlassPanel>` with the `<Timeline>` or the empty state. */
@Composable
private fun ActivityFeedPanel(
    result: RecentActivityProjectionResult,
    strings: RecentActivityUiStrings,
    onViewAllDrives: () -> Unit,
    relativeFormatter: (Long, Long) -> String,
    nowMillis: Long,
    modifier: Modifier = Modifier,
) {
    val driveAccent = TeslaTokens.status.info
    val chargeAccent = TeslaTokens.status.success
    GlassPanel(modifier = modifier) {
        PanelHeader(
            icon = RecentActivityGlyphs.Activity,
            iconTint = driveAccent,
            title = strings.activityTitle,
            trailing = { Button(label = strings.viewAll, onClick = onViewAllDrives, variant = ButtonVariant.Ghost, size = ButtonSize.Sm) },
        )
        Spacer(Modifier.height(Spacing.sm))
        if (result.hasActivity) {
            val entries =
                result.activityRows.map { row ->
                    TimelineEntry(
                        title = row.title,
                        time = relativeFormatter(row.timeMillis, nowMillis),
                        subtitle = row.subtitle,
                        icon = if (row.kind == ActivityKind.Drive) RecentActivityGlyphs.Route else DataDisplayGlyphs.Bolt,
                        accent = if (row.kind == ActivityKind.Drive) driveAccent else chargeAccent,
                    )
                }
            Timeline(
                items = entries,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.activityTitle },
            )
        } else {
            EmptyState(
                message = strings.activityEmpty,
                icon = DataDisplayGlyphs.Clock,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The battery-percent area trend — the web `<GlassPanel>` with the `<AreaChartWrapper>` or its empty state. */
@Composable
private fun BatteryTrendPanel(
    result: RecentActivityProjectionResult,
    strings: RecentActivityUiStrings,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val seriesColor = TeslaTokens.chart.battery
    GlassPanel(modifier = modifier) {
        PanelHeader(
            icon = DataDisplayGlyphs.BatteryCharging,
            iconTint = seriesColor,
            title = strings.batteryTitle,
        )
        Spacer(Modifier.height(Spacing.sm))
        if (result.hasBatteryTrend) {
            val series =
                remember(result.batteryValues, strings.batteryTitle, seriesColor) {
                    listOf(
                        ChartSeries(
                            key = BATTERY_SERIES_KEY,
                            label = strings.batteryTitle,
                            values = result.batteryValues,
                            kind = ChartSeriesKind.Area,
                            color = seriesColor,
                        ),
                    )
                }
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(CHART_HEIGHT)
                        .semantics { contentDescription = strings.batteryTitle },
            ) {
                AreaChartWrapper(
                    series = series,
                    xLabels = result.batteryLabels,
                    height = CHART_HEIGHT,
                    yValueFormatter = { value -> percentLabel(value, locale) },
                    emptyMessage = strings.batteryEmpty,
                )
            }
        } else {
            Box(
                modifier = Modifier.fillMaxWidth().height(CHART_HEIGHT),
                contentAlignment = Alignment.Center,
            ) {
                Caption(strings.batteryEmpty)
            }
        }
    }
}

/** The fleet-performance stat block — the web `<GlassPanel>` with the four stats + most-efficient callout. */
@Composable
private fun FleetPerformancePanel(
    result: RecentActivityProjectionResult,
    strings: RecentActivityUiStrings,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        PanelHeader(
            icon = RecentActivityGlyphs.TrendingUp,
            iconTint = TeslaTokens.chart.power,
            title = strings.perfTitle,
        )
        Spacer(Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatRow(label = strings.perfDrives, value = result.totalDrivesText)
            StatRow(label = strings.perfCharges, value = result.totalChargesText)
            StatRow(label = strings.perfCost, value = result.totalCostText, valueColor = TeslaTokens.status.warning)
            StatRow(label = strings.perfCo2, value = result.co2SavedText, valueColor = TeslaTokens.status.success)
            val efficientName = result.mostEfficientName
            if (efficientName != null) {
                MostEfficientCard(
                    label = strings.perfMostEfficient,
                    name = efficientName,
                    efficiency = result.mostEfficientEfficiencyText,
                )
            }
        }
    }
}

/** A panel header row: a tinted decorative glyph, the title, and an optional [trailing] action. */
@Composable
private fun PanelHeader(
    icon: ImageVector,
    iconTint: Color,
    title: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = iconTint)
        PanelTitle(text = title, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** One label/value performance row — the muted label on the left, the emphasized value on the right. */
@Composable
private fun StatRow(
    label: String,
    value: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(text = label, modifier = Modifier.weight(1f))
        StatValueText(text = value, color = valueColor)
    }
}

/** The most-efficient vehicle callout — a success-tinted card with the label, name, and efficiency line. */
@Composable
private fun MostEfficientCard(
    label: String,
    name: String,
    efficiency: String?,
    modifier: Modifier = Modifier,
) {
    val accent = TeslaTokens.status.success
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(accent.copy(alpha = MOST_EFFICIENT_BG_ALPHA))
                .border(MOST_EFFICIENT_BORDER_WIDTH, accent.copy(alpha = MOST_EFFICIENT_BORDER_ALPHA), RoundedCornerShape(Radius.md))
                .padding(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(text = label)
        StatValueText(text = name, color = accent)
        if (efficiency != null) HelperText(text = efficiency)
    }
}

/** An emphasized stat value — the bold, optionally accent-colored counterpart of the web `font-bold` span. */
@Composable
private fun StatValueText(
    text: String,
    color: Color,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
        color = color,
    )
}

/** The loading skeleton grid — the three panels as skeleton chrome so the surface never blanks. */
@Composable
private fun RecentActivityLoading(modifier: Modifier = Modifier) {
    PanelLayout(
        modifier = modifier,
        first = { panelModifier -> SkeletonRowsPanel(rowCount = ACTIVITY_SKELETON_ROWS, modifier = panelModifier) },
        second = { panelModifier -> SkeletonChartPanel(modifier = panelModifier) },
        third = { panelModifier -> SkeletonRowsPanel(rowCount = PERF_SKELETON_ROWS, modifier = panelModifier) },
    )
}

/** A skeleton panel with a title bar and [rowCount] row bars. */
@Composable
private fun SkeletonRowsPanel(
    rowCount: Int,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            repeat(rowCount) {
                Skeleton(widthFraction = SKELETON_ROW_FRACTION, height = SKELETON_ROW_HEIGHT)
            }
        }
    }
}

/** A skeleton panel with a title bar and a chart-height block. */
@Composable
private fun SkeletonChartPanel(modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Spacer(Modifier.height(Spacing.md))
        Skeleton(height = CHART_HEIGHT, rounded = true)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun RecentActivityError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content. */
@Composable
private fun RecentActivityFreshnessRow(state: UiState<RecentActivityData>) {
    val formatAge = rememberRecentActivityFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * The localized microcopy the surface renders — the web `t('...')` keys, resolved from the i18n catalog
 * (P1/S10). Held as one bundle so the panels and the projection share a single resolved set.
 */
data class RecentActivityUiStrings(
    val activityTitle: String,
    val viewAll: String,
    val activityEmpty: String,
    val driveWord: String,
    val chargedWord: String,
    val batteryTitle: String,
    val batteryEmpty: String,
    val perfTitle: String,
    val perfDrives: String,
    val perfCharges: String,
    val perfCost: String,
    val perfCo2: String,
    val perfMostEfficient: String,
) {
    /** The subset the pure projection folds into the activity-row titles. */
    fun toProjectionStrings(): RecentActivityStrings = RecentActivityStrings(driveWord = driveWord, chargedWord = chargedWord)
}

/** Resolves the [RecentActivityUiStrings] from the i18n catalog (the web `dashboard` namespace keys). */
@Composable
private fun rememberRecentActivityUiStrings(): RecentActivityUiStrings {
    val activityTitle = stringResource(R.string.translation_activity_title)
    val viewAll = stringResource(R.string.translation_activity_viewAll)
    val activityEmpty = stringResource(R.string.translation_activity_empty)
    val driveWord = stringResource(R.string.translation_activity_drive)
    val chargedWord = stringResource(R.string.translation_activity_charged)
    val batteryTitle = stringResource(R.string.translation_battery_title)
    val batteryEmpty = stringResource(R.string.translation_battery_empty)
    val perfTitle = stringResource(R.string.translation_perf_title)
    val perfDrives = stringResource(R.string.translation_perf_drives)
    val perfCharges = stringResource(R.string.translation_perf_charges)
    val perfCost = stringResource(R.string.translation_perf_cost)
    val perfCo2 = stringResource(R.string.translation_perf_co2)
    val perfMostEfficient = stringResource(R.string.translation_perf_mostEfficient)
    return remember(
        activityTitle,
        viewAll,
        activityEmpty,
        driveWord,
        chargedWord,
        batteryTitle,
        batteryEmpty,
        perfTitle,
        perfDrives,
        perfCharges,
        perfCost,
        perfCo2,
        perfMostEfficient,
    ) {
        RecentActivityUiStrings(
            activityTitle = activityTitle,
            viewAll = viewAll,
            activityEmpty = activityEmpty,
            driveWord = driveWord,
            chargedWord = chargedWord,
            batteryTitle = batteryTitle,
            batteryEmpty = batteryEmpty,
            perfTitle = perfTitle,
            perfDrives = perfDrives,
            perfCharges = perfCharges,
            perfCost = perfCost,
            perfCo2 = perfCo2,
            perfMostEfficient = perfMostEfficient,
        )
    }
}

/**
 * Builds the relative-time label formatter — the native binding of the web `formatTimeAgo`. The under-a-week
 * buckets resolve through the shared `freshness.*` catalog strings (no English literal); a week or older
 * falls back to the localized medium date.
 */
@Composable
private fun rememberRelativeTimeFormatter(
    zoneId: ZoneId,
    locale: Locale,
): (Long, Long) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    return remember(justNow, minutes, hours, days, zoneId, locale) {
        { eventMillis, nowMillis ->
            when (val relative = RecentActivityTimeFormatting.relative(eventMillis, nowMillis)) {
                RelativeActivityTime.JustNow -> justNow
                is RelativeActivityTime.MinutesAgo -> minutes.format(relative.value)
                is RelativeActivityTime.HoursAgo -> hours.format(relative.value)
                is RelativeActivityTime.DaysAgo -> days.format(relative.value)
                is RelativeActivityTime.On -> RecentActivityTimeFormatting.formatAbsolute(relative.epochMillis, zoneId, locale)
            }
        }
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern as the siblings. */
@Composable
private fun rememberRecentActivityFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> ChartFormat.EMPTY
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

/** A `${value}%` axis/label — the web `yFormatter={(v) => `${v}%`}` (SoC has no unit conversion). */
private fun percentLabel(
    value: Double,
    locale: Locale,
): String = ChartFormat.number(value, INTEGER_DECIMALS, locale) + PERCENT_SIGN

/** Builds the display-boundary formatters from the live [unitFormatter] + currency [display]. */
private fun buildFormatters(
    unitFormatter: UnitFormatter,
    display: RecentActivityDisplay,
): RecentActivityFormatters =
    RecentActivityFormatters(
        formatDistance = { meters -> unitFormatter.distance(meters, DISTANCE_PRECISION) },
        formatEnergy = { wattHours -> unitFormatter.energy(wattHours, ENERGY_PRECISION) },
        formatCurrency = { amount -> display.currencySymbol + ChartFormat.number(amount, display.precision, display.locale) },
        formatInteger = { value -> ChartFormat.number(value, INTEGER_DECIMALS, display.locale) },
        formatEfficiency = { whPerKm -> ChartFormat.number(whPerKm, INTEGER_DECIMALS, display.locale) + EFFICIENCY_UNIT_SUFFIX },
    )

/** Whether the resolved payload has nothing to show — drives + charges empty and no analytics. */
private fun isEmptyPayload(data: RecentActivityData): Boolean = data.drives.isEmpty() && data.charges.isEmpty() && data.analytics == null

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_DISPLAY =
    RecentActivityDisplay(currencySymbol = "$", precision = 2, locale = Locale.US)

private const val PREVIEW_NOW: Long = 1_700_000_000_000L

private val PREVIEW_DATA =
    RecentActivityData(
        drives =
            listOf(
                RecentActivityDrive(
                    distanceM = 42_000.0,
                    durationS = 3_900L,
                    startSocPct = 82.0,
                    endSocPct = 68.0,
                    startedAtMillis = PREVIEW_NOW - 600_000L,
                ),
                RecentActivityDrive(
                    distanceM = 12_500.0,
                    durationS = 1_500L,
                    startSocPct = 68.0,
                    endSocPct = 61.0,
                    startedAtMillis = PREVIEW_NOW - 7_200_000L,
                ),
                RecentActivityDrive(
                    distanceM = 88_000.0,
                    durationS = 6_300L,
                    startSocPct = 95.0,
                    endSocPct = 70.0,
                    startedAtMillis = PREVIEW_NOW - 90_000_000L,
                ),
            ),
        charges =
            listOf(
                RecentActivityCharge(
                    totalEnergyAddedWh = 23_400.0,
                    startSocPct = 61.0,
                    endSocPct = 90.0,
                    cost = 7.42,
                    startedAtMillis = PREVIEW_NOW - 3_600_000L,
                ),
            ),
        analytics =
            RecentActivityAnalytics(
                totalDrives = 128,
                totalChargingSessions = 36,
                totalCost = 214.5,
                totalEnergyKwh = 940.0,
                mostEfficient = MostEfficientVehicle(name = "Model 3 LR", efficiencyWhPerKm = 148.0),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun RecentActivityLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            onViewAllDrives = {},
            display = PREVIEW_DISPLAY,
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun RecentActivityErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            onViewAllDrives = {},
            display = PREVIEW_DISPLAY,
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun RecentActivityEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Empty, data = RecentActivityData()),
            onRetry = {},
            onViewAllDrives = {},
            display = PREVIEW_DISPLAY,
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Content", showBackground = true, widthDp = 420)
@Composable
private fun RecentActivityContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            onViewAllDrives = {},
            display = PREVIEW_DISPLAY,
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Content (wide)", showBackground = true, widthDp = 900)
@Composable
private fun RecentActivityWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            onViewAllDrives = {},
            display = PREVIEW_DISPLAY,
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun RecentActivityOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = PREVIEW_NOW,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            onViewAllDrives = {},
            display = PREVIEW_DISPLAY,
            nowMillis = PREVIEW_NOW,
        )
    }
}
