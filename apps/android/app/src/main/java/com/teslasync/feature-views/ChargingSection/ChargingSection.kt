// The native Jetpack Compose + Material 3 ChargingSection feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/ChargingSection.tsx. The web component is purely
// presentational: its parent (the Weekly Digest page) computes the `metrics` summary and the seven-day
// `dailyEnergyData` series via `useWeeklyDigest` and passes them down, and the component renders one
// charging GlassPanel — a "Charging" title row, a daily-energy bar chart, a four-tile stat row (sessions,
// total energy added, average charge rate, total cost), and a week-over-week energy badge — wrapped in a
// `<FadeIn>` entry animation.
//
// The native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its only web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useFormatting` (mapped
// to the currency symbol read from the shared settings store, P1/S8). The host supplies the decoded charging
// slice through the shared state-holder layer as a [UiState], so this feature view also renders every
// lifecycle state that layer can carry — loading skeleton, hard error with retry, content, and stale/offline
// (cached "last known") — without ever fetching. Every region always renders (the chart shows its own empty
// message, the stats show zeros, the badge shows "—") so no surface is ever a blank box. A web-parity
// overload that takes the raw `(metrics, dailyEnergy)` props is also provided.
//
// Every derivation flows through the pure [ChargingSectionProjection]; the composable is a thin render layer
// that resolves the i18n labels (P1/S10) and the design-token accents (P1/S9) and draws what they return.
// The bar chart uses the shared Vico-backed [BarChartWrapper] (the web `@/components/charts` BarChart), so
// the surface never imports a chart library directly. The one-shot PII-safe `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargingSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingsection

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Subhead
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

/** Web `<FadeIn delay={0.15}>` staggered entry delay, in milliseconds. */
private const val FADE_DELAY_MS = 150

/** Web `<ResponsiveContainer height={260}>` plot height. */
private val CHART_HEIGHT: Dp = 260.dp

/** Stable bar-series key (the web `dataKey="energy"`). */
private const val KEY_ENERGY = "energy"

/** Web `fill={CHART_COLORS[1]}` — the categorical palette index the source assigns to the energy bars. */
private const val COLOR_ENERGY = 1

// Responsive stat-row columns — the web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, aligned to the Tailwind
// `sm` (640px) and `lg` (1024px) breakpoints.
private val GRID_SM_MIN_WIDTH: Dp = 640.dp
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp
private const val GRID_COLUMNS_LG = 4
private const val GRID_COLUMNS_SM = 2
private const val GRID_COLUMNS_BASE = 1

/** The four stat tiles, matching the web component's fixed set. */
private const val STAT_COUNT = 4

// Loading skeleton geometry.
private const val SKELETON_TITLE_FRACTION = 0.3f
private val SKELETON_TITLE_HEIGHT = 18.dp
private val SKELETON_STAT_HEIGHT = 56.dp
private val SKELETON_BADGE_HEIGHT = 44.dp

/**
 * The already-localized strings the section renders. The web component is anonymous — it resolves every
 * label through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary
 * and are passed down, keeping the section free of any English literal.
 *
 * @property title web `analytics.weeklyDigest.chargingSection` ("Charging").
 * @property dailyEnergyAdded web `analytics.weeklyDigest.dailyEnergyAdded` ("Daily Energy Added (kWh)").
 * @property energyAdded web `analytics.weeklyDigest.energyAdded` ("Energy Added") — the bar series name.
 * @property sessions web `analytics.weeklyDigest.sessions` ("Sessions").
 * @property totalEnergyAdded web `analytics.weeklyDigest.totalEnergyAdded` ("Total Energy Added").
 * @property avgChargeRate web `analytics.weeklyDigest.avgChargeRate` ("Avg Charge Rate").
 * @property totalCost web `analytics.weeklyDigest.totalCost` ("Total Cost").
 * @property energyVsLastWeek web `analytics.weeklyDigest.energyVsLastWeek` ("Energy vs. Last Week").
 * @property noData the chart's empty-region message (web charts render empty axes; the native chart shows a
 *   friendly message so the region never blanks).
 */
data class ChargingSectionStrings(
    val title: String,
    val dailyEnergyAdded: String,
    val energyAdded: String,
    val sessions: String,
    val totalEnergyAdded: String,
    val avgChargeRate: String,
    val totalCost: String,
    val energyVsLastWeek: String,
    val noData: String,
)

/**
 * Stateful entry point for the charging section. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the user's currency symbol from the shared settings store (web `useFormatting`,
 * P1/S8), and renders every lifecycle [state] the host's feed can carry. The host owns the feed (P1/S8) and
 * supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded [ChargingDigestData].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the total-cost stat.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingSection(
    state: UiState<ChargingDigestData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { ChargingCurrencyPrefs.fromSettings(settingsResource.cached) }
    val locale: Locale = LocalConfiguration.current.locales[0]
    LaunchedEffect(Unit) { ChargingSectionDiagnostics.recordViewOpened(logger) }
    ChargingSectionContent(state = state, onRetry = onRetry, modifier = modifier, currency = currency, locale = locale)
}

/**
 * Web-parity overload mirroring the web component's `{ metrics, dailyEnergyData }` props (plus an explicit
 * [isLoading] for the host's first load). Projects the props onto a [UiState] via
 * [ChargingSectionProjection.projectUiState] and delegates to the stateful entry, which records
 * `view.opened` and resolves the currency symbol. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun ChargingSection(
    metrics: ChargingDigestMetrics,
    dailyEnergy: List<DailyEnergyPoint>,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(metrics, dailyEnergy, isLoading) {
            ChargingSectionProjection.projectUiState(ChargingDigestData(metrics, dailyEnergy), isLoading)
        }
    ChargingSection(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's charging panel (title, bar chart, four-tile stat row, week-over-week badge) and adds the
 * lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry surface, and a freshness
 * chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [currency] supplies the cost symbol; [locale] formats every number.
 */
@Composable
fun ChargingSectionContent(
    state: UiState<ChargingDigestData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currency: ChargingCurrencyPrefs = ChargingCurrencyPrefs.DEFAULT,
    locale: Locale = Locale.getDefault(),
    strings: ChargingSectionStrings = rememberChargingSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        when {
            state.isLoading -> ChargingSectionLoading()
            state.isError -> ChargingSectionError(onRetry = onRetry)
            else ->
                ChargingSectionPanel(
                    data = state.data ?: ChargingDigestData.EMPTY,
                    state = state,
                    currency = currency,
                    locale = locale,
                    strings = strings,
                )
        }
    }
}

/**
 * The web content body wrapped in its outer GlassPanel (web `space-y-6 p-6`): a freshness chip whenever the
 * cached data is refreshing / stale / offline, the "Charging" title, the daily-energy bar chart, the
 * four-tile stat row, and the week-over-week energy badge. [data] is the zeroed [ChargingDigestData.EMPTY]
 * in the [UiPhase.Empty] state, so every region still renders (the chart shows its empty message, the stats
 * read zeros, the badge reads "—").
 */
@Composable
private fun ChargingSectionPanel(
    data: ChargingDigestData,
    state: UiState<ChargingDigestData>,
    currency: ChargingCurrencyPrefs,
    locale: Locale,
    strings: ChargingSectionStrings,
) {
    GlassPanel(padding = PanelPadding.Lg, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            if (state.stale || state.refreshing || state.hasError) {
                ChargingFreshnessRow(state = state)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    ChargingSectionGlyphs.Zap,
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = TeslaTokens.chart.battery,
                )
                SectionTitle(strings.title)
            }
            DailyEnergyChart(data = data, locale = locale, strings = strings)
            ChargingStatRow(metrics = data.metrics, currency = currency, locale = locale, strings = strings)
            EnergyWeekOverWeek(metrics = data.metrics, locale = locale, strings = strings)
        }
    }
}

/** Web "Daily Energy Added (kWh)" panel — the bar chart over the seven-day series, or its empty message. */
@Composable
private fun DailyEnergyChart(
    data: ChargingDigestData,
    locale: Locale,
    strings: ChargingSectionStrings,
) {
    GlassPanel(padding = PanelPadding.Md, modifier = Modifier.fillMaxWidth()) {
        Caption(strings.dailyEnergyAdded, modifier = Modifier.padding(bottom = Spacing.sm))
        val bar = remember(data) { ChargingSectionProjection.barData(data.dailyEnergy) }
        val energyColor = paletteColor(COLOR_ENERGY)
        val series =
            remember(bar, energyColor, strings) {
                listOf(ChartSeries(KEY_ENERGY, strings.energyAdded, bar.values, ChartSeriesKind.Bar, energyColor))
            }
        BarChartWrapper(
            series = series,
            xLabels = bar.labels,
            modifier = Modifier.fillMaxWidth(),
            height = CHART_HEIGHT,
            yValueFormatter = { ChargingSectionProjection.fmtNumber(it, ENERGY_DECIMALS, locale) },
            emptyMessage = strings.noData,
        )
    }
}

/** Web charging stat row — four MiniStats in a responsive 1 / 2 / 4-column grid (`grid-cols-1 sm lg`). */
@Composable
private fun ChargingStatRow(
    metrics: ChargingDigestMetrics,
    currency: ChargingCurrencyPrefs,
    locale: Locale,
    strings: ChargingSectionStrings,
) {
    val stats = remember(metrics, currency, locale) { ChargingSectionProjection.statValues(metrics, currency, locale) }
    val tiles =
        listOf<@Composable (Modifier) -> Unit>(
            { tileModifier ->
                MiniStat(strings.sessions, stats.sessions, ChargingSectionGlyphs.Zap, tileModifier)
            },
            { tileModifier ->
                MiniStat(strings.totalEnergyAdded, stats.totalEnergyAdded, ChargingSectionGlyphs.Zap, tileModifier)
            },
            { tileModifier ->
                MiniStat(strings.avgChargeRate, stats.avgChargeRate, ChargingSectionGlyphs.Activity, tileModifier)
            },
            { tileModifier ->
                MiniStat(strings.totalCost, stats.totalCost, ChargingSectionGlyphs.Fuel, tileModifier)
            },
        )
    StatGrid(tiles = tiles)
}

/**
 * One MiniStat tile — the Android mirror of the web weekly-digest `MiniStat`: an icon beside a label/value
 * column inside a GlassPanel (web `flex items-center gap-3 px-4 py-3`). The label is muted, the value is
 * the prominent semibold line (web `text-xs text-secondary` / `text-sm font-semibold text-white`).
 */
@Composable
private fun MiniStat(
    label: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    GlassPanel(padding = PanelPadding.Sm, modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                icon,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.chart.battery,
            )
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MetricLabel(label)
                Subhead(value)
            }
        }
    }
}

/**
 * Lays out the four [tiles] as the web responsive grid: four-per-row at or above [GRID_LG_MIN_WIDTH]
 * (`lg:4`), two-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:2`), and stacked below it (`default:1`). Each
 * tile fills its column via [Modifier.weight]; a partial trailing row is padded with weighted spacers so the
 * tiles keep a uniform width. Cells are spaced by `Spacing.sm`, the native expression of the web `gap-3`.
 */
@Composable
private fun StatGrid(
    tiles: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            tiles.chunked(columns).forEach { rowTiles ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    rowTiles.forEach { tile -> tile(Modifier.weight(1f)) }
                    repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Web "Energy vs. Last Week" row — a muted label beside a success/warning [Badge] carrying the signed
 * percent change (or "—" when there is no prior-week baseline). Web `flex items-center gap-4 px-4 py-3`.
 */
@Composable
private fun EnergyWeekOverWeek(
    metrics: ChargingDigestMetrics,
    locale: Locale,
    strings: ChargingSectionStrings,
) {
    val trend = remember(metrics, locale) { ChargingSectionProjection.energyTrend(metrics, locale) }
    GlassPanel(padding = PanelPadding.Sm, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(strings.energyVsLastWeek)
            Badge(
                text = trend.text,
                variant = if (trend.positive) BadgeVariant.Success else BadgeVariant.Warning,
            )
        }
    }
}

/** The loading branch: skeleton chrome so the section never collapses to a blank box. */
@Composable
private fun ChargingSectionLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    GlassPanel(
        padding = PanelPadding.Lg,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT, rounded = true)
            GlassPanel(padding = PanelPadding.Md, modifier = Modifier.fillMaxWidth()) {
                Skeleton(modifier = Modifier.fillMaxWidth(), height = CHART_HEIGHT, rounded = true)
            }
            repeat(STAT_COUNT / GRID_COLUMNS_SM) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    repeat(GRID_COLUMNS_SM) {
                        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_STAT_HEIGHT, rounded = true)
                    }
                }
            }
            Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_BADGE_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun ChargingSectionError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Lg, modifier = Modifier.fillMaxWidth()) {
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
private fun ChargingFreshnessRow(state: UiState<ChargingDigestData>) {
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
 * Builds the localized [ChargingSectionStrings] from the i18n catalog (P1/S10): the eight
 * `analytics.weeklyDigest.*` keys the web component reads through `useTranslation`, plus the shared no-data
 * key for the chart's empty region. Resolved once at the Compose boundary so the rest of the surface stays
 * free of any English literal.
 */
@Composable
private fun rememberChargingSectionStrings(): ChargingSectionStrings {
    val title = stringResource(R.string.translation_analytics_weeklyDigest_chargingSection)
    val dailyEnergyAdded = stringResource(R.string.translation_analytics_weeklyDigest_dailyEnergyAdded)
    val energyAdded = stringResource(R.string.translation_analytics_weeklyDigest_energyAdded)
    val sessions = stringResource(R.string.translation_analytics_weeklyDigest_sessions)
    val totalEnergyAdded = stringResource(R.string.translation_analytics_weeklyDigest_totalEnergyAdded)
    val avgChargeRate = stringResource(R.string.translation_analytics_weeklyDigest_avgChargeRate)
    val totalCost = stringResource(R.string.translation_analytics_weeklyDigest_totalCost)
    val energyVsLastWeek = stringResource(R.string.translation_analytics_weeklyDigest_energyVsLastWeek)
    val noData = stringResource(R.string.translation_analytics_weeklyDigest_noData)
    return remember(
        title,
        dailyEnergyAdded,
        energyAdded,
        sessions,
        totalEnergyAdded,
        avgChargeRate,
        totalCost,
        energyVsLastWeek,
        noData,
    ) {
        ChargingSectionStrings(
            title = title,
            dailyEnergyAdded = dailyEnergyAdded,
            energyAdded = energyAdded,
            sessions = sessions,
            totalEnergyAdded = totalEnergyAdded,
            avgChargeRate = avgChargeRate,
            totalCost = totalCost,
            energyVsLastWeek = energyVsLastWeek,
            noData = noData,
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
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time by
 * the consuming `Icon` — the same approach as the sibling feature-view glyphs. The web uses lucide `Zap`
 * (title + first two stats), `Activity` (charge rate), and `Fuel` (total cost).
 */
private object ChargingSectionGlyphs {
    /** lucide `zap` — a lightning bolt. */
    val Zap: ImageVector =
        chargingVector("ChargingSectionZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `activity` — a pulse line. */
    val Activity: ImageVector =
        chargingVector("ChargingSectionActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `fuel` — a fuel pump: a rounded tank, a base, a divider line, and the pump arm. */
    val Fuel: ImageVector =
        chargingVector("ChargingSectionFuel") {
            moveTo(3f, 22f)
            lineTo(15f, 22f)
            moveTo(4f, 22f)
            lineTo(4f, 4f)
            curveTo(4f, 2.9f, 4.9f, 2f, 6f, 2f)
            lineTo(12f, 2f)
            curveTo(13.1f, 2f, 14f, 2.9f, 14f, 4f)
            lineTo(14f, 22f)
            moveTo(4f, 10f)
            lineTo(14f, 10f)
            moveTo(14f, 13f)
            lineTo(16f, 13f)
            curveTo(17.1f, 13f, 18f, 13.9f, 18f, 15f)
            lineTo(18f, 17f)
            curveTo(18f, 18.1f, 18.9f, 19f, 20f, 19f)
            curveTo(21.1f, 19f, 22f, 18.1f, 22f, 17f)
            lineTo(22f, 9.83f)
            curveTo(22f, 9.3f, 21.79f, 8.79f, 21.41f, 8.41f)
            lineTo(18f, 5f)
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
    ChargingSectionStrings(
        title = "Charging",
        dailyEnergyAdded = "Daily Energy Added (kWh)",
        energyAdded = "Energy Added",
        sessions = "Sessions",
        totalEnergyAdded = "Total Energy Added",
        avgChargeRate = "Avg Charge Rate",
        totalCost = "Total Cost",
        energyVsLastWeek = "Energy vs. Last Week",
        noData = "No Data",
    )

private val PREVIEW_DATA =
    ChargingDigestData(
        metrics =
            ChargingDigestMetrics(
                chargeEnergyAdded = 312.4,
                prevChargeEnergy = 280.0,
                avgChargeRate = 48.6,
                chargingCost = 41.27,
                chargingSessionCount = 12,
            ),
        dailyEnergy =
            listOf(
                DailyEnergyPoint("Mon", 42.0),
                DailyEnergyPoint("Tue", 0.0),
                DailyEnergyPoint("Wed", 61.5),
                DailyEnergyPoint("Thu", 38.2),
                DailyEnergyPoint("Fri", 55.0),
                DailyEnergyPoint("Sat", 71.4),
                DailyEnergyPoint("Sun", 44.3),
            ),
    )

@Preview(name = "Content — up week", showBackground = true)
@Composable
private fun ChargingSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSectionContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            currency = ChargingCurrencyPrefs("$"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargingSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSectionContent(
            state = UiState.loading(),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty — no charging", showBackground = true)
@Composable
private fun ChargingSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSectionContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            currency = ChargingCurrencyPrefs("$"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChargingSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline — stale cached", showBackground = true)
@Composable
private fun ChargingSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            currency = ChargingCurrencyPrefs("$"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
