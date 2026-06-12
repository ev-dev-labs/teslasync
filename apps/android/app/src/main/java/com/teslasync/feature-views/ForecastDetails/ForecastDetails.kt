// The native Jetpack Compose + Material 3 ForecastDetails feature view — a parity port of
// web/src/features/charging/components/cost-analysis/ForecastDetails.tsx. The web component is a presentational
// child the Cost Analysis page drives with its cost-forecast snapshot: three `<FadeIn>`-entering GlassPanels in
// a `grid-cols-1 lg:grid-cols-3` — a Home-vs-Supercharger charging-cost donut with a per-source `/kWh` legend,
// a Gas-vs-EV savings block (a `$`-prefixed monthly-savings count-up, annual / lifetime figures, and the
// monthly gas cost / EV cost / average distance), and a list of free-text insights.
//
// This port keeps that composition end to end. It performs NO HTTP and binds no data feed of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog, and `useFormatting`, mapped to the shared settings
// store's currency symbol). The owning page supplies the forecast through the shared P1/S8 state-holder layer
// as a [UiState], so this surface renders every lifecycle state that layer can carry — a loading skeleton, a
// hard error with retry, the populated grid, the data-resolved-but-empty grid (each panel showing its own
// friendly empty state, exactly as the web `forecastData ? … : <EmptyState/>` branches do), and a
// stale/offline "last known" grid with a freshness chip + auto-refresh. A web-parity overload that takes the
// raw `forecastData` prop is also provided for hosts that already hold the loaded value. Every value
// derivation flows through the pure [ForecastDetailsProjection]; the composable is a thin render layer.
//
// Colors: the donut's Home slice maps to the success status token (the web `#22c55e` green) and the
// Supercharger slice to `ChartPalette.energy` (the exact `#F59E0B` amber the web `<Cell fill="#f59e0b">` uses).
// The savings headline + EV cost take the success token (web `text-emerald-300` / `text-green-400`), the gas
// cost the danger token (web `text-red-400`), and the insights' Lightbulb/Zap accents the warning token (web
// `text-neon-amber`). The donut is drawn with Compose Canvas arcs (the shared chart layer ships no donut, and
// feature views must not import the chart engine directly), exactly as the sibling ChargingBreakdownSlide does.
//
// Accessibility: the donut exposes one combined "Home N%, Supercharger M%" description instead of unreadable
// arcs; the monthly-savings count-up exposes its settled value so TalkBack never reads a half-counted figure;
// decorative legend dots / header icons are cleared from the tree. Entrances honor reduced motion (P1/S9,
// `rememberReducedMotion` via the shared `FadeIn` + the count-up's snap-to-final).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ForecastDetails — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.forecastdetails

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
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
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

// ── Layout geometry (web Tailwind / Recharts values, reproduced) ────────────────────────────────────

/** Width at/above which the web `lg:grid-cols-3` 3-column layout kicks in (Material 3 expanded breakpoint). */
private const val EXPANDED_WIDTH_DP: Int = 840

/** Web donut box `height={180}`. */
private val DONUT_SIZE: Dp = 176.dp

/** Mid-ring radius — the mean of the web `outerRadius={75}` / `innerRadius={50}`. */
private val DONUT_RING_RADIUS: Dp = 62.dp

/** Ring thickness — the web `outerRadius - innerRadius` (75 − 50). */
private val DONUT_RING_THICKNESS: Dp = 25.dp

/** Donut sweep origin: 12 o'clock, so the first slice grows clockwise from the top. */
private const val DONUT_START_ANGLE: Float = -90f

/** A full revolution in degrees. */
private const val FULL_SWEEP: Float = 360f

/** Web legend swatch `h-2 w-2` (8px) dot. */
private val LEGEND_DOT: Dp = 8.dp

/** Monthly-savings count-up duration — the web `<AnimatedNumber>` default `duration={1}` (1s). */
private const val COUNT_UP_MS: Int = 1_000

/** First-load skeleton body height (a donut-ish block so a loading panel is never blank). */
private val SKELETON_BODY_HEIGHT: Dp = 140.dp
private val SKELETON_TITLE_HEIGHT: Dp = 18.dp
private const val SKELETON_TITLE_FRACTION: Float = 0.6f

// ── Web alpha washes (savings card 6%, stat tile 4%, insight chip 3%) as token-color alphas ─────────
private const val SAVINGS_CARD_FILL_ALPHA: Float = 0.06f
private const val TILE_FILL_ALPHA: Float = 0.05f
private const val INSIGHT_FILL_ALPHA: Float = 0.04f

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), resolves the user's
 * currency symbol from the shared settings store (web `useFormatting`, P1/S8), and renders every lifecycle
 * [state] the host's cost-forecast feed can carry. The owning page holds the query (P1/S8) and supplies
 * [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the web `forecastData` prop.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats every money figure.
 */
@Composable
fun ForecastDetails(
    state: UiState<ForecastData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
) {
    LaunchedEffect(Unit) { ForecastDetailsDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { ForecastDetailsCurrencyPrefs.fromSettings(settingsResource.cached) }
    ForecastDetailsContent(state = state, currency = currency, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `forecastData: CostForecastData | undefined` prop, for
 * hosts that already hold the loaded value. A `null` value renders the empty grid (each panel showing its own
 * empty state, matching the web `undefined` branch); a present value renders the populated grid. Records
 * `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ForecastDetails(
    forecastData: ForecastData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
) {
    val state =
        remember(forecastData) {
            if (forecastData == null) UiState(UiPhase.Empty) else UiState(UiPhase.Content, data = forecastData)
        }
    ForecastDetails(state = state, onRetry = {}, modifier = modifier, logger = logger, settings = settings)
}

/**
 * Stateless renderer for every surface state — the UI-test + preview entry point. Swaps the body by state: a
 * three-panel skeleton grid while loading, a `QueryError` with retry on a hard failure with no cache, and
 * otherwise the three-panel forecast grid (each panel rendering its data or its own friendly empty state, with
 * a freshness chip when the cached data is refreshing / stale / offline). Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] resolves the money / number grouping.
 */
@Composable
fun ForecastDetailsContent(
    state: UiState<ForecastData>,
    modifier: Modifier = Modifier,
    currency: ForecastDetailsCurrencyPrefs = ForecastDetailsCurrencyPrefs.DEFAULT,
    onRetry: () -> Unit = {},
    locale: Locale = LocalConfiguration.current.locales[0],
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRetry()
    }
    Box(modifier = modifier.fillMaxWidth()) {
        when {
            state.isLoading -> ForecastLoading(label = stringResource(R.string.translation_a11y_loading))
            state.isError && !state.hasData -> ForecastError(state = state, onRetry = onRetry)
            else -> ForecastLoaded(state = state, currency = currency, locale = locale)
        }
    }
}

/**
 * The populated grid (also the data-resolved-but-empty and stale/offline grid). Projects the cached value (or
 * `null` in the empty phase) once, resolves the token palette + accents, and lays the three panels out
 * responsively with an optional freshness chip above them.
 */
@Composable
private fun ForecastLoaded(
    state: UiState<ForecastData>,
    currency: ForecastDetailsCurrencyPrefs,
    locale: Locale,
) {
    val perKwhWord = stringResource(R.string.translation_charging_detail_perKwh)
    val display =
        remember(state.data, currency, perKwhWord, locale) {
            state.data?.let {
                ForecastDetailsProjection.project(it, currency.currencySymbol, perKwhWord, locale)
            }
        }
    val palette = listOf(TeslaTokens.status.success, TeslaTokens.chart.energy)
    val success = TeslaTokens.status.success
    val danger = TeslaTokens.status.danger
    val warning = TeslaTokens.status.warning
    val reduceMotion = rememberReducedMotion()
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (showFreshness) {
            ForecastFreshnessRow(state)
        }
        ForecastGrid(
            breakdown = { BreakdownPanel(display = display, palette = palette) },
            savings = {
                SavingsPanel(
                    display = display,
                    currencySymbol = currency.currencySymbol,
                    locale = locale,
                    reduceMotion = reduceMotion,
                    accentSuccess = success,
                    accentDanger = danger,
                )
            },
            insights = { InsightsPanel(display = display, accent = warning) },
        )
    }
}

/**
 * Responsive arrangement of the three panels — the native expression of the web `grid-cols-1 lg:grid-cols-3`:
 * a single stacked [Column] on phones, and a three-up [Row] of equal-weight columns at/above the expanded
 * width breakpoint (tablets / unfolded foldables / landscape).
 */
@Composable
private fun ForecastGrid(
    breakdown: @Composable () -> Unit,
    savings: @Composable () -> Unit,
    insights: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    val wide = LocalConfiguration.current.screenWidthDp >= EXPANDED_WIDTH_DP
    if (wide) {
        Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Box(modifier = Modifier.weight(1f)) { breakdown() }
            Box(modifier = Modifier.weight(1f)) { savings() }
            Box(modifier = Modifier.weight(1f)) { insights() }
        }
    } else {
        Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            breakdown()
            savings()
            insights()
        }
    }
}

// ── Breakdown panel (web donut + per-source /kWh legend) ─────────────────────────────────────────────

@Composable
private fun BreakdownPanel(
    display: ForecastDetailsDisplay?,
    palette: List<Color>,
    modifier: Modifier = Modifier,
) {
    val home = stringResource(R.string.translation_Home)
    val supercharger = stringResource(R.string.translation_Supercharger)
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            PanelTitle(stringResource(R.string.translation_costAnalysis_forecast_breakdown))
            Spacer(modifier = Modifier.height(Spacing.md))
            if (display == null) {
                EmptyState(message = stringResource(R.string.translation_costAnalysis_forecast_noBreakdown))
            } else {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    BreakdownDonut(
                        breakdown = display.breakdown,
                        palette = palette,
                        contentDescription = donutDescription(display.breakdown, home, supercharger),
                    )
                    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        display.breakdown.forEachIndexed { index, slice ->
                            BreakdownLegendRow(
                                color = palette[index % palette.size],
                                label = breakdownLabel(slice.kind, home, supercharger),
                                value = slice.costPerKwhLabel,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * The donut ring — the native counterpart of the web `<PieChart><Pie innerRadius={50} outerRadius={75}
 * dataKey="value">`. Each slice is a stroked Canvas arc whose sweep is proportional to its `pct` (via the pure
 * [ForecastDetailsProjection.sweepFractions]); slice colors are positional (web `<Cell fill>`). The whole ring
 * exposes one combined [contentDescription] so TalkBack reads the mix instead of decorative arcs.
 */
@Composable
private fun BreakdownDonut(
    breakdown: List<BreakdownSlice>,
    palette: List<Color>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val fractions = remember(breakdown) { ForecastDetailsProjection.sweepFractions(breakdown) }
    Canvas(
        modifier =
            modifier
                .size(DONUT_SIZE)
                .clearAndSetSemantics { this.contentDescription = contentDescription },
    ) {
        val ringRadiusPx = DONUT_RING_RADIUS.toPx()
        val strokePx = DONUT_RING_THICKNESS.toPx()
        val topLeft = Offset(center.x - ringRadiusPx, center.y - ringRadiusPx)
        val arcSize = Size(ringRadiusPx * 2f, ringRadiusPx * 2f)
        var startAngle = DONUT_START_ANGLE
        fractions.forEachIndexed { index, fraction ->
            val sweep = (fraction * FULL_SWEEP).toFloat()
            if (sweep > 0f) {
                drawArc(
                    color = palette[index % palette.size],
                    startAngle = startAngle,
                    sweepAngle = sweep,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokePx, cap = StrokeCap.Butt),
                )
            }
            startAngle += sweep
        }
    }
}

/** One legend row — a colored dot + source label on the left, the formatted per-kWh rate on the right. */
@Composable
private fun BreakdownLegendRow(
    color: Color,
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(color))
            Caption(label)
        }
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

// ── Savings panel (web gas-vs-EV block) ──────────────────────────────────────────────────────────────

@Composable
private fun SavingsPanel(
    display: ForecastDetailsDisplay?,
    currencySymbol: String,
    locale: Locale,
    reduceMotion: Boolean,
    accentSuccess: Color,
    accentDanger: Color,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            PanelHeaderRow(
                icon = ForecastDetailsGlyphs.Fuel,
                tint = accentSuccess,
                title = stringResource(R.string.translation_costAnalysis_forecast_savings),
            )
            Spacer(modifier = Modifier.height(Spacing.md))
            if (display == null) {
                EmptyState(message = stringResource(R.string.translation_costAnalysis_forecast_noSavings))
            } else {
                Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    MonthlySavingsCard(
                        display = display,
                        currencySymbol = currencySymbol,
                        locale = locale,
                        reduceMotion = reduceMotion,
                        accent = accentSuccess,
                    )
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        SavingsStatTile(
                            label = stringResource(R.string.translation_costAnalysis_forecast_annual),
                            value = display.annualText,
                            modifier = Modifier.weight(1f),
                        )
                        SavingsStatTile(
                            label = stringResource(R.string.translation_costAnalysis_forecast_lifetime),
                            value = display.lifetimeText,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        SavingsCostRow(
                            label = stringResource(R.string.translation_costAnalysis_forecast_gasCost),
                            value = display.gasCostText,
                            valueColor = accentDanger,
                        )
                        SavingsCostRow(
                            label = stringResource(R.string.translation_costAnalysis_forecast_evCost),
                            value = display.evCostText,
                            valueColor = accentSuccess,
                        )
                        SavingsCostRow(
                            label = stringResource(R.string.translation_costAnalysis_forecast_avgKm),
                            value = display.avgKmText,
                            valueColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/** The highlighted "Monthly Savings" card — the web `bg-neon-green/[0.06]` block with the count-up headline. */
@Composable
private fun MonthlySavingsCard(
    display: ForecastDetailsDisplay,
    currencySymbol: String,
    locale: Locale,
    reduceMotion: Boolean,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.lg))
                .background(accent.copy(alpha = SAVINGS_CARD_FILL_ALPHA))
                .padding(Spacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(stringResource(R.string.translation_costAnalysis_forecast_monthlySavings).uppercase(locale))
        MonthlySavingsAmount(
            value = display.monthlySavings,
            settledText = display.monthlySavingsText,
            currencySymbol = currencySymbol,
            locale = locale,
            reduceMotion = reduceMotion,
            accent = accent,
        )
    }
}

/**
 * The monthly-savings headline — the inline count-up that replaces the shared `AnimatedNumber` so the figure
 * can take the success accent (web `text-emerald-300`). It mirrors the shared component's mechanics: an
 * [Animatable] from 0 tweened to [value] with [FastOutSlowInEasing], formatted through the shared
 * [ChartFormat]. The settled, currency-prefixed value is the node's accessibility description so TalkBack reads
 * the final amount, never a mid-count frame; reduced motion snaps straight to [value].
 */
@Composable
private fun MonthlySavingsAmount(
    value: Double,
    settledText: String,
    currencySymbol: String,
    locale: Locale,
    reduceMotion: Boolean,
    accent: Color,
) {
    val animated = remember { Animatable(0f) }
    LaunchedEffect(value, reduceMotion) {
        if (reduceMotion) {
            animated.snapTo(value.toFloat())
        } else {
            animated.snapTo(0f)
            animated.animateTo(value.toFloat(), animationSpec = tween(COUNT_UP_MS, easing = FastOutSlowInEasing))
        }
    }
    val shown = currencySymbol + ChartFormat.number(animated.value * 1.0, SAVINGS_DECIMALS, locale)
    Text(
        text = shown,
        style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Bold),
        color = accent,
        textAlign = TextAlign.Center,
        modifier = Modifier.clearAndSetSemantics { contentDescription = settledText },
    )
}

/** One annual / lifetime stat tile — a muted label over a semibold value (web `bg-white/[0.04]` cell). */
@Composable
private fun SavingsStatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = TILE_FILL_ALPHA))
                .padding(Spacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(label)
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/** One gas/EV/distance comparison row — a muted label on the left and a tinted value on the right. */
@Composable
private fun SavingsCostRow(
    label: String,
    value: String,
    valueColor: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(text = value, style = MaterialTheme.typography.bodySmall, color = valueColor)
    }
}

// ── Insights panel (web Lightbulb + Zap-bulleted list) ───────────────────────────────────────────────

@Composable
private fun InsightsPanel(
    display: ForecastDetailsDisplay?,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            PanelHeaderRow(
                icon = ForecastDetailsGlyphs.Lightbulb,
                tint = accent,
                title = stringResource(R.string.translation_costAnalysis_forecast_insights),
            )
            Spacer(modifier = Modifier.height(Spacing.md))
            if (display != null && display.hasInsights) {
                Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    display.insights.forEach { insight -> InsightRow(text = insight, accent = accent) }
                }
            } else {
                EmptyState(message = stringResource(R.string.translation_costAnalysis_forecast_noInsights))
            }
        }
    }
}

/** One insight chip — a Zap glyph + the insight text in a faint rounded row (web `bg-white/[0.03]`). */
@Composable
private fun InsightRow(
    text: String,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = INSIGHT_FILL_ALPHA))
                .padding(Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(imageVector = ForecastDetailsGlyphs.Zap, contentDescription = null, size = IconSize.Sm, tint = accent)
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Shared chrome (header, loading, error, freshness) ────────────────────────────────────────────────

/** A panel header — a tinted leading glyph + the panel title (web `<h3>` with its lucide icon). */
@Composable
private fun PanelHeaderRow(
    icon: ImageVector,
    tint: Color,
    title: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = tint)
        PanelTitle(title)
    }
}

/** First-load skeleton — three titled panels with a donut-ish block, so the surface is never blank. */
@Composable
private fun ForecastLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = label }) {
        ForecastGrid(
            breakdown = { ForecastSkeletonPanel() },
            savings = { ForecastSkeletonPanel() },
            insights = { ForecastSkeletonPanel() },
        )
    }
}

@Composable
private fun ForecastSkeletonPanel(modifier: Modifier = Modifier) {
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
            Spacer(modifier = Modifier.height(Spacing.md))
            Skeleton(height = SKELETON_BODY_HEIGHT)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ForecastError(
    state: UiState<ForecastData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    QueryError(
        kind = queryErrorKindOf(state),
        resourceName = stringResource(R.string.translation_costAnalysis_forecast_title),
        onRetry = onRetry,
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the grid when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun ForecastFreshnessRow(
    state: UiState<ForecastData>,
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
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through (P1/S10
 * `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
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

/** The localized source label for a [kind] — the web `t('Home')` / `t('Supercharger')`. */
private fun breakdownLabel(
    kind: ChargerKind,
    home: String,
    supercharger: String,
): String =
    when (kind) {
        ChargerKind.Home -> home
        ChargerKind.Supercharger -> supercharger
    }

/** Combined screen-reader description for the donut, e.g. "Home 65%, Supercharger 35%". */
private fun donutDescription(
    breakdown: List<BreakdownSlice>,
    home: String,
    supercharger: String,
): String =
    breakdown.joinToString(separator = ", ") { slice ->
        "${breakdownLabel(slice.kind, home, supercharger)} ${ForecastDetailsProjection.percent(slice.pct)}%"
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
 * The three glyphs this surface needs that the shared `DataDisplayGlyphs` set does not carry. The web uses
 * lucide `Fuel`, `Lightbulb`, and `Zap`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling SavingsSlide surface does — they are authored
 * here as 24×24 stroked vectors faithful to the lucide paths. They render through the shared [Icon], which
 * tints the whole vector, so the black author-time stroke is recolored to the accent.
 */
private object ForecastDetailsGlyphs {
    /** lucide `fuel`: the base + tank-divider lines, the tank body, and the pump/nozzle column. */
    val Fuel: ImageVector =
        stroked("Fuel") {
            moveTo(3f, 22f)
            lineTo(15f, 22f)
            moveTo(4f, 9f)
            lineTo(14f, 9f)
            moveTo(14f, 22f)
            lineTo(14f, 4f)
            curveTo(14f, 2.9f, 13.1f, 2f, 12f, 2f)
            lineTo(6f, 2f)
            curveTo(4.9f, 2f, 4f, 2.9f, 4f, 4f)
            lineTo(4f, 22f)
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

    /** lucide `lightbulb`: the glass dome + neck over a two-line screw base. */
    val Lightbulb: ImageVector =
        stroked("Lightbulb") {
            moveTo(9f, 18f)
            lineTo(15f, 18f)
            moveTo(10f, 21f)
            lineTo(14f, 21f)
            moveTo(9f, 18f)
            curveTo(9f, 15f, 7f, 14f, 7f, 10f)
            curveTo(7f, 6.7f, 9.2f, 4f, 12f, 4f)
            curveTo(14.8f, 4f, 17f, 6.7f, 17f, 10f)
            curveTo(17f, 14f, 15f, 15f, 15f, 18f)
        }

    /** lucide `zap`: the lightning-bolt polygon. */
    val Zap: ImageVector =
        stroked("Zap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
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

private val PREVIEW_DATA =
    ForecastData(
        breakdown =
            CostBreakdown(
                home = ChargerCategory(pct = 68.0, avgCostPerKwh = 0.13),
                supercharger = ChargerCategory(pct = 32.0, avgCostPerKwh = 0.42),
            ),
        gasComparison =
            GasComparison(
                avgKmPerMonth = 1_540.0,
                gasCostPerMonth = 188.0,
                evCostPerMonth = 64.0,
                monthlySavings = 124.0,
                annualSavings = 1_488.0,
                lifetimeSavings = 7_440.0,
            ),
        insights =
            listOf(
                "Charging at home overnight saves the most versus Supercharging.",
                "Avoid peak Supercharger pricing on weekend afternoons.",
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ForecastDetailsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ForecastDetailsContent(state = UiState(UiPhase.Loading), onRetry = {})
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ForecastDetailsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ForecastDetailsContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = {})
    }
}

@Preview(name = "Empty (no forecast yet)", showBackground = true)
@Composable
private fun ForecastDetailsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ForecastDetailsContent(state = UiState(UiPhase.Empty), onRetry = {})
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ForecastDetailsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ForecastDetailsContent(state = UiState(UiPhase.Content, data = PREVIEW_DATA), onRetry = {})
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ForecastDetailsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ForecastDetailsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
        )
    }
}
