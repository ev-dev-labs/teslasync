// The native Jetpack Compose + Material 3 ChargingTab feature view — a parity port of
// web/src/features/analytics/components/analytics/ChargingTab.tsx. The web component is purely
// presentational: its parent (the analytics page) computes the `FleetAnalytics` and passes it down as
// the single `data` prop. It renders a `FadeIn`-wrapped stack of: a six-tile summary grid (sessions,
// total energy, total cost, avg power, avg duration, charge efficiency), a charger-types donut, a
// start-battery-distribution bar chart, an hourly-pattern combo chart, and the sibling
// `<ChargingDetailSection data={data} />`.
//
// The native surface keeps that contract. It performs NO HTTP and binds no analytics hook of its own
// (its only web hooks are `useTranslation` → the i18n catalog (P1/S10), and `useFormatting` → the
// currency symbol + locale resolved from the shared settings store (P1/S8)). The host owns the
// analytics feed and supplies it through the shared cache-then-network [UiState] (P1/S8), so this view
// also renders every lifecycle state that layer can carry — loading (skeleton chrome), hard error with
// retry, content, and stale/offline (cached "last known"). Content and the data-resolved Empty phase
// render the SAME full scaffold (zeroed tiles + per-chart empty states), exactly like the web component
// renders with an `undefined` `data` prop — no section is ever hidden and no panel collapses to a blank
// box. A web-parity overload that takes the raw `(data, isLoading)` props is also provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargingTab — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingtab

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
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
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

/** Web `<FadeIn className="space-y-4 mt-4">` — the stack's staggered entry delay, in milliseconds. */
private const val FADE_DELAY_MS = 200

/** Web `<ResponsiveContainer height={280}>` — the plot height shared by all three charts. */
private val CHART_HEIGHT: Dp = 280.dp

/** The donut diameter; the ring thickness is a fraction of it (web innerRadius 55 / outerRadius 95). */
private val DONUT_SIZE: Dp = 168.dp

/** Web `<Pie paddingAngle={3}>` — the gap, in degrees, drawn between adjacent donut slices. */
private const val DONUT_PADDING_DEGREES = 3f

/** Donut ring thickness as a fraction of the diameter (≈ the web 40px ring on a 190px donut). */
private const val DONUT_THICKNESS_FRACTION = 0.22f

private const val FULL_CIRCLE_DEGREES = 360f
private const val DONUT_START_DEGREES = -90f

/** The legend color swatch diameter. */
private val LEGEND_SWATCH_SIZE: Dp = 10.dp

/** Web `Array.from({ length: 6 })` — the six loading skeleton tiles. */
private const val SKELETON_TILE_COUNT = 6
private val SKELETON_TILE_HEIGHT: Dp = 76.dp
private const val SKELETON_TITLE_WIDTH_FRACTION = 0.4f
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

// Responsive column counts for the summary grid, mirroring the web
// `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` and aligned to the Material window-size width breakpoints.
private val GRID_MEDIUM_MIN: Dp = 600.dp
private val GRID_EXPANDED_MIN: Dp = 840.dp
private const val GRID_COLS_COMPACT = 2
private const val GRID_COLS_MEDIUM = 3
private const val GRID_COLS_EXPANDED = 6

/**
 * The currency symbol + [locale] the surface formats with — the native projection of the web
 * `useFormatting` result. Resolved once at the Compose boundary from the shared settings store (P1/S8)
 * so the rest of the surface stays free of any store dependency, then handed to the pure projection.
 */
data class ChargingFormatting(
    val currencySymbol: String,
    val locale: Locale,
)

/**
 * The already-localized strings the surface renders. The web component is anonymous — it resolves every
 * label through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose
 * boundary and are passed down, keeping the surface free of any English literal.
 */
data class ChargingTabStrings(
    val sessions: String,
    val totalEnergy: String,
    val totalCost: String,
    val avgPower: String,
    val avgDuration: String,
    val chargeEfficiency: String,
    val minUnit: String,
    val chargerTypesTitle: String,
    val startBatteryTitle: String,
    val hourlyTitle: String,
    val noTypes: String,
    val noBatDist: String,
    val noHourly: String,
    val sessionsSeries: String,
    val chargesSeries: String,
    val energySeries: String,
)

/**
 * Stateful entry point for the charging analytics tab. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the [ChargingFormatting] from the shared settings store (P1/S8), and
 * renders every lifecycle [state] the shared analytics feed can carry. The host owns the feed (P1/S8)
 * and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [ChargingTabData] (web `data` prop).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param detailSection the composition seam for the sibling `<ChargingDetailSection data={data} />`
 *   surface (its own P3 prompt + i18n keys); the host page supplies it, defaulting to nothing here.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingTab(
    state: UiState<ChargingTabData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    formatting: ChargingFormatting = rememberChargingFormatting(),
    detailSection: @Composable () -> Unit = {},
) {
    LaunchedEffect(Unit) { recordChargingTabOpened(logger) }
    ChargingTabContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        currencySymbol = formatting.currencySymbol,
        locale = formatting.locale,
        detailSection = detailSection,
    )
}

/**
 * Web-parity overload mirroring the web component's `({ data })` prop (plus an [isLoading] flag for the
 * native lifecycle). Projects them onto a [UiState] via [ChargingTabProjection.projectUiState] and
 * delegates to the stateful entry, which records `view.opened`. There is no fetch behind it, so it
 * offers no retry affordance.
 */
@Composable
fun ChargingTab(
    data: ChargingTabData?,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    formatting: ChargingFormatting = rememberChargingFormatting(),
    detailSection: @Composable () -> Unit = {},
) {
    val state = remember(data, isLoading) { ChargingTabProjection.projectUiState(data, isLoading) }
    ChargingTab(
        state = state,
        onRetry = {},
        modifier = modifier,
        logger = logger,
        formatting = formatting,
        detailSection = detailSection,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Maps the host
 * feed's [UiState] onto the surface: a six-tile skeleton grid + three skeleton chart panels while
 * loading; a hard-error retry surface (web `QueryError`); otherwise the full `FadeIn` scaffold (summary
 * grid, donut, bar chart, combo chart, and the [detailSection] seam) with a freshness chip when cached
 * data is refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [currencySymbol]/[locale] format every value (web `useFormatting` + `fmtNumber`).
 */
@Composable
fun ChargingTabContent(
    state: UiState<ChargingTabData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currencySymbol: String = CHARGING_DEFAULT_CURRENCY,
    locale: Locale = Locale.getDefault(),
    strings: ChargingTabStrings = rememberChargingTabStrings(),
    detailSection: @Composable () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when {
                state.isLoading -> ChargingTabSkeleton()
                state.isError -> ChargingTabError(onRetry = onRetry)
                else ->
                    ChargingTabScaffold(
                        data = state.data,
                        state = state,
                        currencySymbol = currencySymbol,
                        locale = locale,
                        strings = strings,
                        detailSection = detailSection,
                    )
            }
        }
    }
}

/**
 * The content scaffold rendered for both the Content and the data-resolved Empty phase — the faithful
 * native composition of the web component's JSX. A [data] of `null` (Empty) still renders every section
 * (zeroed tiles + per-chart empty states), exactly like the web component with an `undefined` prop.
 */
@Composable
private fun ChargingTabScaffold(
    data: ChargingTabData?,
    state: UiState<ChargingTabData>,
    currencySymbol: String,
    locale: Locale,
    strings: ChargingTabStrings,
    detailSection: @Composable () -> Unit,
) {
    if (state.stale || state.refreshing || state.hasError) {
        ChargingFreshnessRow(state)
    }
    val values =
        remember(data, currencySymbol, locale) {
            ChargingTabProjection.metricValues(data, currencySymbol, locale)
        }
    ChargingSummaryGrid(values = values, strings = strings)
    ChargingDonutPanel(data = data, locale = locale, strings = strings)
    ChargingBarPanel(data = data, locale = locale, strings = strings)
    ChargingHourlyPanel(data = data, locale = locale, strings = strings)
    detailSection()
}

/** The six summary tiles in a responsive grid — the web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`. */
@Composable
private fun ChargingSummaryGrid(
    values: List<ChargingMetricValue>,
    strings: ChargingTabStrings,
) {
    ChargingGrid(itemCount = values.size) { index ->
        val item = values[index]
        MetricCard(
            label = strings.label(item.metric),
            value = item.value,
            modifier = Modifier.weight(1f),
            icon = item.metric.glyph(),
            accent = item.metric.accent(),
            subtitle = strings.subtitle(item.metric),
        )
    }
}

/** A single tile in the skeleton grid + the real grid: a responsive, equal-width cell layout. */
@Composable
private fun ChargingGrid(
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
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            for (rowIndex in 0 until rowCount) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    for (column in 0 until columns) {
                        val index = rowIndex * columns + column
                        if (index < itemCount) tile(index) else Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/** The charger-types donut panel — web `GlassPanel` + `SectionTitle` + `PieChart`, else `EmptyState`. */
@Composable
private fun ChargingDonutPanel(
    data: ChargingTabData?,
    locale: Locale,
    strings: ChargingTabStrings,
) {
    val model = remember(data, locale) { ChargingTabProjection.donut(data, locale) }
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.chargerTypesTitle, modifier = Modifier.padding(bottom = Spacing.sm))
        if (model.isEmpty) {
            EmptyState(message = strings.noTypes, modifier = Modifier.fillMaxWidth())
        } else {
            val colors = remember(model.slices.size) { List(model.slices.size) { paletteColor(it) } }
            val description =
                remember(model.slices, strings.chargerTypesTitle) {
                    donutDescription(strings.chargerTypesTitle, model.slices)
                }
            Row(verticalAlignment = Alignment.CenterVertically) {
                ChargingDonut(
                    slices = model.slices,
                    colors = colors,
                    contentDescription = description,
                    modifier = Modifier.size(DONUT_SIZE),
                )
                Spacer(modifier = Modifier.width(Spacing.md))
                ChargingDonutLegend(
                    slices = model.slices,
                    colors = colors,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/**
 * The donut itself — a Compose `Canvas` of stroked arcs, one per slice, separated by a small padding
 * gap (web `paddingAngle`). The shared chart layer has no pie primitive (Vico 2.0 ships none), so —
 * exactly as the shared `RadialGauge` is a Canvas arc — the donut is drawn here and carries a single
 * merged [contentDescription] summary for TalkBack (the opaque canvas's screen-reader fallback).
 */
@Composable
private fun ChargingDonut(
    slices: List<ChargingDonutSlice>,
    colors: List<Color>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.semantics { this.contentDescription = contentDescription }) {
        val thickness = size.minDimension * DONUT_THICKNESS_FRACTION
        val diameter = size.minDimension - thickness
        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
        val arcSize = Size(diameter, diameter)
        val gap = if (slices.size > 1) DONUT_PADDING_DEGREES else 0f
        var cursor = DONUT_START_DEGREES
        slices.forEachIndexed { index, slice ->
            val full = slice.fraction.toFloat() * FULL_CIRCLE_DEGREES
            val sweep = full - gap
            if (sweep > 0f) {
                drawArc(
                    color = colors[index],
                    startAngle = cursor + gap / 2f,
                    sweepAngle = sweep,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = thickness, cap = StrokeCap.Butt),
                )
            }
            cursor += full
        }
    }
}

/** The donut legend — a swatch + charger-type name + share percent per slice (web `<Legend />`). */
@Composable
private fun ChargingDonutLegend(
    slices: List<ChargingDonutSlice>,
    colors: List<Color>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        slices.forEachIndexed { index, slice ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier =
                        Modifier
                            .size(LEGEND_SWATCH_SIZE)
                            .background(colors[index], CircleShape),
                )
                Spacer(modifier = Modifier.width(Spacing.xs))
                BodyText(text = slice.type, modifier = Modifier.weight(1f), maxLines = 1)
                Caption(text = slice.percentLabel)
            }
        }
    }
}

/** The start-battery-distribution bar panel — web `GlassPanel` + `BarChart`, else `EmptyState`. */
@Composable
private fun ChargingBarPanel(
    data: ChargingTabData?,
    locale: Locale,
    strings: ChargingTabStrings,
) {
    val model = remember(data, locale) { ChargingTabProjection.startBatteryBars(data, locale) }
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.startBatteryTitle, modifier = Modifier.padding(bottom = Spacing.sm))
        if (model.isEmpty) {
            EmptyState(message = strings.noBatDist, modifier = Modifier.fillMaxWidth())
        } else {
            val color = paletteColor(1)
            val series =
                remember(model.values, strings.sessionsSeries, color) {
                    listOf(
                        ChartSeries(
                            key = "count",
                            label = strings.sessionsSeries,
                            values = model.values,
                            kind = ChartSeriesKind.Bar,
                            color = color,
                        ),
                    )
                }
            Box(modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = strings.startBatteryTitle }) {
                BarChartWrapper(
                    series = series,
                    xLabels = model.xLabels,
                    height = CHART_HEIGHT,
                    emptyMessage = strings.noBatDist,
                )
            }
        }
    }
}

/** The hourly-pattern combo panel — web `GlassPanel` + dual-axis `ComposedChart`, else `EmptyState`. */
@Composable
private fun ChargingHourlyPanel(
    data: ChargingTabData?,
    locale: Locale,
    strings: ChargingTabStrings,
) {
    val model = remember(data, locale) { ChargingTabProjection.hourlyPattern(data, locale) }
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.hourlyTitle, modifier = Modifier.padding(bottom = Spacing.sm))
        if (model.isEmpty) {
            EmptyState(message = strings.noHourly, modifier = Modifier.fillMaxWidth())
        } else {
            val chargesColor = paletteColor(0)
            val energyColor = paletteColor(3)
            val series =
                remember(model.charges, model.energy, strings.chargesSeries, strings.energySeries) {
                    listOf(
                        ChartSeries(
                            key = "charges",
                            label = strings.chargesSeries,
                            values = model.charges,
                            kind = ChartSeriesKind.Bar,
                            color = chargesColor,
                        ),
                        ChartSeries(
                            key = "energy",
                            label = strings.energySeries,
                            values = model.energy,
                            kind = ChartSeriesKind.Line,
                            color = energyColor,
                        ),
                    )
                }
            Box(modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = strings.hourlyTitle }) {
                ComboChart(
                    series = series,
                    xLabels = model.xLabels,
                    height = CHART_HEIGHT,
                    emptyMessage = strings.noHourly,
                )
            }
        }
    }
}

/** The loading branch: the six skeleton tiles + three skeleton chart panels — honest skeleton chrome. */
@Composable
private fun ChargingTabSkeleton() {
    ChargingGrid(itemCount = SKELETON_TILE_COUNT) {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
    }
    repeat(SKELETON_PANEL_COUNT) {
        GlassPanel(padding = PanelPadding.Md) {
            Skeleton(
                widthFraction = SKELETON_TITLE_WIDTH_FRACTION,
                height = SKELETON_TITLE_HEIGHT,
                rounded = true,
            )
            Spacer(modifier = Modifier.height(Spacing.sm))
            Skeleton(height = CHART_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ChargingTabError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The freshness chip row shown above content when cached data is refreshing / stale / offline. */
@Composable
private fun ChargingFreshnessRow(state: UiState<*>) {
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
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * Builds the [ChargingFormatting] from the shared settings store (P1/S8) — the native binding of the web
 * `useFormatting` hook. The currency symbol mirrors the web `settings.currency_symbol || '$'`, and the
 * locale mirrors the web global-locale derivation ([UnitPreferences.fromSettings]). Remembered against
 * the settings value so a settings change re-formats every tile.
 */
@Composable
private fun rememberChargingFormatting(): ChargingFormatting {
    val container = LocalDataContainer.current
    val settings by container.settingsStore.settings().collectAsStateWithLifecycle()
    return remember(settings) {
        val cached = settings.cached
        val symbol = ((cached as? JsonObject)?.get("currency_symbol") as? JsonPrimitive)?.contentOrNull
        val currencySymbol = if (!symbol.isNullOrBlank()) symbol else CHARGING_DEFAULT_CURRENCY
        val localeTag = UnitPreferences.fromSettings(cached).locale
        val resolvedLocale = if (localeTag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(localeTag)
        ChargingFormatting(currencySymbol = currencySymbol, locale = resolvedLocale)
    }
}

/**
 * Builds the localized [ChargingTabStrings] from the i18n catalog (P1/S10): the fifteen
 * `analytics.charging.*` keys the web component reads. Remembered against the resolved strings so a
 * locale change re-projects.
 */
@Composable
private fun rememberChargingTabStrings(): ChargingTabStrings {
    val sessions = stringResource(R.string.translation_analytics_charging_sessions)
    val totalEnergy = stringResource(R.string.translation_analytics_charging_totalEnergy)
    val totalCost = stringResource(R.string.translation_analytics_charging_totalCost)
    val avgPower = stringResource(R.string.translation_analytics_charging_avgPower)
    val avgDuration = stringResource(R.string.translation_analytics_charging_avgDuration)
    val chargeEfficiency = stringResource(R.string.translation_analytics_charging_chargeEff)
    val minUnit = stringResource(R.string.translation_analytics_charging_min)
    val chargerTypesTitle = stringResource(R.string.translation_analytics_charging_chargerTypes)
    val startBatteryTitle = stringResource(R.string.translation_analytics_charging_startBattery)
    val hourlyTitle = stringResource(R.string.translation_analytics_charging_hourlyPattern)
    val noTypes = stringResource(R.string.translation_analytics_charging_noTypes)
    val noBatDist = stringResource(R.string.translation_analytics_charging_noBatDist)
    val noHourly = stringResource(R.string.translation_analytics_charging_noHourly)
    val charges = stringResource(R.string.translation_analytics_charging_charges)
    val energy = stringResource(R.string.translation_analytics_charging_energykWh)
    return remember(
        sessions,
        totalEnergy,
        totalCost,
        avgPower,
        avgDuration,
        chargeEfficiency,
        minUnit,
        chargerTypesTitle,
        startBatteryTitle,
        hourlyTitle,
        noTypes,
        noBatDist,
        noHourly,
        charges,
        energy,
    ) {
        ChargingTabStrings(
            sessions = sessions,
            totalEnergy = totalEnergy,
            totalCost = totalCost,
            avgPower = avgPower,
            avgDuration = avgDuration,
            chargeEfficiency = chargeEfficiency,
            minUnit = minUnit,
            chargerTypesTitle = chargerTypesTitle,
            startBatteryTitle = startBatteryTitle,
            hourlyTitle = hourlyTitle,
            noTypes = noTypes,
            noBatDist = noBatDist,
            noHourly = noHourly,
            sessionsSeries = sessions,
            chargesSeries = charges,
            energySeries = energy,
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

/** Resolves a tile's already-localized label from the bundled strings. */
private fun ChargingTabStrings.label(metric: ChargingMetric): String =
    when (metric) {
        ChargingMetric.Sessions -> sessions
        ChargingMetric.TotalEnergy -> totalEnergy
        ChargingMetric.TotalCost -> totalCost
        ChargingMetric.AvgPower -> avgPower
        ChargingMetric.AvgDuration -> avgDuration
        ChargingMetric.ChargeEfficiency -> chargeEfficiency
    }

/**
 * Resolves a tile's unit subtitle — the web `subtitle` prop. The energy/power/percent symbols are fixed
 * unit glyphs (web literals); the duration "min" is the one localized subtitle; the rest carry none.
 */
private fun ChargingTabStrings.subtitle(metric: ChargingMetric): String? =
    when (metric) {
        ChargingMetric.TotalEnergy -> CHARGING_UNIT_KWH
        ChargingMetric.AvgPower -> CHARGING_UNIT_KW
        ChargingMetric.AvgDuration -> minUnit
        ChargingMetric.ChargeEfficiency -> CHARGING_UNIT_PERCENT
        ChargingMetric.Sessions, ChargingMetric.TotalCost -> null
    }

/**
 * The tile accent — the native mirror of the web `MetricCard` `color` prop. Maps the web neon palette
 * onto the theme-invariant chart tokens by the same convention the sibling surfaces use: cyan→regen,
 * green→battery, amber→energy, purple→power.
 */
private fun ChargingMetric.accent(): Color =
    when (this) {
        ChargingMetric.Sessions -> TeslaTokens.chart.regen
        ChargingMetric.TotalEnergy -> TeslaTokens.chart.battery
        ChargingMetric.TotalCost -> TeslaTokens.chart.energy
        ChargingMetric.AvgPower -> TeslaTokens.chart.power
        ChargingMetric.AvgDuration -> TeslaTokens.chart.regen
        ChargingMetric.ChargeEfficiency -> TeslaTokens.chart.battery
    }

/** Resolves a tile's line glyph — the native analogue of the web lucide icon for that metric. */
private fun ChargingMetric.glyph() =
    when (this) {
        ChargingMetric.Sessions -> ChargingTabGlyphs.Plug
        ChargingMetric.TotalEnergy -> ChargingTabGlyphs.Zap
        ChargingMetric.TotalCost -> ChargingTabGlyphs.DollarSign
        ChargingMetric.AvgPower -> ChargingTabGlyphs.Gauge
        ChargingMetric.AvgDuration -> ChargingTabGlyphs.Timer
        ChargingMetric.ChargeEfficiency -> ChargingTabGlyphs.TrendingUp
    }

/**
 * Builds the donut's TalkBack summary from the localized [title] and the slices, e.g.
 * `"Charger Types: Supercharger 12 (40%), Home 18 (60%)"`. Uses only the localized title, data values,
 * and numeric labels (no English connective words), so it stays correct in every locale.
 */
private fun donutDescription(
    title: String,
    slices: List<ChargingDonutSlice>,
): String =
    slices.joinToString(prefix = "$title: ", separator = ", ") { slice ->
        "${slice.type} ${slice.countLabel} (${slice.percentLabel})"
    }

private const val SKELETON_PANEL_COUNT = 3

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ───────────────────────

private val PREVIEW_STRINGS =
    ChargingTabStrings(
        sessions = "Sessions",
        totalEnergy = "Total Energy",
        totalCost = "Total Cost",
        avgPower = "Avg Power",
        avgDuration = "Avg Duration",
        chargeEfficiency = "Charge Efficiency",
        minUnit = "min",
        chargerTypesTitle = "Charger Types",
        startBatteryTitle = "Start Battery Distribution",
        hourlyTitle = "Hourly Charging Pattern",
        noTypes = "No charger type data",
        noBatDist = "No battery distribution data",
        noHourly = "No hourly data",
        sessionsSeries = "Sessions",
        chargesSeries = "Charges",
        energySeries = "Energy (kWh)",
    )

private val PREVIEW_DATA =
    ChargingTabData(
        totalSessions = 248.0,
        totalEnergyKwh = 4321.6,
        totalCost = 612.49,
        powerAvg = 48.2,
        durationAvg = 41.0,
        efficiencyAvg = 91.4,
        chargerTypes =
            listOf(
                ChargerTypeSlice("Supercharger", 120.0),
                ChargerTypeSlice("Home", 96.0),
                ChargerTypeSlice("Destination", 32.0),
            ),
        startBatteryDist =
            listOf(
                StartBatteryBucket("0-20%", 18.0),
                StartBatteryBucket("20-40%", 64.0),
                StartBatteryBucket("40-60%", 92.0),
                StartBatteryBucket("60-80%", 54.0),
                StartBatteryBucket("80-100%", 20.0),
            ),
        hourlyPattern =
            (0..23).map { hour ->
                val n = hour % 5 + 1
                HourlyChargePoint(hour = hour, charges = n * 1.0, energy = n * 7.4)
            },
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargingTabLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTabContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty (no data)", showBackground = true)
@Composable
private fun ChargingTabEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTabContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChargingTabErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTabContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChargingTabContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTabContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ChargingTabOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTabContent(
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
