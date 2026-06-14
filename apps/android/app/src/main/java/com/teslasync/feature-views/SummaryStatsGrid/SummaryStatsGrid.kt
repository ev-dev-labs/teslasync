// The native Jetpack Compose + Material 3 SummaryStatsGrid feature view — a parity port of
// web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx. The web component wraps a
// `<FadeIn delay={0.05}>` around a responsive `grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4` holding
// six local `SummaryCard`s (Total Sessions, Total Energy, Avg Charge Rate, Peak Rate, Avg Duration, Total
// Cost). Each `SummaryCard` is a `GlassPanel` with an uppercase secondary label over a large white value plus
// an optional small secondary unit span, switching the value to a `<Skeleton>` while its `loading` flag is set.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog P1/S10, and the owning page's `useFormatting`, mapped
// to the live S8 SettingsStore for the currency symbol + precision + locale that back the web `formatCurrency`
// / `fmtNumber`). The owning ChargingCurvePage computes the cross-section `stats` and threads them in through
// the shared state-holder layer as a [UiState], so this feature view renders every lifecycle state that layer
// can carry — a loading skeleton grid, a hard error with retry, a friendly empty state (the web `stats === null`
// no-sessions case), content, and stale/offline cached "last known" with a freshness chip + auto-refresh —
// without ever fetching, exactly like the sibling SummaryStats / CostSummaryCards card-grid ports. The content
// branch reproduces the web grid verbatim (the `<FadeIn delay={0.05}>` entrance included) over a bespoke
// `SummaryCard` built on the shared `GlassPanel` + `Skeleton`, the native counterparts of the web component's
// own building blocks (the unit is rendered in its own secondary slot exactly as the web `<span>` is). A
// web-parity overload taking the raw `stats` prop (web `stats: SummaryStats | null`) is provided for hosts that
// already hold it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummaryStatsGrid — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summarystatsgrid

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** Web Tailwind `xl` breakpoint (1280px): at or above this width the tiles lay out six-per-row (`xl:grid-cols-6`). */
private val GRID_XL_MIN_WIDTH: Dp = 1280.dp

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the tiles lay out three-per-row (`lg:grid-cols-3`). */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web base `grid-cols-2`: below the `lg` breakpoint the tiles lay out two-per-row. */
private const val GRID_COLUMNS_XL = 6
private const val GRID_COLUMNS_LG = 3
private const val GRID_COLUMNS_BASE = 2

/** The six summary tiles, matching the web component's fixed card set. */
private const val SKELETON_TILE_COUNT = 6

/** Web `<FadeIn delay={0.05}>` — the resolved grid fades in 50ms after mount. */
private const val FADE_IN_DELAY_MS = 50

/** Web `<Skeleton className="mt-1 h-7 w-20" />` — the loading value bar is 28dp tall (`h-7`). */
private val SKELETON_VALUE_HEIGHT: Dp = 28.dp

/** Web `w-20` (80px) loading bar, expressed as a column fraction so it scales with the responsive tile width. */
private const val SKELETON_VALUE_WIDTH_FRACTION = 0.6f

/** Blank value slot for the loading tiles (the web `SummaryCard` loading branch shows the skeleton, not a value). */
private const val LOADING_EMPTY_VALUE = ""

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point for the charging summary tiles. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live currency symbol + precision + locale from the shared S8 SettingsStore (the native
 * binding of the web page's `useFormatting` / `useSettings` reads that feed `formatCurrency` / `fmtNumber`;
 * "$"/2-dp/en-US defaults apply until settings load), and renders every lifecycle [state] the shared
 * charging-summary feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's
 * `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [ChargingSummaryStats].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the currency + precision + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SummaryStatsGrid(
    state: UiState<ChargingSummaryStats>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SummaryStatsGridDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { SummaryStatsGridDisplayPrefs.from(settingsResource.cached) }
    SummaryStatsGridContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ stats })` prop, for hosts that already hold the
 * computed stats. A `null` [stats] is the web `stats === null` case — it projects onto the empty [UiState]
 * (the page's no-charging-sessions branch). There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SummaryStatsGrid(
    stats: ChargingSummaryStats?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(stats) { SummaryStatsGridProjection.projectUiState(stats, isLoading = false) }
    SummaryStatsGrid(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip is
 * shown above the grid when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes —
 * mirroring the shared cache-then-network freshness contract. Inside it switches between a loading skeleton
 * grid, a hard-error retry surface, a friendly empty state (so the surface never blanks), and the resolved
 * SummaryCard grid.
 */
@Composable
fun SummaryStatsGridContent(
    state: UiState<ChargingSummaryStats>,
    onRetry: () -> Unit,
    prefs: SummaryStatsGridDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: SummaryStatsGridStrings = rememberSummaryStatsGridStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val stats = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stats != null && isDegraded) {
            SummaryStatsGridFreshnessRow(state = state)
        }
        when {
            state.isLoading -> SummaryStatsGridSkeletonGrid(strings = strings)
            state.isError -> SummaryStatsGridError(onRetry = onRetry)
            state.isEmpty || stats == null -> SummaryStatsGridEmpty()
            else -> SummaryStatsGridLoaded(stats = stats, prefs = prefs, strings = strings)
        }
    }
}

/**
 * A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content, the native
 * expression of the shared [DataFreshness] contract (the web page's poll/`refetch`). Lives above the grid,
 * not next to a value.
 */
@Composable
private fun SummaryStatsGridFreshnessRow(state: UiState<ChargingSummaryStats>) {
    val formatAge = rememberSummaryStatsGridFreshnessFormatter()
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
 * The content branch: the six SummaryCard tiles laid out in the web responsive grid, the whole grid fading in
 * (web `<FadeIn delay={0.05}>`). Derives the render-ready tiles once via the pure
 * [SummaryStatsGridProjection.tiles].
 */
@Composable
private fun SummaryStatsGridLoaded(
    stats: ChargingSummaryStats,
    prefs: SummaryStatsGridDisplayPrefs,
    strings: SummaryStatsGridStrings,
) {
    val tiles = remember(stats, prefs, strings) { SummaryStatsGridProjection.tiles(stats, prefs, strings) }
    FadeIn(delayMs = FADE_IN_DELAY_MS) {
        SummaryStatsGridLayout(itemCount = tiles.size) { index, cellModifier ->
            val tile = tiles[index]
            SummaryCard(label = tile.label, value = tile.value, unit = tile.unit, modifier = cellModifier)
        }
    }
}

/**
 * The loading branch: six skeleton tiles in the same responsive grid, announced as "Loading" to TalkBack.
 * Each tile is the bespoke [SummaryCard] in its loading state (web `SummaryCard` `loading` skeleton), carrying
 * its resolved label so the grid stays meaningful even though the skeleton chrome hides the value.
 */
@Composable
private fun SummaryStatsGridSkeletonGrid(strings: SummaryStatsGridStrings) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val labels =
        remember(strings) {
            listOf(
                strings.totalSessions,
                strings.totalEnergy,
                strings.avgChargeRate,
                strings.peakRate,
                strings.avgDuration,
                strings.totalCost,
            )
        }
    SummaryStatsGridLayout(
        itemCount = SKELETON_TILE_COUNT,
        modifier = Modifier.semantics { contentDescription = loadingLabel },
    ) { index, cellModifier ->
        SummaryCard(label = labels[index], value = LOADING_EMPTY_VALUE, unit = null, loading = true, modifier = cellModifier)
    }
}

/**
 * Empty state — the web `stats === null` no-charging-sessions case, shown with the charging-bolt glyph so the
 * surface never collapses to a blank box. [EmptyState] exposes the message as its accessibility label, so the
 * section is still announced to TalkBack when it holds no data.
 */
@Composable
private fun SummaryStatsGridEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = DataDisplayGlyphs.Bolt,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SummaryStatsGridError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * One summary tile — the faithful native analogue of the web local `SummaryCard`: a [GlassPanel] holding the
 * secondary [label] over the large primary [value] with an optional small secondary [unit] beside it (the web
 * unit `<span>`). While [loading] the value is replaced by a [Skeleton], exactly like the web `loading` branch,
 * while the label stays visible. The tile merges its descendants into one semantics node so TalkBack reads the
 * label, value, and unit as a single "Total Energy, 3,421.5 kWh" announcement.
 */
@Composable
private fun SummaryCard(
    label: String,
    value: String,
    unit: String?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
) {
    GlassPanel(modifier = modifier.semantics(mergeDescendants = true) {}, padding = PanelPadding.Md) {
        MetricLabel(label)
        if (loading) {
            Skeleton(
                modifier = Modifier.padding(top = Spacing.xs),
                widthFraction = SKELETON_VALUE_WIDTH_FRACTION,
                height = SKELETON_VALUE_HEIGHT,
            )
        } else {
            Row(
                modifier = Modifier.padding(top = Spacing.xs),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                MetricValue(value)
                if (unit != null) Caption(unit, modifier = Modifier.padding(bottom = Spacing.xs))
            }
        }
    }
}

/**
 * Lays out [itemCount] cells as the web responsive grid: six-per-row at or above [GRID_XL_MIN_WIDTH]
 * (`xl:grid-cols-6`), three-per-row at or above [GRID_LG_MIN_WIDTH] (`lg:grid-cols-3`), and two-per-row below
 * it (`grid-cols-2`). Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the cells keep a uniform width. Cells are spaced by `Spacing.md`, the native expression
 * of the web `gap-4`.
 */
@Composable
private fun SummaryStatsGridLayout(
    itemCount: Int,
    modifier: Modifier = Modifier,
    item: @Composable (Int, Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_XL_MIN_WIDTH -> GRID_COLUMNS_XL
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                else -> GRID_COLUMNS_BASE
            }
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            for (rowIndices in (0 until itemCount).chunked(columns)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    for (index in rowIndices) {
                        item(index, Modifier.weight(1f))
                    }
                    repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Resolves the localized tile labels from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun rememberSummaryStatsGridStrings(): SummaryStatsGridStrings {
    val totalSessions = stringResource(R.string.translation_charging_curve_totalSessions)
    val totalEnergy = stringResource(R.string.translation_charging_curve_totalEnergy)
    val avgChargeRate = stringResource(R.string.translation_charging_curve_avgChargeRate)
    val peakRate = stringResource(R.string.translation_charging_curve_peakRate)
    val avgDuration = stringResource(R.string.translation_charging_curve_avgDuration)
    val totalCost = stringResource(R.string.translation_charging_curve_totalCost)
    return remember(totalSessions, totalEnergy, avgChargeRate, peakRate, avgDuration, totalCost) {
        SummaryStatsGridStrings(
            totalSessions = totalSessions,
            totalEnergy = totalEnergy,
            avgChargeRate = avgChargeRate,
            peakRate = peakRate,
            avgDuration = avgDuration,
            totalCost = totalCost,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSummaryStatsGridFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STATS =
    ChargingSummaryStats(
        totalSessions = 128,
        totalEnergy = 3421.5,
        avgRate = 48.2,
        peakRate = 122.6,
        avgDuration = 42.0,
        totalCost = 412.37,
    )

@Preview(name = "Content", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsGridContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsGridContent(
            state = SummaryStatsGridProjection.projectUiState(PREVIEW_STATS, isLoading = false),
            onRetry = {},
            prefs = SummaryStatsGridDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsGridLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsGridContent(
            state = SummaryStatsGridProjection.projectUiState(stats = null, isLoading = true),
            onRetry = {},
            prefs = SummaryStatsGridDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsGridContent(
            state = SummaryStatsGridProjection.projectUiState(stats = null, isLoading = false),
            onRetry = {},
            prefs = SummaryStatsGridDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsGridErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsGridContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = SummaryStatsGridDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Offline — stale last known", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsGridOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsGridContent(
            state =
                SummaryStatsGridProjection
                    .projectUiState(PREVIEW_STATS, isLoading = false)
                    .copy(stale = true, errorKind = ErrorKind.Network, fetchedAt = 1L),
            onRetry = {},
            prefs = SummaryStatsGridDisplayPrefs.DEFAULT,
        )
    }
}
