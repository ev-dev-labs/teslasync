// The native Jetpack Compose + Material 3 DetailedStatistics feature view — a parity port of
// web/src/features/charging/components/charging-list/DetailedStatistics.tsx. The web component is purely
// presentational: its parent (the charging-list page) computes the `ChargingStats` and `EnhancedStats` from
// the session history and passes them down. The component renders a titled `GlassPanel` (a TrendingUp icon
// + "Detailed Statistics") holding a responsive `grid-cols-2 sm:grid-cols-3 md:grid-cols-6` of six centered
// stat cells: total session count (`AnimatedNumber`), average duration, average power (`fmtWithUnit kW`),
// the most-common charger type with its occurrence count, total cost (`Currency`), and average cost-per-kWh
// (`Currency` at 3 decimals).
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own; its only
// web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useFormatting` (mapped to the
// currency symbol read from the shared settings store, P1/S8). The host supplies the computed snapshot
// through the shared P1/S8 state-holder layer as a [UiState], so this feature view also renders every
// lifecycle state that layer can carry — loading, hard error with retry, content, empty, and stale/offline
// (cached "last known") — without ever fetching. The content / empty / loading branches reproduce the web
// component, and a web-parity overload that takes the raw `(stats, enhanced, isLoading)` props is provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DetailedStatistics — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.detailedstatistics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
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
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Web `<GlassPanel className="p-5">` staggered entry delay, in milliseconds. */
private const val FADE_DELAY_MS = 200

/** The six stat cells / loading skeleton tiles — the fixed cell set of the web grid. */
private const val STAT_TILE_COUNT = 6

/** Each loading skeleton tile's height, sized for a value + caption cell. */
private val SKELETON_TILE_HEIGHT = 56.dp

// Responsive column counts, mirroring the web `grid-cols-2 sm:grid-cols-3 md:grid-cols-6` and aligned to the
// Material window-size width breakpoints (compact < 600dp, medium < 840dp, expanded ≥ 840dp).
private val GRID_MEDIUM_MIN = 600.dp
private val GRID_EXPANDED_MIN = 840.dp
private const val GRID_COLS_COMPACT = 2
private const val GRID_COLS_MEDIUM = 3
private const val GRID_COLS_EXPANDED = 6

/**
 * The already-localized strings the panel renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the panel free of any English literal.
 */
data class DetailedStatisticsStrings(
    val title: String,
    val totalSessions: String,
    val avgDuration: String,
    val avgPower: String,
    val topCharger: String,
    val totalCost: String,
    val avgCostPerKwh: String,
    val noData: String,
)

/**
 * Stateful entry point for the detailed-statistics panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the user's currency symbol from the shared settings store (web
 * `useFormatting`, P1/S8), and renders every lifecycle [state] the host's charging feed can carry. The host
 * owns the feed and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the computed [DetailedStatisticsSnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the cost cells.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DetailedStatistics(
    state: UiState<DetailedStatisticsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { DetailedStatisticsCurrencyPrefs.fromSettings(settingsResource.cached) }
    LaunchedEffect(Unit) { recordDetailedStatisticsOpened(logger) }
    DetailedStatisticsContent(state = state, onRetry = onRetry, modifier = modifier, currency = currency)
}

/**
 * Web-parity overload mirroring the web component's `({ stats, enhanced })` props (plus an explicit
 * [isLoading] for the host's first load). Projects them onto a [UiState] via
 * [DetailedStatisticsProjection.projectUiState] and delegates to the stateful entry, which records
 * `view.opened` and resolves the currency symbol. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun DetailedStatistics(
    stats: DetailedChargingStats?,
    enhanced: DetailedEnhancedStats?,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(stats, enhanced, isLoading) {
            val snapshot = if (stats != null && enhanced != null) DetailedStatisticsSnapshot(stats, enhanced) else null
            DetailedStatisticsProjection.projectUiState(snapshot, isLoading)
        }
    DetailedStatistics(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's content branch (the six-cell grid) and adds the lifecycle chrome the host's feed implies: a
 * loading skeleton grid, a hard-error retry surface, a friendly empty state, and a freshness chip that
 * reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness
 * contract. [currency] supplies the cost-cell symbol; [locale] formats every number.
 */
@Composable
fun DetailedStatisticsContent(
    state: UiState<DetailedStatisticsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currency: DetailedStatisticsCurrencyPrefs = DetailedStatisticsCurrencyPrefs.DEFAULT,
    locale: Locale = Locale.getDefault(),
    strings: DetailedStatisticsStrings = rememberDetailedStatisticsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            DetailedStatisticsHeader(strings.title)
            when {
                state.isLoading -> DetailedStatisticsSkeletonGrid()
                state.isError -> DetailedStatisticsError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> DetailedStatisticsEmpty(message = strings.noData)
                else ->
                    DetailedStatisticsLoaded(
                        snapshot = snapshot,
                        state = state,
                        currency = currency,
                        locale = locale,
                        strings = strings,
                    )
            }
        }
    }
}

/** Web `<h3 className="section-title flex items-center gap-2 mb-4"><TrendingUp/> {title}</h3>`. */
@Composable
private fun DetailedStatisticsHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            DetailedStatisticsGlyphs.TrendingUp,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.chart.regen,
        )
        SectionTitle(title)
    }
}

/**
 * The content branch: an optional freshness chip (only when refreshing/stale/offline) above the six centered
 * stat cells. The session-count cell uses the shared `AnimatedNumber` (web `<AnimatedNumber>`); the other
 * cells render their formatted value in the web semantic color — purple for power, amber for total cost,
 * green for cost-per-kWh, and the default text color for duration and the top-charger name.
 */
@Composable
private fun DetailedStatisticsLoaded(
    snapshot: DetailedStatisticsSnapshot,
    state: UiState<DetailedStatisticsSnapshot>,
    currency: DetailedStatisticsCurrencyPrefs,
    locale: Locale,
    strings: DetailedStatisticsStrings,
) {
    val display = remember(snapshot, currency, locale) { DetailedStatisticsProjection.project(snapshot, currency, locale) }
    DetailedStatisticsFreshness(state)

    val primary = MaterialTheme.colorScheme.onSurface
    val powerColor = TeslaTokens.chart.power
    val costColor = TeslaTokens.chart.energy
    val perKwhColor = TeslaTokens.chart.battery
    val topChargerCaption = "${strings.topCharger} (${display.topChargerCount}$MULTIPLY_SIGN)"
    val cells =
        listOf(
            StatCellSpec(strings.totalSessions) { AnimatedNumber(value = display.count * 1.0, locale = locale) },
            StatCellSpec(strings.avgDuration) { StatCellValue(text = display.avgDuration, color = primary) },
            StatCellSpec(strings.avgPower) { StatCellValue(text = display.avgPower, color = powerColor) },
            StatCellSpec(topChargerCaption) { StatCellValue(text = display.topChargerName, color = primary) },
            StatCellSpec(strings.totalCost) { StatCellValue(text = display.totalCost, color = costColor) },
            StatCellSpec(strings.avgCostPerKwh) { StatCellValue(text = display.avgCostPerKwh, color = perKwhColor) },
        )
    DetailedStatGrid(itemCount = cells.size) { index -> StatCell(spec = cells[index], modifier = Modifier.weight(1f)) }
}

/**
 * The freshness chip shown only when the cached snapshot is refreshing / stale / offline — the lifecycle
 * chrome the host's feed implies. Right-aligned above the grid; the relative-age label is localized.
 */
@Composable
private fun DetailedStatisticsFreshness(state: UiState<DetailedStatisticsSnapshot>) {
    if (!(state.stale || state.refreshing || state.hasError)) return
    val formatAge = rememberDetailedStatisticsFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
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

/** Web loading branch: six shimmering tiles in the same responsive grid as the cells. */
@Composable
private fun DetailedStatisticsSkeletonGrid() {
    DetailedStatGrid(itemCount = STAT_TILE_COUNT) {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
    }
}

/**
 * Empty state — the `common.noData` message with the panel's TrendingUp glyph, so the section never
 * collapses to a blank box. [EmptyState] exposes the message as its accessibility label.
 */
@Composable
private fun DetailedStatisticsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DetailedStatisticsGlyphs.TrendingUp,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with an accessible retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DetailedStatisticsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** One render-ready stat cell: its localized [caption] and a value slot (a colored value or an animator). */
private class StatCellSpec(
    val caption: String,
    val value: @Composable () -> Unit,
)

/**
 * A single centered stat cell — the web `<div className="text-center"><p>{value}</p><p>{caption}</p></div>`.
 * The value sits over a muted, center-aligned caption; both are exposed to TalkBack as ordinary text.
 */
@Composable
private fun StatCell(
    spec: StatCellSpec,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        spec.value()
        Text(
            text = spec.caption,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * A colored stat value — the native expression of the web `<p className="text-lg font-bold text-…">`. Uses
 * the shared metric type scale (`headlineSmall` + semi-bold, matching the `AnimatedNumber` cell's
 * `MetricValue`) so all six cells share one ramp; only the [color] varies, carrying the web semantic hue.
 */
@Composable
private fun StatCellValue(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
        color = color,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * A responsive grid of [itemCount] equal-width cells — the native analogue of the web
 * `grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4`. The column count tracks the available width via
 * Material window-size breakpoints; the trailing cells of a short final row are filled with weighted spacers
 * so every cell keeps a uniform width. [tile] receives the cell index and applies `weight(1f)`.
 */
@Composable
private fun DetailedStatGrid(
    itemCount: Int,
    tile: @Composable RowScope.(Int) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth < GRID_MEDIUM_MIN -> GRID_COLS_COMPACT
                maxWidth < GRID_EXPANDED_MIN -> GRID_COLS_MEDIUM
                else -> GRID_COLS_EXPANDED
            }
        val rowCount = (itemCount + columns - 1) / columns
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            for (rowIndex in 0 until rowCount) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    for (column in 0 until columns) {
                        val index = rowIndex * columns + column
                        if (index < itemCount) tile(index) else Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * Builds the localized [DetailedStatisticsStrings] from the i18n catalog (P1/S10): the `charging.stats.*`
 * keys and `common.noData` the web component reads through `useTranslation`. Resolved once at the Compose
 * boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberDetailedStatisticsStrings(): DetailedStatisticsStrings {
    val title = stringResource(R.string.translation_charging_stats_detailedStatistics)
    val totalSessions = stringResource(R.string.translation_charging_stats_totalSessions)
    val avgDuration = stringResource(R.string.translation_charging_stats_avgDuration)
    val avgPower = stringResource(R.string.translation_charging_stats_avgPower)
    val topCharger = stringResource(R.string.translation_charging_stats_topCharger)
    val totalCost = stringResource(R.string.translation_charging_stats_totalCost)
    val avgCostPerKwh = stringResource(R.string.translation_charging_stats_avgCostPerKwh)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(title, totalSessions, avgDuration, avgPower, topCharger, totalCost, avgCostPerKwh, noData) {
        DetailedStatisticsStrings(
            title = title,
            totalSessions = totalSessions,
            avgDuration = avgDuration,
            avgPower = avgPower,
            topCharger = topCharger,
            totalCost = totalCost,
            avgCostPerKwh = avgCostPerKwh,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDetailedStatisticsFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * The single line glyph this surface needs (web lucide `TrendingUp`), authored as a 24×24 stroked vector —
 * the shared [io.teslasync.android.components.datadisplay.DataDisplayGlyphs] set ships only `TrendingDown`.
 * Monochrome and recolored at render time by the [Icon] tint, exactly as the sibling surfaces author theirs.
 */
private object DetailedStatisticsGlyphs {
    val TrendingUp: ImageVector =
        stroked("DetailedStatisticsTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
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
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_SNAPSHOT =
    DetailedStatisticsSnapshot(
        stats = DetailedChargingStats(count = 1234, avgPower = 48.5, totalCost = 312.4, avgCostPerKwh = 0.182),
        enhanced = DetailedEnhancedStats(avgDurationMinutes = 125.0, topChargerName = "Supercharger", topChargerCount = 87),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun DetailedStatisticsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailedStatisticsContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DetailedStatisticsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailedStatisticsContent(state = UiState.loading(), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DetailedStatisticsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailedStatisticsContent(state = UiState(phase = UiPhase.Empty), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DetailedStatisticsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailedStatisticsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Offline (stale, last known)", showBackground = true)
@Composable
private fun DetailedStatisticsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailedStatisticsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
        )
    }
}
