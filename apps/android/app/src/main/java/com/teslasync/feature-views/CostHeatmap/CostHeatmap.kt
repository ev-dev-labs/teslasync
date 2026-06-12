// The native Jetpack Compose + Material 3 CostHeatmap feature view — a parity port of
// web/src/features/charging/components/charging-list/CostHeatmap.tsx. The web component is a presentational
// child the Charging Optimizer page drives with the `useChargingOptimizer` snapshot: a GlassPanel titled
// "Charging Cost Heatmap" (a Clock icon + heading) wrapping a horizontally scrollable 7×24 (day × hour) grid
// of cost-intensity cells, with a Cheap→Expensive color-ramp legend. This native port keeps that composition
// and additionally surfaces the cache-then-network states the P3 contract mandates (loading / empty / error /
// stale / offline) by carrying the two web props (`heatmap` + `peakCostPerKwh`) through the shared S8
// [UiState] the sibling surfaces use: a six-row skeleton covers the first load, a `QueryError` covers a hard
// failure with no cache, a friendly `EmptyState` covers "no sessions yet", and a freshness chip + auto-refresh
// covers stale/offline cached data. The view performs no HTTP — its only data read is the shared settings
// store for the currency symbol (web `useFormatting`). Every visible string resolves through the i18n catalog
// (P1/S10) and every busy cell carries a localized TalkBack label (the native analogue of the web cell
// `title` tooltip); the faint empty cells are decorative so TalkBack is not flooded with 168 nodes.
//
// Colors: the cell + legend `rgba(...)` ramps are dynamic computed values (the heatmap's whole purpose), so —
// exactly like the web inline `style={{ backgroundColor }}` — they are applied as computed Compose `Color`s,
// not theme tokens. The pure web-exact channel math lives in [CostHeatmapProjection]; this layer only clamps
// each channel into the valid Compose range at the render boundary (a browser likewise clamps CSS rgba).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CostHeatmap) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costheatmap

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
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
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Side of one square heatmap cell — the web `flex-1 aspect-square` cell, sized for the scrollable grid. */
private val CELL_SIZE: Dp = 22.dp

/** Gap between cells / rows — the native expression of the web `gap-0.5` (2px). */
private val CELL_GAP: Dp = 2.dp

/** Width of the leading weekday-label column — the web row label `w-10` (40px). */
private val DAY_LABEL_WIDTH: Dp = 40.dp

/** Side of one legend swatch — the web legend `w-3 h-3` (12px). */
private val LEGEND_SWATCH: Dp = 12.dp

/** Height of one loading skeleton row (cell-height bars evoking the seven grid rows). */
private val SKELETON_ROW_HEIGHT: Dp = 18.dp

/** Max RGB channel value, for the web-exact int → Compose float channel conversion. */
private const val CHANNEL_MAX: Float = 255f

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/**
 * The already-localized microcopy this surface reads from the i18n catalog (P1/S10): the three
 * `charging.optimizer.*` keys the web component resolves via `t(...)`, plus the reused `sessions` /
 * `Per kWh` tooltip fragments and the shared no-data empty message. The lifecycle-chrome strings
 * (loading / retry / offline / freshness) are resolved inline at the Compose boundary, keeping this a thin
 * content carrier.
 *
 * @property title the panel title (web `charging.optimizer.heatmap`).
 * @property cheap the legend's low-cost label (web `charging.optimizer.cheap`).
 * @property expensive the legend's high-cost label (web `charging.optimizer.expensive`).
 * @property sessionsWord the cell-tooltip "sessions" fragment (reused `translation_sessions`).
 * @property perKwhWord the cell-tooltip per-kWh fragment (reused `translation_charging_detail_perKwh`).
 * @property emptyMessage the no-sessions empty-state message (shared `translation_chart_noData`).
 */
data class CostHeatmapStrings(
    val title: String,
    val cheap: String,
    val expensive: String,
    val sessionsWord: String,
    val perKwhWord: String,
    val emptyMessage: String,
)

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), resolves the user's
 * currency symbol from the shared settings store (web `useFormatting`, P1/S8), and renders every lifecycle
 * [state] the host's charging-optimizer feed can carry. The owning page holds the query (P1/S8) and supplies
 * [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the two web props (`heatmap` + `peakCostPerKwh`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the cell tooltips.
 */
@Composable
fun CostHeatmap(
    state: UiState<CostHeatmapData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
) {
    LaunchedEffect(Unit) { CostHeatmapDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { CostHeatmapCurrencyPrefs.fromSettings(settingsResource.cached) }
    CostHeatmapContent(state = state, currency = currency, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `{ heatmap, peakCostPerKwh }` props, for hosts that
 * already hold the loaded optimizer snapshot. A `heatmap` with no sessions (or a `null` list) renders the
 * empty state (there is nothing to visualize), otherwise the grid renders. Records `view.opened` like the
 * stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun CostHeatmap(
    heatmap: List<CostHeatmapEntry>?,
    peakCostPerKwh: Double,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
) {
    val state =
        remember(heatmap, peakCostPerKwh) {
            val entries = heatmap ?: emptyList()
            val phase = if (entries.none { it.sessions > 0 }) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = CostHeatmapData(entries, peakCostPerKwh))
        }
    CostHeatmap(state = state, onRetry = {}, modifier = modifier, logger = logger, settings = settings)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Always shows the
 * titled GlassPanel chrome (the Clock icon + heading), then swaps the body by state: a six-row skeleton while
 * loading, a `QueryError` with retry on a hard failure with no cache, a friendly empty state when no bucket
 * has sessions, and otherwise the scrollable cost grid + Cheap→Expensive legend with a freshness chip when
 * the cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [locale] resolves the localized weekday labels and formats the cell-tooltip costs.
 */
@Composable
fun CostHeatmapContent(
    state: UiState<CostHeatmapData>,
    modifier: Modifier = Modifier,
    currency: CostHeatmapCurrencyPrefs = CostHeatmapCurrencyPrefs.DEFAULT,
    onRetry: () -> Unit = {},
    locale: Locale = LocalConfiguration.current.locales[0],
    strings: CostHeatmapStrings = rememberCostHeatmapStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRetry()
    }
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            CostHeatmapHeader(strings.title)
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                state.isLoading -> CostHeatmapLoading()
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.title,
                        onRetry = onRetry,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else -> CostHeatmapLoaded(state = state, currency = currency, locale = locale, strings = strings)
            }
        }
    }
}

@Composable
private fun CostHeatmapLoaded(
    state: UiState<CostHeatmapData>,
    currency: CostHeatmapCurrencyPrefs,
    locale: Locale,
    strings: CostHeatmapStrings,
) {
    val data = state.data ?: CostHeatmapData.EMPTY
    val dayLabels = remember(locale) { CostHeatmapProjection.weekdayLabels(locale) }
    val display =
        remember(data, currency, locale, dayLabels, strings) {
            CostHeatmapProjection.project(
                data = data,
                dayLabels = dayLabels,
                formatCost = { cost -> CostHeatmapProjection.formatCurrency(cost, currency.currencySymbol, locale) },
                words = CostHeatmapTooltipWords(strings.sessionsWord, strings.perKwhWord),
            )
        }
    if (display.isEmpty) {
        EmptyState(
            message = strings.emptyMessage,
            icon = DataDisplayGlyphs.Clock,
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (showFreshness) {
            CostHeatmapFreshnessRow(state)
        }
        CostHeatmapGrid(display)
        CostHeatmapLegend(legend = display.legend, cheap = strings.cheap, expensive = strings.expensive)
    }
}

/** The web `<h3>` header: a Clock icon (a theme accent in place of the web `text-neon-purple`) + the title. */
@Composable
private fun CostHeatmapHeader(title: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(
            imageVector = DataDisplayGlyphs.Clock,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title)
    }
}

/**
 * The scrollable cost grid — the native analogue of the web `overflow-x-auto` / `min-w-[600px]` block: an
 * hour-axis label row over seven weekday rows of 24 cells. Each busy cell carries its localized TalkBack
 * label; the faint empty cells are decorative (no semantics) so the screen reader is not flooded.
 */
@Composable
private fun CostHeatmapGrid(display: CostHeatmapDisplay) {
    val scroll = rememberScrollState()
    Column(
        modifier = Modifier.horizontalScroll(scroll),
        verticalArrangement = Arrangement.spacedBy(CELL_GAP),
    ) {
        CostHeatmapHourAxis(display.hourLabels)
        display.rows.forEach { row -> CostHeatmapDayRow(row) }
    }
}

@Composable
private fun CostHeatmapHourAxis(hourLabels: List<String>) {
    Row(horizontalArrangement = Arrangement.spacedBy(CELL_GAP), verticalAlignment = Alignment.CenterVertically) {
        Spacer(modifier = Modifier.width(DAY_LABEL_WIDTH))
        hourLabels.forEach { label ->
            Box(modifier = Modifier.width(CELL_SIZE), contentAlignment = Alignment.Center) {
                if (label.isNotEmpty()) {
                    MetricLabel(label)
                }
            }
        }
    }
}

@Composable
private fun CostHeatmapDayRow(row: CostHeatmapRow) {
    Row(horizontalArrangement = Arrangement.spacedBy(CELL_GAP), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.width(DAY_LABEL_WIDTH), contentAlignment = Alignment.CenterEnd) {
            MetricLabel(row.label)
        }
        row.cells.forEach { cell -> CostHeatmapCell(cell) }
    }
}

@Composable
private fun CostHeatmapCell(cell: CostCell) {
    val base =
        Modifier
            .size(CELL_SIZE)
            .clip(RoundedCornerShape(Radius.sm))
            .background(cell.color.toComposeColor())
    // Only busy cells become accessibility nodes; empty cells stay decorative so TalkBack isn't flooded.
    val cellModifier = if (cell.sessions > 0) base.semantics { contentDescription = cell.accessibilityLabel } else base
    Box(modifier = cellModifier)
}

/** The Cheap→Expensive legend — the web row of five ramp swatches between the `cheap` / `expensive` labels. */
@Composable
private fun CostHeatmapLegend(
    legend: List<CostLegendSwatch>,
    cheap: String,
    expensive: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(cheap)
        Row(horizontalArrangement = Arrangement.spacedBy(CELL_GAP)) {
            legend.forEach { swatch ->
                Box(
                    modifier =
                        Modifier
                            .size(LEGEND_SWATCH)
                            .clip(RoundedCornerShape(Radius.sm))
                            .background(swatch.color.toComposeColor()),
                )
            }
        }
        Caption(expensive)
    }
}

@Composable
private fun CostHeatmapLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(CELL_GAP),
    ) {
        repeat(DAYS_PER_WEEK) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun CostHeatmapFreshnessRow(state: UiState<CostHeatmapData>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

/**
 * Resolves the localized [CostHeatmapStrings] from the i18n catalog (P1/S10) — the three
 * `charging.optimizer.*` keys the web component reads via `t(...)`, plus the reused `translation_sessions` /
 * `translation_charging_detail_perKwh` tooltip fragments and the shared `translation_chart_noData` empty
 * message. Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
fun rememberCostHeatmapStrings(): CostHeatmapStrings {
    val title = stringResource(R.string.translation_charging_optimizer_heatmap)
    val cheap = stringResource(R.string.translation_charging_optimizer_cheap)
    val expensive = stringResource(R.string.translation_charging_optimizer_expensive)
    val sessionsWord = stringResource(R.string.translation_sessions)
    val perKwhWord = stringResource(R.string.translation_charging_detail_perKwh)
    val emptyMessage = stringResource(R.string.translation_chart_noData)
    return remember(title, cheap, expensive, sessionsWord, perKwhWord, emptyMessage) {
        CostHeatmapStrings(
            title = title,
            cheap = cheap,
            expensive = expensive,
            sessionsWord = sessionsWord,
            perKwhWord = perKwhWord,
            emptyMessage = emptyMessage,
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

/** Classifies a [UiState] failure into the recovery copy the `QueryError` branch shows (mirrors siblings). */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Converts a web-exact [CostCellColor] into a Compose [Color], clamping each channel into its valid range —
 * the render-boundary analogue of a browser clamping out-of-range CSS rgba.
 */
private fun CostCellColor.toComposeColor(): Color =
    Color(
        red = (red / CHANNEL_MAX).coerceIn(0f, 1f),
        green = (green / CHANNEL_MAX).coerceIn(0f, 1f),
        blue = (blue / CHANNEL_MAX).coerceIn(0f, 1f),
        alpha = alpha.toFloat().coerceIn(0f, 1f),
    )

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    CostHeatmapStrings(
        title = "Charging Cost Heatmap",
        cheap = "Cheap",
        expensive = "Expensive",
        sessionsWord = "sessions",
        perKwhWord = "Per kWh",
        emptyMessage = "No data available",
    )

private val PREVIEW_DATA: CostHeatmapData =
    CostHeatmapData(
        heatmap =
            buildList {
                // A handful of busy buckets across days/hours, ramping cheap → expensive.
                add(CostHeatmapEntry(day = 1, hour = 2, sessions = 1, avgCostPerKwh = 0.08))
                add(CostHeatmapEntry(day = 1, hour = 22, sessions = 3, avgCostPerKwh = 0.11))
                add(CostHeatmapEntry(day = 3, hour = 8, sessions = 2, avgCostPerKwh = 0.22))
                add(CostHeatmapEntry(day = 4, hour = 18, sessions = 5, avgCostPerKwh = 0.31))
                add(CostHeatmapEntry(day = 6, hour = 12, sessions = 4, avgCostPerKwh = 0.27))
            },
        peakCostPerKwh = 0.32,
    )

@Preview(name = "Content", showBackground = true, widthDp = 420)
@Composable
private fun CostHeatmapContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostHeatmapContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun CostHeatmapLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostHeatmapContent(
            state = UiState(UiPhase.Loading),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 420)
@Composable
private fun CostHeatmapEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostHeatmapContent(
            state = UiState(UiPhase.Empty, data = CostHeatmapData.EMPTY),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun CostHeatmapErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostHeatmapContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun CostHeatmapOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostHeatmapContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
