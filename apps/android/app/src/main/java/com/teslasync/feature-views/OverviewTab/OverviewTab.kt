// The native Jetpack Compose + Material 3 OverviewTab feature view — a parity port of
// web/src/features/analytics/components/analytics/OverviewTab.tsx. The web component is presentational:
// it reads three slices of the `FleetAnalytics` document and renders, inside a `<FadeIn>`, four
// `<GlassPanel>`s — "Distance by Vehicle" (a bar chart or empty state), the sibling
// `<OverviewVehicleComparison>`, "Day of Week Pattern" (a drives-bars + avg-distance-line combo),
// "Monthly Cost Comparison" (electric/gas cost bars + a savings line), and a static "Quick Links" grid.
//
// This port keeps that contract end to end and performs NO HTTP. Its only web hooks are `useTranslation`
// (mapped to the i18n catalog) and `useUnits` (the display distance unit, read from the shared
// `LocalDataContainer` unit formatter — the single SI→display boundary, P1/S8). The FleetAnalytics slices
// arrive as a [UiState] (the cache-then-network projection the host owns), so the surface renders every
// lifecycle state that layer can carry — loading, hard error with retry, content, per-section empty, and
// stale/offline ("last known") — without ever fetching. A web-parity overload taking the raw [OverviewData]
// (the web `data` prop) is also provided for hosts that already hold the loaded document.
//
// The sibling OverviewVehicleComparison is a SEPARATE surface with its own prompt (out of scope here), so
// it is exposed as a composition slot ([vehicleComparison]) at the web-parity position between the first
// and second charts; a host wires it in, and this file neither implements nor stubs it.
//
// Quick Links is static (no data dependency), so it renders in every state. Bar/line colors resolve to the
// generated categorical palette by position (never raw hex), mirroring the web `CHART_COLORS[i]`. The
// dual-axis nuance of the two combo charts is the shared chart renderer's concern (feature views must not
// import Vico directly nor alter the shared chart layer); the data parity — series, kinds, colors, labels,
// legend, order — is exact.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OverviewTab) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.overviewtab

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import java.util.Locale

/** The web first/combo chart plot height (`height={280}`). */
private val CHART_HEIGHT_MD: Dp = 280.dp

/** The web monthly chart plot height (`height={300}`). */
private val CHART_HEIGHT_LG: Dp = 300.dp

/** Em dash shown for an unknown freshness age. */
private const val EM_DASH: String = "\u2014"

// Series keys mirror the web `dataKey`s so the legend toggles map 1:1 to the chart series.
private const val DISTANCE_KEY: String = "distance"
private const val DRIVES_KEY: String = "drives"
private const val AVG_DISTANCE_KEY: String = "avg_distance"
private const val COST_KEY: String = "cost"
private const val GAS_COST_KEY: String = "gas_cost"
private const val SAVINGS_KEY: String = "savings"

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), reads the display
 * distance unit from the shared unit formatter (web `useUnits`, P1/S8), and renders every lifecycle [state]
 * the host's FleetAnalytics feed can carry. The host owns the feed and supplies [onRetry] (its `refetch`)
 * and [onNavigate] (its router); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the three FleetAnalytics slices ([OverviewData]).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onNavigate invoked with a Quick Link's internal route (the web `<Link to=…>`).
 * @param vehicleComparison composition slot for the sibling OverviewVehicleComparison surface (own prompt).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun OverviewTab(
    state: UiState<OverviewData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    vehicleComparison: @Composable () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordOverviewTabOpened(logger) }
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    OverviewTabContent(
        state = state,
        distanceUnit = unitFormatter.prefs.distance,
        onRetry = onRetry,
        onNavigate = onNavigate,
        vehicleComparison = vehicleComparison,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's `data: FleetAnalytics | undefined` prop, for hosts that
 * already hold the loaded document. An absent (`null`) document maps to all-empty slices (each panel shows
 * its own empty state, exactly as the web `?? []` fallbacks do); a present document renders the charts.
 * There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun OverviewTab(
    data: OverviewData?,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    vehicleComparison: @Composable () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { UiState(phase = UiPhase.Content, data = data ?: OverviewData()) }
    OverviewTab(
        state = state,
        onRetry = {},
        modifier = modifier,
        onNavigate = onNavigate,
        vehicleComparison = vehicleComparison,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-visible panels (the three data-driven charts with their content/empty branches plus the static
 * Quick Links grid) and adds the lifecycle chrome the host's feed implies: a loading chart-skeleton chrome,
 * a hard-error retry surface, and a freshness chip that reflects refreshing/stale/offline. Stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract. The static Quick Links panel renders in every
 * state so the surface is never a blank box. [distanceUnit] feeds the first chart's conversion + bar label;
 * [locale] formats the axis values.
 */
@Composable
fun OverviewTabContent(
    state: UiState<OverviewData>,
    distanceUnit: DistanceUnitPref,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    locale: Locale = Locale.getDefault(),
    strings: OverviewTabStrings = rememberOverviewTabStrings(),
    vehicleComparison: @Composable () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            when {
                state.isLoading -> OverviewLoading(strings)
                state.isError -> OverviewError(onRetry)
                else -> {
                    if (state.stale || state.refreshing || state.hasError) OverviewFreshnessRow(state)
                    val data = state.data ?: OverviewData()
                    DistanceByVehiclePanel(data.vehicles, distanceUnit, strings, locale)
                    vehicleComparison()
                    DayOfWeekPanel(data.dayOfWeek, strings, locale)
                    MonthlyCostPanel(data.monthly, strings, locale)
                }
            }
            QuickLinksPanel(strings = strings, onNavigate = onNavigate)
        }
    }
}

/** Shared titled chart panel — the web per-chart `<GlassPanel className="p-4">` with its `SectionTitle`. */
@Composable
private fun OverviewChartPanel(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(title)
        Spacer(Modifier.height(Spacing.md))
        content()
    }
}

/**
 * "Distance by Vehicle" — a single bar series (the per-vehicle display distance) with no legend, matching
 * the web `<BarChart>` (which has no `<Legend>`). The bar is labeled with the display unit (web
 * `name={distanceUnit}`) and colored from the categorical palette position 0 (web `CHART_COLORS[0]`).
 */
@Composable
private fun DistanceByVehiclePanel(
    vehicles: List<OverviewVehicle>,
    distanceUnit: DistanceUnitPref,
    strings: OverviewTabStrings,
    locale: Locale,
) {
    OverviewChartPanel(strings.distByVehicleTitle) {
        val projection = remember(vehicles, distanceUnit) { OverviewTabProjection.vehicleDistance(vehicles, distanceUnit) }
        if (projection.isEmpty) {
            EmptyState(message = strings.noVehicles, modifier = Modifier.fillMaxWidth())
        } else {
            val color = paletteColor(0)
            val series =
                remember(projection.values, distanceUnit, color) {
                    listOf(
                        ChartSeries(
                            key = DISTANCE_KEY,
                            label = distanceUnit.label,
                            values = projection.values,
                            kind = ChartSeriesKind.Bar,
                            color = color,
                        ),
                    )
                }
            BarChartWrapper(
                series = series,
                xLabels = projection.xLabels,
                height = CHART_HEIGHT_MD,
                yValueFormatter = { OverviewTabProjection.formatValue(it, locale) },
                emptyMessage = strings.noVehicles,
            )
        }
    }
}

/**
 * "Day of Week Pattern" — a combo chart: the drives bars (palette position 2, web `CHART_COLORS[2]`) and
 * the average-distance line (palette position 3, web `CHART_COLORS[3]`), with the web `<Legend>` beneath.
 */
@Composable
private fun DayOfWeekPanel(
    points: List<DayOfWeekPoint>,
    strings: OverviewTabStrings,
    locale: Locale,
) {
    OverviewChartPanel(strings.dayOfWeekTitle) {
        val projection = remember(points) { OverviewTabProjection.dayOfWeek(points) }
        if (projection.isEmpty) {
            EmptyState(message = strings.noDow, modifier = Modifier.fillMaxWidth())
        } else {
            val drivesColor = paletteColor(2)
            val avgColor = paletteColor(3)
            val series =
                remember(projection.drives, projection.avgDistance, strings, drivesColor, avgColor) {
                    listOf(
                        ChartSeries(DRIVES_KEY, strings.drivesLabel, projection.drives, ChartSeriesKind.Bar, drivesColor),
                        ChartSeries(AVG_DISTANCE_KEY, strings.avgDistLabel, projection.avgDistance, ChartSeriesKind.Line, avgColor),
                    )
                }
            val legend =
                remember(strings, drivesColor, avgColor) {
                    listOf(
                        LegendEntry(DRIVES_KEY, strings.drivesLabel, drivesColor),
                        LegendEntry(AVG_DISTANCE_KEY, strings.avgDistLabel, avgColor),
                    )
                }
            OverviewComboChart(series, projection.xLabels, legend, CHART_HEIGHT_MD, strings.noDow, locale)
        }
    }
}

/**
 * "Monthly Cost Comparison" — a combo chart: the electric-cost bars (palette position 0, web
 * `CHART_COLORS[0]`), the gas-cost bars (position 5, web `CHART_COLORS[5]`), and the savings line
 * (position 1, web `CHART_COLORS[1]`), with the web `<Legend>` beneath.
 */
@Composable
private fun MonthlyCostPanel(
    points: List<MonthlyCostPoint>,
    strings: OverviewTabStrings,
    locale: Locale,
) {
    OverviewChartPanel(strings.monthlyCostTitle) {
        val projection = remember(points) { OverviewTabProjection.monthly(points) }
        if (projection.isEmpty) {
            EmptyState(message = strings.noMonthly, modifier = Modifier.fillMaxWidth())
        } else {
            val costColor = paletteColor(0)
            val gasColor = paletteColor(5)
            val savingsColor = paletteColor(1)
            val series =
                remember(projection, strings, costColor, gasColor, savingsColor) {
                    listOf(
                        ChartSeries(COST_KEY, strings.electricCostLabel, projection.cost, ChartSeriesKind.Bar, costColor),
                        ChartSeries(GAS_COST_KEY, strings.gasCostLabel, projection.gasCost, ChartSeriesKind.Bar, gasColor),
                        ChartSeries(SAVINGS_KEY, strings.savingsLabel, projection.savings, ChartSeriesKind.Line, savingsColor),
                    )
                }
            val legend =
                remember(strings, costColor, gasColor, savingsColor) {
                    listOf(
                        LegendEntry(COST_KEY, strings.electricCostLabel, costColor),
                        LegendEntry(GAS_COST_KEY, strings.gasCostLabel, gasColor),
                        LegendEntry(SAVINGS_KEY, strings.savingsLabel, savingsColor),
                    )
                }
            OverviewComboChart(series, projection.xLabels, legend, CHART_HEIGHT_LG, strings.noMonthly, locale)
        }
    }
}

/** A combo chart + its legend — the shared shape behind the two ComposedChart panels (web `<Legend>`). */
@Composable
private fun OverviewComboChart(
    series: List<ChartSeries>,
    xLabels: List<String>,
    legend: List<LegendEntry>,
    height: Dp,
    emptyMessage: String,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        ComboChart(
            series = series,
            xLabels = xLabels,
            height = height,
            yValueFormatter = { OverviewTabProjection.formatValue(it, locale) },
            emptyMessage = emptyMessage,
        )
        ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * "Quick Links" — the static navigation grid. Each link is a tappable [GlassPanel] card: a neutral icon box
 * + the localized label + a trailing arrow (web `<ArrowRight>`). The whole card is one merged TalkBack node
 * with the Button role; activating it navigates to the link's internal route (web `<Link to={href}>`).
 */
@Composable
private fun QuickLinksPanel(
    strings: OverviewTabStrings,
    onNavigate: (String) -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(strings.quickLinksTitle)
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            strings.quickLinks.forEach { item -> QuickLinkRow(item = item, onNavigate = onNavigate) }
        }
    }
}

@Composable
private fun QuickLinkRow(
    item: QuickLinkItem,
    onNavigate: (String) -> Unit,
) {
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = item.label }
                .clickable(role = Role.Button, onClickLabel = item.label) { onNavigate(item.route) },
        padding = PanelPadding.Sm,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            IconBox(tone = IconBoxTone.Neutral, size = IconBoxSize.Sm) {
                Icon(imageVector = glyphFor(item.glyph), contentDescription = null, size = IconSize.Md)
            }
            BodyText(text = item.label, modifier = Modifier.weight(1f))
            Icon(imageVector = OverviewTabGlyphs.ArrowRight, contentDescription = null, size = IconSize.Sm)
        }
    }
}

/** First-load chrome — the three chart panels' titles over chart-shaped skeletons, never a blank box. */
@Composable
private fun OverviewLoading(strings: OverviewTabStrings) {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    listOf(strings.distByVehicleTitle, strings.dayOfWeekTitle, strings.monthlyCostTitle).forEach { title ->
        OverviewChartPanel(title) {
            ChartBlockSkeleton(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = loadingLabel },
                height = CHART_HEIGHT_MD,
            )
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent for the charts region. */
@Composable
private fun OverviewError(onRetry: () -> Unit) {
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

/**
 * The freshness chip rendered above the charts when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun OverviewFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
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
            formatAge = rememberOverviewFreshnessFormatter(),
        )
    }
}

/** Maps a [QuickLinkGlyph] onto its locally authored vector. */
private fun glyphFor(glyph: QuickLinkGlyph) =
    when (glyph) {
        QuickLinkGlyph.BarChart -> OverviewTabGlyphs.BarChart
        QuickLinkGlyph.Activity -> OverviewTabGlyphs.Activity
        QuickLinkGlyph.Calendar -> OverviewTabGlyphs.Calendar
        QuickLinkGlyph.MapPin -> OverviewTabGlyphs.MapPin
        QuickLinkGlyph.Clock -> OverviewTabGlyphs.Clock
    }

/**
 * Builds the localized [OverviewTabStrings] from the i18n catalog (P1/S10). The `analytics.overview.*` keys
 * resolve through `R.string`; the five Quick Links labels resolve through [resolveOptional] over an optional
 * by-name lookup (the `analytics.links.*` keys are absent from the catalog, so this mirrors the web
 * `t(key, lastSegment)` fallback). Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberOverviewTabStrings(): OverviewTabStrings {
    val context = LocalContext.current
    val distByVehicle = stringResource(R.string.translation_analytics_overview_distByVehicle)
    val dayOfWeek = stringResource(R.string.translation_analytics_overview_dayOfWeek)
    val monthlyCost = stringResource(R.string.translation_analytics_overview_monthlyCost)
    val quickLinks = stringResource(R.string.translation_analytics_overview_quickLinks)
    val drives = stringResource(R.string.translation_analytics_overview_drives)
    val avgDist = stringResource(R.string.translation_analytics_overview_avgDist)
    val electricCost = stringResource(R.string.translation_analytics_overview_electricCost)
    val gasCost = stringResource(R.string.translation_analytics_overview_gasCost)
    val savings = stringResource(R.string.translation_analytics_overview_savings)
    val noVehicles = stringResource(R.string.translation_analytics_overview_noVehicles)
    val noDow = stringResource(R.string.translation_analytics_overview_noDow)
    val noMonthly = stringResource(R.string.translation_analytics_overview_noMonthly)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val linkItems =
        OverviewQuickLinks.items { link -> resolveOptional(lookup, link.androidResourceName, link.defaultLabel) }
    return remember(
        distByVehicle,
        dayOfWeek,
        monthlyCost,
        quickLinks,
        drives,
        avgDist,
        electricCost,
        gasCost,
        savings,
        noVehicles,
        noDow,
        noMonthly,
        linkItems,
    ) {
        OverviewTabStrings(
            distByVehicleTitle = distByVehicle,
            dayOfWeekTitle = dayOfWeek,
            monthlyCostTitle = monthlyCost,
            quickLinksTitle = quickLinks,
            drivesLabel = drives,
            avgDistLabel = avgDist,
            electricCostLabel = electricCost,
            gasCostLabel = gasCost,
            savingsLabel = savings,
            noVehicles = noVehicles,
            noDow = noDow,
            noMonthly = noMonthly,
            quickLinks = linkItems,
        )
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam [resolveOptional] uses to
 * reproduce web `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a
 * compile-time `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi`
 * is suppressed. Release builds keep resource names (resource shrinking is off — see app/build.gradle.kts).
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberOverviewFreshnessFormatter(): (FreshnessAge) -> String {
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

private val PREVIEW_STRINGS =
    OverviewTabStrings(
        distByVehicleTitle = "Distance by Vehicle",
        dayOfWeekTitle = "Day of Week Pattern",
        monthlyCostTitle = "Monthly Cost Comparison",
        quickLinksTitle = "Quick Links",
        drivesLabel = "Drives",
        avgDistLabel = "Avg Distance",
        electricCostLabel = "Electric Cost",
        gasCostLabel = "Gas Cost",
        savingsLabel = "Savings",
        noVehicles = "No vehicle data",
        noDow = "No day-of-week data",
        noMonthly = "No monthly data",
        quickLinks =
            listOf(
                QuickLinkItem("Statistics", "/statistics", QuickLinkGlyph.BarChart),
                QuickLinkItem("Compare", "/period-compare", QuickLinkGlyph.Activity),
                QuickLinkItem("Weekly Digest", "/weekly-digest", QuickLinkGlyph.Calendar),
                QuickLinkItem("Mileage", "/mileage", QuickLinkGlyph.MapPin),
                QuickLinkItem("Timeline", "/timeline", QuickLinkGlyph.Clock),
            ),
    )

private val PREVIEW_DATA =
    OverviewData(
        vehicles =
            listOf(
                OverviewVehicle(name = "Model 3", distanceKm = 1240.0),
                OverviewVehicle(name = "Model Y", distanceKm = 980.5),
            ),
        dayOfWeek =
            listOf(
                DayOfWeekPoint(day = "Mon", drives = 8, avgDistanceKm = 24.0),
                DayOfWeekPoint(day = "Tue", drives = 6, avgDistanceKm = 18.5),
                DayOfWeekPoint(day = "Wed", drives = 9, avgDistanceKm = 31.2),
            ),
        monthly =
            listOf(
                MonthlyCostPoint(month = "Jan", cost = 42.0, gasCost = 120.0, savings = 78.0),
                MonthlyCostPoint(month = "Feb", cost = 38.5, gasCost = 110.0, savings = 71.5),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun OverviewTabLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewTabContent(
            state = UiState(UiPhase.Loading),
            distanceUnit = DistanceUnitPref.KM,
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun OverviewTabErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewTabContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            distanceUnit = DistanceUnitPref.KM,
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun OverviewTabEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewTabContent(
            state = UiState(UiPhase.Content, data = OverviewData()),
            distanceUnit = DistanceUnitPref.KM,
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun OverviewTabContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewTabContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            distanceUnit = DistanceUnitPref.MI,
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun OverviewTabOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewTabContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            distanceUnit = DistanceUnitPref.KM,
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
