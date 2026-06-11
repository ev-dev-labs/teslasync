// The native Jetpack Compose + Material 3 ChargingDetailSection feature view — a parity port of
// web/src/features/analytics/components/analytics/ChargingDetailSection.tsx. The web component is purely
// presentational: its parent (the analytics page) loads the `FleetAnalytics` document and passes it down,
// and the component renders four `GlassPanel`s from `data.charging_analytics` — a charger-brand
// leaderboard (proportional bars), a monthly-trend composed chart (energy area + avg-power line + session
// columns + legend), a four-card cost summary (min/avg/median/max), and a cost-by-charger-type share bar
// list — each panel falling back to its own `EmptyState` when its slice is missing.
//
// The native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its only web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useFormatting` (mapped
// to the currency symbol read from the shared settings store, P1/S8). The host supplies the decoded
// analytics slice through the shared state-holder layer as a [UiState], so this feature view also renders
// every lifecycle state that layer can carry — loading, hard error with retry, content, and stale/offline
// (cached "last known") — without ever fetching. The four content panels reproduce the web component
// exactly, each with its own empty state. A web-parity overload that takes the raw `(data, isLoading)`
// props is also provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargingDetailSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingdetailsection

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
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

/** Web `<FadeIn>` staggered entry delay, in milliseconds. */
private const val FADE_DELAY_MS = 200

/** Web `<ResponsiveContainer height={300}>` plot height. */
private val CHART_HEIGHT: Dp = 300.dp

/** Web Y-axis ticks are whole numbers (energy / power / sessions). */
private const val Y_AXIS_DECIMALS = 0

/** The four loading skeleton panels (one per content panel). */
private const val SKELETON_PANEL_COUNT = 4

private const val SKELETON_TITLE_FRACTION = 0.4f
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_BLOCK_HEIGHT = 96.dp

// Responsive cost-card columns — the web `grid-cols-2 md:grid-cols-4`, aligned to the Material compact
// width breakpoint (compact < 600dp shows two columns, wider shows all four).
private val GRID_WIDE_MIN = 600.dp
private const val GRID_COLS_COMPACT = 2
private const val GRID_COLS_WIDE = 4

// Stable chart series keys (also the legend entry keys).
private const val KEY_ENERGY = "energy"
private const val KEY_AVG_POWER = "avg_power"
private const val KEY_SESSIONS = "sessions"

// Web `CHART_COLORS` indices the source assigns to each series.
private const val COLOR_ENERGY = 1
private const val COLOR_SESSIONS = 2
private const val COLOR_AVG_POWER = 3

/**
 * The already-localized strings the section renders. The web component is anonymous — it resolves every
 * label through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary
 * and are passed down, keeping the section free of any English literal.
 */
data class ChargingDetailSectionStrings(
    val chargerBrands: String,
    val sessions: String,
    val noBrands: String,
    val monthlyTrend: String,
    val energyKwh: String,
    val avgPowerKw: String,
    val sessionsSeries: String,
    val noMonthly: String,
    val costAnalysis: String,
    val minCost: String,
    val avgCost: String,
    val medianCost: String,
    val maxCost: String,
    val noCostStats: String,
    val costByType: String,
    val noCostByType: String,
)

/**
 * Stateful entry point for the charging-detail section. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the user's currency symbol from the shared settings store (web
 * `useFormatting`, P1/S8), and renders every lifecycle [state] the shared analytics feed can carry. The
 * host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded [ChargingAnalyticsData].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the cost cards.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingDetailSection(
    state: UiState<ChargingAnalyticsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { ChargingCurrencyPrefs.fromSettings(settingsResource.cached) }
    LaunchedEffect(Unit) { recordChargingDetailSectionOpened(logger) }
    ChargingDetailSectionContent(state = state, onRetry = onRetry, modifier = modifier, currency = currency)
}

/**
 * Web-parity overload mirroring the web component's `{ data }` prop (plus an explicit [isLoading] for the
 * host's first load). Projects the props onto a [UiState] via
 * [ChargingDetailSectionProjection.projectUiState] and delegates to the stateful entry, which records
 * `view.opened` and resolves the currency symbol. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun ChargingDetailSection(
    data: ChargingAnalyticsData?,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data, isLoading) { ChargingDetailSectionProjection.projectUiState(data, isLoading) }
    ChargingDetailSection(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's four content panels (each content-or-empty) and adds the lifecycle chrome the host's feed
 * implies: a loading skeleton, a hard-error retry surface, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [currency] supplies the cost-card currency symbol; [locale] formats every number (web `fmtInt` /
 * `formatCurrency`).
 */
@Composable
fun ChargingDetailSectionContent(
    state: UiState<ChargingAnalyticsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currency: ChargingCurrencyPrefs = ChargingCurrencyPrefs.DEFAULT,
    locale: Locale = Locale.getDefault(),
    strings: ChargingDetailSectionStrings = rememberChargingDetailSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        when {
            state.isLoading -> ChargingDetailLoading()
            state.isError -> ChargingDetailError(onRetry = onRetry)
            else -> ChargingDetailPanels(data = state.data, state = state, currency = currency, locale = locale, strings = strings)
        }
    }
}

/**
 * The web content body: the four panels, in source order, preceded by a freshness chip whenever the cached
 * data is refreshing / stale / offline. [data] is `null` in the [UiPhase.Empty] state, in which case every
 * panel renders its own empty state — the web `data?.charging_analytics` `undefined` outcome.
 */
@Composable
private fun ChargingDetailPanels(
    data: ChargingAnalyticsData?,
    state: UiState<ChargingAnalyticsData>,
    currency: ChargingCurrencyPrefs,
    locale: Locale,
    strings: ChargingDetailSectionStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (state.stale || state.refreshing || state.hasError) {
            ChargingDetailFreshnessRow(state = state)
        }
        ChargerBrandsPanel(brands = data?.brands ?: emptyList(), locale = locale, strings = strings)
        MonthlyTrendPanel(points = data?.monthlyTrend ?: emptyList(), locale = locale, strings = strings)
        CostAnalysisPanel(stats = data?.costStats, currency = currency, locale = locale, strings = strings)
        CostByTypePanel(types = data?.chargerTypes ?: emptyList(), locale = locale, strings = strings)
    }
}

/** Web "Charger Brands" leaderboard — proportional bars (count ÷ max), or the no-brands empty state. */
@Composable
private fun ChargerBrandsPanel(
    brands: List<ChargerBrand>,
    locale: Locale,
    strings: ChargingDetailSectionStrings,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.chargerBrands, modifier = Modifier.padding(bottom = Spacing.sm))
        val bars = remember(brands, locale) { ChargingDetailSectionProjection.brandLeaderboard(brands, locale) }
        if (bars.isNotEmpty()) {
            val barColor = TeslaTokens.chart.battery
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                bars.forEach { bar ->
                    MetricBar(
                        value = bar.value,
                        max = bar.max,
                        label = "#${bar.rank} ${bar.brand}",
                        valueText = "${bar.countText} ${strings.sessions}",
                        color = barColor,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        } else {
            EmptyState(message = strings.noBrands, icon = ChargingDetailGlyphs.Zap, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Web "Monthly Charging Trend" — energy area + avg-power line + session columns + legend, or empty. */
@Composable
private fun MonthlyTrendPanel(
    points: List<MonthlyChargingPoint>,
    locale: Locale,
    strings: ChargingDetailSectionStrings,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.monthlyTrend, modifier = Modifier.padding(bottom = Spacing.sm))
        val chart = remember(points) { ChargingDetailSectionProjection.monthlyChart(points) }
        if (!chart.isEmpty) {
            val energyColor = paletteColor(COLOR_ENERGY)
            val avgPowerColor = paletteColor(COLOR_AVG_POWER)
            val sessionsColor = paletteColor(COLOR_SESSIONS)
            val series =
                remember(chart, energyColor, avgPowerColor, sessionsColor, strings) {
                    listOf(
                        ChartSeries(KEY_SESSIONS, strings.sessionsSeries, chart.sessions, ChartSeriesKind.Bar, sessionsColor),
                        ChartSeries(KEY_ENERGY, strings.energyKwh, chart.energy, ChartSeriesKind.Area, energyColor),
                        ChartSeries(KEY_AVG_POWER, strings.avgPowerKw, chart.avgPower, ChartSeriesKind.Line, avgPowerColor),
                    )
                }
            ComboChart(
                series = series,
                xLabels = chart.labels,
                height = CHART_HEIGHT,
                yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
            )
            ChartLegend(
                entries =
                    listOf(
                        LegendEntry(KEY_ENERGY, strings.energyKwh, energyColor),
                        LegendEntry(KEY_AVG_POWER, strings.avgPowerKw, avgPowerColor),
                        LegendEntry(KEY_SESSIONS, strings.sessionsSeries, sessionsColor),
                    ),
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
            )
        } else {
            EmptyState(message = strings.noMonthly, icon = ChargingDetailGlyphs.Zap, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Web "Cost Analysis" — four `MetricCard`s (min/avg/median/max) in a responsive grid, or empty. */
@Composable
private fun CostAnalysisPanel(
    stats: CostStats?,
    currency: ChargingCurrencyPrefs,
    locale: Locale,
    strings: ChargingDetailSectionStrings,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.costAnalysis, modifier = Modifier.padding(bottom = Spacing.sm))
        val cards = remember(stats, currency, locale) { ChargingDetailSectionProjection.costCards(stats, currency, locale) }
        if (cards != null) {
            CostCardGrid(cards = cards, strings = strings)
        } else {
            EmptyState(message = strings.noCostStats, icon = ChargingDetailGlyphs.DollarSign, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Web "Cost by Charger Type" — proportional share bars (count ÷ total), or the no-types empty state. */
@Composable
private fun CostByTypePanel(
    types: List<ChargerType>,
    locale: Locale,
    strings: ChargingDetailSectionStrings,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.costByType, modifier = Modifier.padding(bottom = Spacing.sm))
        val bars = remember(types, locale) { ChargingDetailSectionProjection.chargerTypeBars(types, locale) }
        if (bars.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                bars.forEach { bar ->
                    MetricBar(
                        value = bar.value,
                        max = bar.max,
                        label = bar.type,
                        valueText = bar.valueText,
                        color = paletteColor(bar.colorIndex),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        } else {
            EmptyState(message = strings.noCostByType, icon = ChargingDetailGlyphs.Zap, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The four cost cards in a responsive two-/four-column grid (web `grid-cols-2 md:grid-cols-4`), each a
 * `MetricCard` with a dollar glyph and the web accent color (green/cyan/purple/amber → the chart tokens).
 */
@Composable
private fun CostCardGrid(
    cards: CostCardValues,
    strings: ChargingDetailSectionStrings,
) {
    val items =
        listOf(
            CostCard(strings.minCost, cards.min, TeslaTokens.chart.battery),
            CostCard(strings.avgCost, cards.avg, TeslaTokens.chart.regen),
            CostCard(strings.medianCost, cards.median, TeslaTokens.chart.power),
            CostCard(strings.maxCost, cards.max, TeslaTokens.chart.energy),
        )
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = if (maxWidth < GRID_WIDE_MIN) GRID_COLS_COMPACT else GRID_COLS_WIDE
        val rows = (items.size + columns - 1) / columns
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            for (row in 0 until rows) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    for (column in 0 until columns) {
                        val index = row * columns + column
                        if (index < items.size) {
                            val item = items[index]
                            MetricCard(
                                label = item.label,
                                value = item.value,
                                modifier = Modifier.weight(1f),
                                icon = ChargingDetailGlyphs.DollarSign,
                                accent = item.accent,
                            )
                        } else {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

/** One resolved cost-card tile: its localized [label], formatted [value], and accent [accent]. */
private data class CostCard(
    val label: String,
    val value: String,
    val accent: Color,
)

/** The loading branch: four skeleton panels so the section never collapses to a blank box. */
@Composable
private fun ChargingDetailLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_PANEL_COUNT) {
            GlassPanel(padding = PanelPadding.Md) {
                Skeleton(
                    modifier = Modifier.padding(bottom = Spacing.sm),
                    widthFraction = SKELETON_TITLE_FRACTION,
                    height = SKELETON_TITLE_HEIGHT,
                    rounded = true,
                )
                Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_BLOCK_HEIGHT, rounded = true)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun ChargingDetailError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The "refreshing / stale / offline" freshness chip, right-aligned above the panels. */
@Composable
private fun ChargingDetailFreshnessRow(state: UiState<ChargingAnalyticsData>) {
    val formatAge = rememberChargingFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
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

/**
 * Builds the localized [ChargingDetailSectionStrings] from the i18n catalog (P1/S10): the fifteen
 * `analytics.charging.*` keys the web component reads through `useTranslation`. Resolved once at the
 * Compose boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberChargingDetailSectionStrings(): ChargingDetailSectionStrings {
    val chargerBrands = stringResource(R.string.translation_analytics_charging_chargerBrands)
    val sessions = stringResource(R.string.translation_analytics_charging_sessions)
    val noBrands = stringResource(R.string.translation_analytics_charging_noBrands)
    val monthlyTrend = stringResource(R.string.translation_analytics_charging_monthlyTrend)
    val energyKwh = stringResource(R.string.translation_analytics_charging_energykWh)
    val avgPowerKw = stringResource(R.string.translation_analytics_charging_avgPowerkW)
    val sessionsSeries = stringResource(R.string.translation_analytics_charging_sessions)
    val noMonthly = stringResource(R.string.translation_analytics_charging_noMonthly)
    val costAnalysis = stringResource(R.string.translation_analytics_charging_costAnalysis)
    val minCost = stringResource(R.string.translation_analytics_charging_minCost)
    val avgCost = stringResource(R.string.translation_analytics_charging_avgCost)
    val medianCost = stringResource(R.string.translation_analytics_charging_medianCost)
    val maxCost = stringResource(R.string.translation_analytics_charging_maxCost)
    val noCostStats = stringResource(R.string.translation_analytics_charging_noCostStats)
    val costByType = stringResource(R.string.translation_analytics_charging_costByType)
    val noCostByType = stringResource(R.string.translation_analytics_charging_noCostByType)
    return remember(
        chargerBrands,
        sessions,
        noBrands,
        monthlyTrend,
        energyKwh,
        avgPowerKw,
        noMonthly,
        costAnalysis,
        minCost,
        avgCost,
        medianCost,
        maxCost,
        noCostStats,
        costByType,
        noCostByType,
    ) {
        ChargingDetailSectionStrings(
            chargerBrands = chargerBrands,
            sessions = sessions,
            noBrands = noBrands,
            monthlyTrend = monthlyTrend,
            energyKwh = energyKwh,
            avgPowerKw = avgPowerKw,
            sessionsSeries = sessionsSeries,
            noMonthly = noMonthly,
            costAnalysis = costAnalysis,
            minCost = minCost,
            avgCost = avgCost,
            medianCost = medianCost,
            maxCost = maxCost,
            noCostStats = noCostStats,
            costByType = costByType,
            noCostByType = noCostByType,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChargingFreshnessFormatter(): (FreshnessAge) -> String {
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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time
 * by the consuming `Icon`/`MetricCard` — the same approach as the sibling SecurityStatistics glyphs.
 */
private object ChargingDetailGlyphs {
    /** lucide `dollar-sign` — a vertical shaft crossed by an S (the four cost cards + cost empty state). */
    val DollarSign: ImageVector =
        chargingVector("ChargingDetailDollarSign") {
            moveTo(12f, 1f)
            lineTo(12f, 23f)
            moveTo(17f, 5f)
            lineTo(9.5f, 5f)
            curveTo(7.57f, 5f, 6f, 6.57f, 6f, 8.5f)
            curveTo(6f, 10.43f, 7.57f, 12f, 9.5f, 12f)
            lineTo(14.5f, 12f)
            curveTo(16.43f, 12f, 18f, 13.57f, 18f, 15.5f)
            curveTo(18f, 17.43f, 16.43f, 19f, 14.5f, 19f)
            lineTo(6f, 19f)
        }

    /** lucide `zap` — a lightning bolt (the charging-themed empty states). */
    val Zap: ImageVector =
        chargingVector("ChargingDetailZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }
}

private fun chargingVector(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    ChargingDetailSectionStrings(
        chargerBrands = "Charger Brands",
        sessions = "sessions",
        noBrands = "No charger brand data",
        monthlyTrend = "Monthly Charging Trend",
        energyKwh = "Energy (kWh)",
        avgPowerKw = "Avg Power (kW)",
        sessionsSeries = "Sessions",
        noMonthly = "No monthly data",
        costAnalysis = "Cost Analysis",
        minCost = "Min Cost",
        avgCost = "Avg Cost",
        medianCost = "Median Cost",
        maxCost = "Max Cost",
        noCostStats = "No cost statistics",
        costByType = "Cost by Charger Type",
        noCostByType = "No charger type data",
    )

private val PREVIEW_DATA =
    ChargingAnalyticsData(
        brands =
            listOf(
                ChargerBrand("Tesla Supercharger", 1_204),
                ChargerBrand("Home", 877),
                ChargerBrand("Electrify America", 132),
            ),
        chargerTypes =
            listOf(
                ChargerType("DC Fast", 612),
                ChargerType("Level 2", 1_388),
                ChargerType("Level 1", 213),
            ),
        monthlyTrend =
            listOf(
                MonthlyChargingPoint("Jan", energy = 412.0, avgPower = 48.0, sessions = 22),
                MonthlyChargingPoint("Feb", energy = 388.0, avgPower = 51.0, sessions = 19),
                MonthlyChargingPoint("Mar", energy = 502.0, avgPower = 57.0, sessions = 26),
            ),
        costStats = CostStats(min = 1.24, avg = 8.97, median = 7.50, max = 42.10),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChargingDetailSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingDetailSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChargingDetailSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingDetailSectionContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargingDetailSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingDetailSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChargingDetailSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingDetailSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ChargingDetailSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingDetailSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
