// The native Jetpack Compose + Material 3 Time-of-Use rate-analysis feature view — a parity port of
// web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx. The web component is purely
// presentational: a `GlassPanel` titled with a clock glyph, holding a responsive grid of (1) an hourly
// sessions bar chart with a peak/mid/off-peak legend and (2) four insight cards (Cheapest / Priciest /
// Busiest hour + Off-Peak charging ratio). Each region has its own empty branch ("Not enough data" /
// "No insights available") and is never hidden.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hooks are `useTranslation`, mapped to the i18n catalog, and `useChartPalette`, mapped to the design
// tokens). The host supplies the precomputed `hourlyData` + `touInsights` through the shared P1/S8
// state-holder layer as a [UiState], so this feature view renders every lifecycle state that layer can
// carry — loading, hard error with retry, content/empty, and stale/offline (cached "last known") — without
// ever fetching. A web-parity overload that takes the raw `hourlyData` / `touInsights` props is also
// provided for hosts that already hold the derived values.
//
// Colors map to design tokens (never raw hex in render code): the single session bar series uses
// `paletteColor(0)` (the Okabe-Ito categorical[0] the web `useChartPalette()[0]` resolves for mid-peak
// bars); the legend bands reproduce the web swatches via the chart palette — peak → `chart.temperature`
// (#ef4444), mid-peak → `chart.regen` (#06b6d4, the toned counterpart of the web neon `#00f0ff`), off-peak →
// `chart.battery` (#10b981); the insight values use semantic accents — cheapest → `status.success`,
// priciest → `status.danger`, busiest → `chart.regen`, off-peak ratio → `chart.battery`. Per-bar `<Cell>`
// tinting is the shared renderer's concern — feature views must not import Vico nor alter the shared chart
// layer (allowed-files) — so the chart carries one color per series and the per-band palette is reproduced
// faithfully in the legend, exactly as the sibling ChargerTypeChart surface documents.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TimeOfUseAnalysis — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.timeofuseanalysis

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ResponsiveContainer height={260}>` plot height, reused for the loading/empty chrome. */
private val CHART_HEIGHT: Dp = 260.dp

/** The web `h-32` (128 dp) height of the "No insights available" empty state. */
private val INSIGHTS_EMPTY_HEIGHT: Dp = 128.dp

/** Minimum width at which the chart + insights sit side by side (the web `lg:` breakpoint). */
private val WIDE_BREAKPOINT: Dp = 560.dp

/** Chart column flex weight on a wide layout — the web `lg:col-span-2`. */
private const val CHART_WEIGHT: Float = 2f

/** Insights column flex weight on a wide layout — the remaining `lg:grid-cols-3` column. */
private const val INSIGHTS_WEIGHT: Float = 1f

/** The single bar series key — the web `<Bar dataKey="sessions" />`. */
private const val SESSIONS_SERIES_KEY: String = "sessions"

/** Legend entry keys for the three time-of-use bands. */
private const val PEAK_KEY: String = "peak"
private const val MID_PEAK_KEY: String = "midPeak"
private const val OFF_PEAK_KEY: String = "offPeak"

/** Currency glyph prefixed to the average-cost caption — the web `$` literal. */
private const val CURRENCY_SYMBOL: String = "$"

/** Fraction digits for the average session cost (web `fmtNumber(cost, 3)`). */
private const val COST_DECIMALS: Int = 3

/** Fraction digits for the off-peak percentage (web `fmtNumber(pct, 1)`). */
private const val PERCENT_DECIMALS: Int = 1

/** Fraction digits for the integer Y axis / session counts (web `fmtInt`). */
private const val AXIS_DECIMALS: Int = 0

/** Insight value lines — the figure never wraps. */
private const val VALUE_MAX_LINES: Int = 1

/** Em dash shown when a freshness age is unknown — the sibling surfaces' freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Time-of-Use analysis. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared cost-analysis feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the derived [TimeOfUseData] (web `hourlyData` +
 *   `touInsights`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TimeOfUseAnalysis(
    state: UiState<TimeOfUseData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordTimeOfUseAnalysisOpened(logger) }
    TimeOfUseAnalysisContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `hourlyData` / `touInsights` props, for hosts that
 * already hold the derived values. Both regions render their own empty branch when the inputs are empty /
 * `null`. Records `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry.
 */
@Composable
fun TimeOfUseAnalysis(
    hourlyData: List<TouHourBucket>,
    touInsights: TouInsights?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(hourlyData, touInsights) {
            val empty = hourlyData.isEmpty() && touInsights == null
            UiState(
                phase = if (empty) UiPhase.Empty else UiPhase.Content,
                data = TimeOfUseData(hourlyData, touInsights),
            )
        }
    TimeOfUseAnalysis(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Frames the panel chrome (clock
 * glyph + title + an optional freshness chip) and switches the body between the loading spinner, the hard
 * error + retry surface, and the content/empty body (chart + insights). Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the session counts, costs, and percentages.
 */
@Composable
fun TimeOfUseAnalysisContent(
    state: UiState<TimeOfUseData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: TimeOfUseStrings = rememberTimeOfUseStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier) {
        TimeOfUseHeader(title = strings.title, state = state)
        Spacer(Modifier.height(Spacing.md))
        when {
            state.isLoading -> TimeOfUseLoading()
            state.isError -> TimeOfUseError(onRetry = onRetry)
            else -> TimeOfUseBody(data = state.data ?: EMPTY_DATA, locale = locale, strings = strings)
        }
    }
}

/**
 * The panel header — a clock glyph (web amber `Clock`), the localized title, and, when cached data is
 * refreshing / stale / offline, the honest "last known + retry" freshness chip.
 */
@Composable
private fun TimeOfUseHeader(
    title: String,
    state: UiState<*>,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Clock,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.energy,
        )
        PanelTitle(title, modifier = Modifier.weight(1f))
        val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
        if (showFreshness) {
            TimeOfUseFreshnessChip(state)
        }
    }
}

/** Centered loading mark sized to the chart region so the panel never collapses to a blank box. */
@Composable
private fun TimeOfUseLoading() {
    Box(
        modifier = Modifier.fillMaxWidth().height(CHART_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        Spinner(accessibleLabel = stringResource(R.string.translation_common_loading))
    }
}

/** Hard-error surface with a localized message + retry — the web parent's error fallback. */
@Composable
private fun TimeOfUseError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * The content/empty body — the web responsive grid. On a wide layout the chart spans two columns beside the
 * insights column (web `lg:grid-cols-3` + `lg:col-span-2`); otherwise the two regions stack. Each region
 * renders its own empty branch, so neither is ever hidden.
 */
@Composable
private fun TimeOfUseBody(
    data: TimeOfUseData,
    locale: Locale,
    strings: TimeOfUseStrings,
) {
    val formatters = rememberTimeOfUseFormatters(strings, locale)
    val result = remember(data, strings, formatters) { TimeOfUseAnalysisProjection.project(data, strings, formatters) }
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        if (maxWidth >= WIDE_BREAKPOINT) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Box(modifier = Modifier.weight(CHART_WEIGHT)) {
                    TimeOfUseChartSection(chart = result.chart, strings = strings, locale = locale)
                }
                Box(modifier = Modifier.weight(INSIGHTS_WEIGHT)) {
                    TimeOfUseInsightsSection(result = result, strings = strings)
                }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                TimeOfUseChartSection(chart = result.chart, strings = strings, locale = locale)
                TimeOfUseInsightsSection(result = result, strings = strings)
            }
        }
    }
}

/**
 * The hourly sessions bar chart + the time-of-use band legend (always shown, like the web). When the chart
 * is empty the shared wrapper renders the localized "Not enough data" empty state at the chart height.
 */
@Composable
private fun TimeOfUseChartSection(
    chart: TimeOfUseChartData,
    strings: TimeOfUseStrings,
    locale: Locale,
) {
    val sessionsColor = paletteColor(0)
    val series =
        remember(chart.sessionValues, strings.sessions, sessionsColor) {
            if (chart.isEmpty) {
                emptyList()
            } else {
                listOf(
                    ChartSeries(
                        key = SESSIONS_SERIES_KEY,
                        label = strings.sessions,
                        values = chart.sessionValues,
                        kind = ChartSeriesKind.Bar,
                        color = sessionsColor,
                    ),
                )
            }
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BarChartWrapper(
            series = series,
            xLabels = chart.xLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { value -> ChartFormat.number(value, AXIS_DECIMALS, locale) },
            emptyMessage = stringResource(R.string.translation_costAnalysis_charts_noData),
        )
        TimeOfUseLegend(strings)
    }
}

/**
 * The peak / mid-peak / off-peak band legend — the web color key. Reuses the shared [ChartLegend] (a
 * wrapping flow row with built-in swatch content descriptions), so it reads correctly on narrow screens and
 * for TalkBack.
 */
@Composable
private fun TimeOfUseLegend(strings: TimeOfUseStrings) {
    val peakColor = ratePeriodColor(RatePeriod.Peak)
    val midColor = ratePeriodColor(RatePeriod.MidPeak)
    val offColor = ratePeriodColor(RatePeriod.OffPeak)
    val entries =
        remember(strings, peakColor, midColor, offColor) {
            listOf(
                LegendEntry(key = PEAK_KEY, label = strings.peak, color = peakColor),
                LegendEntry(key = MID_PEAK_KEY, label = strings.midPeak, color = midColor),
                LegendEntry(key = OFF_PEAK_KEY, label = strings.offPeak, color = offColor),
            )
        }
    ChartLegend(entries = entries, modifier = Modifier.fillMaxWidth())
}

/**
 * The insights column — a section header plus the four insight cards (web `touInsights`) or the
 * "No insights available" empty state (web `: noInsights`). The region is never hidden.
 */
@Composable
private fun TimeOfUseInsightsSection(
    result: TimeOfUseProjectionResult,
    strings: TimeOfUseStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(strings.insights)
        if (result.hasInsights) {
            result.insightCards.forEach { card -> TimeOfUseInsightCard(card) }
        } else {
            Box(
                modifier = Modifier.fillMaxWidth().height(INSIGHTS_EMPTY_HEIGHT),
                contentAlignment = Alignment.Center,
            ) {
                Caption(strings.noInsights)
            }
        }
    }
}

/**
 * One insight card — a nested [GlassPanel] with a muted label, a semantically colored value, and a muted
 * caption (web insight `GlassPanel`). The whole card carries a single TalkBack description so it reads as
 * one unit.
 */
@Composable
private fun TimeOfUseInsightCard(card: TouInsightCard) {
    val description = "${card.label}, ${card.value}, ${card.caption}"
    GlassPanel(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = description },
        padding = PanelPadding.Sm,
    ) {
        Caption(card.label)
        Text(
            text = card.value,
            modifier = Modifier.padding(top = Spacing.xs),
            color = toneColor(card.tone),
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
            maxLines = VALUE_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        HelperText(card.caption, modifier = Modifier.padding(top = Spacing.xs))
    }
}

/**
 * The freshness chip rendered in the header when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun TimeOfUseFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberFreshnessFormatter(),
    )
}

/** Resolves an insight [tone] to its accent color via design tokens (P1/S9) — the web value text colors. */
@Composable
@ReadOnlyComposable
private fun toneColor(tone: TouTone): Color =
    when (tone) {
        TouTone.Cheapest -> TeslaTokens.status.success
        TouTone.Priciest -> TeslaTokens.status.danger
        TouTone.Busiest -> TeslaTokens.chart.regen
        TouTone.OffPeak -> TeslaTokens.chart.battery
    }

/**
 * Resolves a [RatePeriod] to its legend swatch color via the chart palette (P1/S9): peak → the web
 * `#ef4444` (`chart.temperature`), mid-peak → the toned cyan `chart.regen` (web neon `#00f0ff`), off-peak →
 * the web `#10b981` (`chart.battery`).
 */
@ReadOnlyComposable
@Composable
private fun ratePeriodColor(period: RatePeriod): Color =
    when (period) {
        RatePeriod.Peak -> TeslaTokens.chart.temperature
        RatePeriod.MidPeak -> TeslaTokens.chart.regen
        RatePeriod.OffPeak -> TeslaTokens.chart.battery
    }

/**
 * Builds the localized [TimeOfUseStrings] from the i18n catalog (P1/S10): every `costAnalysis.tou.*` key the
 * web component resolves plus the `costAnalysis.charts.noData` chart empty-state message is resolved at the
 * Compose boundary. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberTimeOfUseStrings(): TimeOfUseStrings {
    val title = stringResource(R.string.translation_costAnalysis_tou_title)
    val insights = stringResource(R.string.translation_costAnalysis_tou_insights)
    val cheapestHour = stringResource(R.string.translation_costAnalysis_tou_cheapestHour)
    val priciestHour = stringResource(R.string.translation_costAnalysis_tou_priciestHour)
    val busiestHour = stringResource(R.string.translation_costAnalysis_tou_busiestHour)
    val offPeakRatio = stringResource(R.string.translation_costAnalysis_tou_offPeakRatio)
    val offPeakDesc = stringResource(R.string.translation_costAnalysis_tou_offPeakDesc)
    val noInsights = stringResource(R.string.translation_costAnalysis_tou_noInsights)
    val avgCost = stringResource(R.string.translation_costAnalysis_tou_avgCost)
    val perSession = stringResource(R.string.translation_costAnalysis_tou_perSession)
    val sessions = stringResource(R.string.translation_costAnalysis_tou_sessions)
    val peak = stringResource(R.string.translation_costAnalysis_tou_peak)
    val midPeak = stringResource(R.string.translation_costAnalysis_tou_midPeak)
    val offPeak = stringResource(R.string.translation_costAnalysis_tou_offPeak)
    return remember(
        title,
        insights,
        cheapestHour,
        priciestHour,
        busiestHour,
        offPeakRatio,
        offPeakDesc,
        noInsights,
        avgCost,
        perSession,
        sessions,
        peak,
        midPeak,
        offPeak,
    ) {
        TimeOfUseStrings(
            title = title,
            insights = insights,
            cheapestHour = cheapestHour,
            priciestHour = priciestHour,
            busiestHour = busiestHour,
            offPeakRatio = offPeakRatio,
            offPeakDesc = offPeakDesc,
            noInsights = noInsights,
            avgCost = avgCost,
            perSession = perSession,
            sessions = sessions,
            peak = peak,
            midPeak = midPeak,
            offPeak = offPeak,
        )
    }
}

/**
 * Builds the locale-bound [TimeOfUseFormatters] — the average-cost caption (`avg $cost / session`), the
 * busiest-hour caption (`{count} sessions`), and the off-peak percentage (`{pct}%`). The currency glyph is
 * the web `$` literal; the number/percent grouping follows [locale]. Remembered so a locale change
 * re-projects.
 */
@Composable
private fun rememberTimeOfUseFormatters(
    strings: TimeOfUseStrings,
    locale: Locale,
): TimeOfUseFormatters {
    val avgCost = strings.avgCost
    val perSession = strings.perSession
    val sessions = strings.sessions
    return remember(avgCost, perSession, sessions, locale) {
        TimeOfUseFormatters(
            avgCostSummary = { cost ->
                "$avgCost $CURRENCY_SYMBOL${ChartFormat.number(cost, COST_DECIMALS, locale)} $perSession"
            },
            sessionsSummary = { count ->
                "${String.format(locale, "%,d", count)} $sessions"
            },
            percent = { pct ->
                "${ChartFormat.number(pct, PERCENT_DECIMALS, locale)}%"
            },
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Shared empty payload for the loading/error phases (no buckets, no insights). */
private val EMPTY_DATA = TimeOfUseData(emptyList(), null)

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    TimeOfUseStrings(
        title = "Electricity Rate Analysis (Time-of-Use)",
        insights = "Insights",
        cheapestHour = "Cheapest Hour",
        priciestHour = "Priciest Hour",
        busiestHour = "Busiest Hour",
        offPeakRatio = "Off-Peak Charging",
        offPeakDesc = "of sessions between 10 PM–6 AM",
        noInsights = "No insights available",
        avgCost = "avg",
        perSession = "/ session",
        sessions = "Sessions",
        peak = "Peak (2–7 PM)",
        midPeak = "Mid-peak",
        offPeak = "Off-peak (10 PM–6 AM)",
    )

private fun previewHourlyData(): List<TouHourBucket> =
    (0 until 24).map { hour ->
        val sessions = ((hour * 7) % 11).toLong()
        TouHourBucket(
            hour = hour,
            label = "${hour.toString().padStart(2, '0')}:00",
            sessions = sessions,
            avgCost = 0.10 + hour * 0.01,
            totalEnergy = sessions * 8.0,
        )
    }

private fun previewInsights(): TouInsights {
    val data = previewHourlyData()
    return TouInsights(
        cheapest = data[3],
        priciest = data[17],
        busiest = data[18],
        offPeakPct = 42.5,
    )
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TimeOfUseLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeOfUseAnalysisContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TimeOfUseEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeOfUseAnalysisContent(
            state = UiState(UiPhase.Empty, data = EMPTY_DATA),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TimeOfUseErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeOfUseAnalysisContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true, widthDp = 720)
@Composable
private fun TimeOfUseContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeOfUseAnalysisContent(
            state = UiState(UiPhase.Content, data = TimeOfUseData(previewHourlyData(), previewInsights())),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun TimeOfUseOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeOfUseAnalysisContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = TimeOfUseData(previewHourlyData(), previewInsights()),
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
