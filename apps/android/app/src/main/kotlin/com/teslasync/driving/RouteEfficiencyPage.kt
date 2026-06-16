// The native Jetpack Compose + Material 3 RouteEfficiencyPage driving surface — a parity port of
// web/src/features/driving/pages/RouteEfficiencyPage.tsx, the per-route efficiency comparison dashboard. It reproduces
// the page's four panels (the summary stat card, the route-efficiency comparison bar chart, the per-route cards with
// their best/avg/worst efficiency bar, and the Route Metrics panel), every data state (loading / empty / error /
// success, plus the cache-then-network stale/offline tier the bound state holder carries), and every visible string
// (resolved from the generated res/values catalog `routeEfficiency.*`, ADR-014).
//
// Composition: [RouteEfficiencyPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the route-efficiency feed + the live display preferences +
// the date scope); [RouteEfficiencyPageContent] is the stateless render layer (the page chrome — title / subtitle /
// freshness chip / vehicle scope picker / date-range filter — then the loading / error / loaded body). The loaded body
// draws every panel from the decoded model; all decode + derivation lives in the framework-free model
// (RouteEfficiencyPageModel.kt), so this file only resolves i18n + draws. SI values are converted to the user's units
// only here at the display boundary via the model's `prefs.distanceFromKm`/`efficiencyDisplay`/`number`/`integer`
// (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.driving.routeefficiency

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The minimum routes the comparison chart needs before it draws rather than showing its empty surface (web `> 1`). */
private const val MIN_COMPARISON_ROUTES = 1

/** MetricBar denominators (web `max={300}` / `max={400}` / `Math.max(tripCount, 20)`). */
private const val EFFICIENCY_BAR_MAX = 300.0
private const val WORST_BAR_MAX = 400.0
private const val TRIPS_BAR_MIN_MAX = 20

/** The chart palette index for the brand cyan accent (web `#00f0ff`, the avg series + metric headings). */
private const val ACCENT_CYAN = 0

/** The chart palette index for the purple accent (web `#a855f7`, the most-driven metric bar). */
private const val ACCENT_PURPLE = 4

private val COMPARISON_HEIGHT = 260.dp
private val EFFICIENCY_BAR_HEIGHT = 10.dp

// ── Stateful entry point ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [RouteEfficiencyPageViewModel] over the supplied [source] (the host wires the shared
 * driving repository + the active-vehicle selection + the shared settings holder via [routeEfficiencyPageSourceOf]).
 * [logger] defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live
 * state to the content.
 */
@Composable
fun RouteEfficiencyPage(
    source: RouteEfficiencyPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: RouteEfficiencyPageViewModel =
        viewModel(
            key = RouteEfficiencyPageRegistration.SLUG,
            factory = viewModelFactory { initializer { RouteEfficiencyPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val range by viewModel.range.collectAsStateWithLifecycle()

    RouteEfficiencyPageContent(
        state = state,
        prefs = prefs,
        range = range,
        onRangeChange = viewModel::setRange,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker + the
 * date-range filter), then the route-efficiency-gated body — a centered loader on a first load, a retryable error panel
 * on a hard failure, or the loaded panels otherwise. The loaded body renders every panel from the bound model; each
 * section surfaces its own empty state (the comparison chart's empty surface + the metrics panel's empty surface) so an
 * empty route set is never a blank region.
 */
@Composable
fun RouteEfficiencyPageContent(
    state: UiState<RouteEfficiencyModel>,
    prefs: RouteEfficiencyDisplayPrefs,
    range: RouteEfficiencyDateRange,
    onRangeChange: (Long?, Long?) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        RouteEfficiencyChrome(state = state, range = range, onRangeChange = onRangeChange)

        when {
            state.isLoading -> RouteEfficiencyLoading()
            state.isError -> RouteEfficiencyError(onRetry = onRetry)
            else -> RouteEfficiencyBody(model = state.data ?: RouteEfficiencyModel.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the vehicle scope picker + range. */
@Composable
private fun RouteEfficiencyChrome(
    state: UiState<RouteEfficiencyModel>,
    range: RouteEfficiencyDateRange,
    onRangeChange: (Long?, Long?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_routeEfficiency_title))
                BodyText(
                    stringResource(R.string.translation_routeEfficiency_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web page `actions` — the global active-vehicle scope picker + the date RangePicker.
        VehicleSelect(withIcon = true)
        DateRangeFilter(
            startEpochDay = range.startEpochDay,
            endEpochDay = range.endEpochDay,
            onRangeChange = onRangeChange,
        )
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun RouteEfficiencyLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun RouteEfficiencyError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — the four panels in their web order, each entering with a staggered fade. */
@Composable
private fun RouteEfficiencyBody(
    model: RouteEfficiencyModel,
    prefs: RouteEfficiencyDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { SummaryPanel(model, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { ComparisonChartPanel(model, prefs) }
        if (model.routes.isNotEmpty()) {
            RouteCardsList(model, prefs)
        }
        FadeIn(delayMs = FADE_STEP_MS * 2) { RouteMetricsPanel(model, prefs) }
    }
}

// ── Panel: GlassPanel2 — Summary stats ────────────────────────────────────────────────────────────────────────

/** GlassPanel2 — Routes / Total-Trips / Best / Avg, the web summary `<GlassPanel>` with its four `AnimatedNumber`s. */
@Composable
private fun SummaryPanel(
    model: RouteEfficiencyModel,
    prefs: RouteEfficiencyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricRow {
                SummaryCell(
                    modifier = Modifier.weight(1f),
                    value = model.routes.size.asDouble(),
                    label = stringResource(R.string.translation_routeEfficiency_routes),
                    locale = prefs.locale,
                )
                SummaryCell(
                    modifier = Modifier.weight(1f),
                    value = model.totalTrips.asDouble(),
                    label = stringResource(R.string.translation_routeEfficiency_totalTrips),
                    locale = prefs.locale,
                )
            }
            MetricRow {
                SummaryCell(
                    modifier = Modifier.weight(1f),
                    value = prefs.efficiencyDisplay(model.bestEfficiency),
                    label = "${stringResource(R.string.translation_routeEfficiency_bestEfficiency)} ${prefs.efficiencyUnit}",
                    locale = prefs.locale,
                )
                SummaryCell(
                    modifier = Modifier.weight(1f),
                    value = prefs.efficiencyDisplay(model.avgEfficiency),
                    label = "${stringResource(R.string.translation_routeEfficiency_avgEfficiency)} ${prefs.efficiencyUnit}",
                    locale = prefs.locale,
                )
            }
        }
    }
}

/** One centered summary cell — the count-up [value] over its [label] (web stacked `AnimatedNumber` + caption). */
@Composable
private fun SummaryCell(
    value: Double,
    label: String,
    locale: java.util.Locale,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        AnimatedNumber(value = value, decimals = 0, locale = locale)
        Caption(label)
    }
}

// ── Panel: Route-Efficiency-Comparison — chart container + bar chart ─────────────────────────────────────────────

/**
 * Route-Efficiency-Comparison — the web comparison `<ChartContainer>` with its horizontal `<BarChart>`: each route's
 * best / avg / worst efficiency. Shows the chart when more than one route exists (web `chartData.length > 1`), else the
 * chart container's empty surface; the accessible data table mirrors the bars for screen readers.
 */
@Composable
private fun ComparisonChartPanel(
    model: RouteEfficiencyModel,
    prefs: RouteEfficiencyDisplayPrefs,
) {
    val bars = comparisonBars(model.routes, prefs)
    val ready = bars.size > MIN_COMPARISON_ROUTES
    val unit = prefs.efficiencyUnit
    val bestLabel = "${stringResource(R.string.translation_routeEfficiency_best)} $unit"
    val avgLabel = "${stringResource(R.string.translation_routeEfficiency_avgLabel)} $unit"
    val worstLabel = "${stringResource(R.string.translation_routeEfficiency_worst)} $unit"
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_routeEfficiency_comparison),
        accessibleDescription = stringResource(R.string.translation_routeEfficiency_comparison_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_common_noData),
        height = COMPARISON_HEIGHT,
        dataTableHeader =
            if (ready) {
                listOf(stringResource(R.string.translation_routeEfficiency_col_route), bestLabel, avgLabel, worstLabel)
            } else {
                null
            },
        dataTableRows =
            if (ready) {
                bars.map { listOf(it.name, prefs.integer(it.best), prefs.integer(it.avg), prefs.integer(it.worst)) }
            } else {
                null
            },
    ) {
        val series =
            listOf(
                ChartSeries(
                    key = "best",
                    label = bestLabel,
                    values = bars.map { it.best },
                    kind = ChartSeriesKind.Bar,
                    color = TeslaTokens.status.success,
                ),
                ChartSeries(
                    key = "avg",
                    label = avgLabel,
                    values = bars.map { it.avg },
                    kind = ChartSeriesKind.Bar,
                    color = paletteColor(ACCENT_CYAN),
                ),
                ChartSeries(
                    key = "worst",
                    label = worstLabel,
                    values = bars.map { it.worst },
                    kind = ChartSeriesKind.Bar,
                    color = TeslaTokens.status.danger,
                ),
            )
        BarChartWrapper(
            series = series,
            xLabels = bars.map { it.name },
            height = COMPARISON_HEIGHT,
            yValueFormatter = { ChartFormat.number(it, 0, prefs.locale) },
        )
    }
}

// ── Panel: GlassPanel1 — Route cards ──────────────────────────────────────────────────────────────────────────

/** The route-cards list — the web `<StaggerContainer>` grid of per-route `GlassPanel1` cards. */
@Composable
private fun RouteCardsList(
    model: RouteEfficiencyModel,
    prefs: RouteEfficiencyDisplayPrefs,
) {
    StaggerContainer(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        model.routes.forEachIndexed { index, route ->
            StaggerItem(index = index) {
                RouteCard(route = route, prefs = prefs)
            }
        }
    }
}

/** GlassPanel1 — one route card: the endpoints + trip/distance line, the avg-efficiency badge, and the best/avg/worst bar. */
@Composable
private fun RouteCard(
    route: RouteSummary,
    prefs: RouteEfficiencyDisplayPrefs,
) {
    val bestDisplay = prefs.efficiencyDisplay(route.bestEfficiency)
    val avgDisplay = prefs.efficiencyDisplay(route.avgEfficiency)
    val worstDisplay = prefs.efficiencyDisplay(route.worstEfficiency)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Sm) {
                    Icon(
                        RouteEfficiencyGlyphs.MapPin,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = iconColorFor(IconBoxTone.Info),
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BodyText(route.startLocation, maxLines = 1)
                        Icon(
                            RouteEfficiencyGlyphs.ArrowRight,
                            contentDescription = null,
                            size = IconSize.Xs,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        BodyText(route.endLocation, maxLines = 1)
                    }
                    Caption(routeSubtitle(route, prefs))
                }
            }
            Badge(
                text = "${prefs.integer(avgDisplay)} ${prefs.efficiencyUnit}",
                variant = route.avgEfficiency.toBadgeVariant(),
            )
        }
        Spacer(modifier = Modifier.height(Spacing.sm))
        EfficiencyBar(best = bestDisplay, avg = avgDisplay, worst = worstDisplay)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.End),
        ) {
            EfficiencyValue(prefs.integer(bestDisplay), TeslaTokens.status.success)
            EfficiencyValue(prefs.integer(avgDisplay), paletteColor(ACCENT_CYAN))
            EfficiencyValue(prefs.integer(worstDisplay), TeslaTokens.status.danger)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.End),
        ) {
            Caption(stringResource(R.string.translation_routeEfficiency_best))
            Caption(stringResource(R.string.translation_routeEfficiency_avgLabel))
            Caption(stringResource(R.string.translation_routeEfficiency_worst))
        }
    }
}

/** The "{trips} trips · {distance} {unit} avg" line under a route's endpoints (web RouteCard subtitle). */
@Composable
private fun routeSubtitle(
    route: RouteSummary,
    prefs: RouteEfficiencyDisplayPrefs,
): String {
    val trips = stringResource(R.string.translation_routeEfficiency_trips)
    val avg = stringResource(R.string.translation_routeEfficiency_avg)
    val distance = prefs.number(prefs.distanceFromKm(route.avgDistanceKm))
    return "${route.tripCount} $trips \u00B7 $distance ${prefs.distanceLabel} $avg"
}

/**
 * The best/avg/worst efficiency bar — a green -> cyan -> red split sized by each route's best/avg/worst proportion of
 * its worst figure (web's `linear-gradient` stops). Falls back to a single neutral bar when no worst figure exists.
 */
@Composable
private fun EfficiencyBar(
    best: Double,
    avg: Double,
    worst: Double,
) {
    val denom = worst.coerceAtLeast(1.0)
    val greenFraction = (best / denom).coerceIn(0.0, 1.0).toFloat()
    val avgFraction = (avg / denom).coerceIn(0.0, 1.0).toFloat()
    val cyanFraction = (avgFraction - greenFraction).coerceAtLeast(0f)
    val redFraction = (1f - avgFraction).coerceAtLeast(0f)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(EFFICIENCY_BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        if (greenFraction + cyanFraction + redFraction <= 0f) {
            BarSegment(weight = 1f, color = MaterialTheme.colorScheme.surfaceVariant)
        } else {
            if (greenFraction > 0f) BarSegment(weight = greenFraction, color = TeslaTokens.status.success)
            if (cyanFraction > 0f) BarSegment(weight = cyanFraction, color = paletteColor(ACCENT_CYAN))
            if (redFraction > 0f) BarSegment(weight = redFraction, color = TeslaTokens.status.danger)
        }
    }
}

/** One proportional colored slice of the [EfficiencyBar]. */
@Composable
private fun RowScope.BarSegment(
    weight: Float,
    color: Color,
) {
    Spacer(
        modifier =
            Modifier
                .weight(weight)
                .fillMaxHeight()
                .background(color),
    )
}

/** One right-aligned best/avg/worst figure under the efficiency bar, tinted with its semantic [color]. */
@Composable
private fun EfficiencyValue(
    text: String,
    color: Color,
) {
    Text(text = text, style = MaterialTheme.typography.labelMedium, color = color)
}

// ── Panel: GlassPanel4 — Route metrics ────────────────────────────────────────────────────────────────────────

/** GlassPanel4 — the Route Metrics panel: four `MetricBar`s, or the `noData` empty surface when no routes exist. */
@Composable
private fun RouteMetricsPanel(
    model: RouteEfficiencyModel,
    prefs: RouteEfficiencyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                RouteEfficiencyGlyphs.TrendingUp,
                contentDescription = null,
                size = IconSize.Sm,
                tint = paletteColor(ACCENT_CYAN),
            )
            PanelTitle(stringResource(R.string.translation_routeEfficiency_metrics))
        }
        Spacer(modifier = Modifier.height(Spacing.md))
        val mostDriven = model.mostDriven
        if (mostDriven != null) {
            val unit = prefs.efficiencyUnit
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                MetricRow {
                    MetricBar(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_routeEfficiency_bestLabel),
                        value = prefs.efficiencyDisplay(model.bestEfficiency),
                        max = EFFICIENCY_BAR_MAX,
                        valueText = "${prefs.integer(prefs.efficiencyDisplay(model.bestEfficiency))} $unit",
                        color = TeslaTokens.status.success,
                    )
                    MetricBar(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_routeEfficiency_avgLabel),
                        value = prefs.efficiencyDisplay(model.avgEfficiency),
                        max = EFFICIENCY_BAR_MAX,
                        valueText = "${prefs.integer(prefs.efficiencyDisplay(model.avgEfficiency))} $unit",
                        color = paletteColor(ACCENT_CYAN),
                    )
                }
                MetricRow {
                    MetricBar(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_routeEfficiency_worstLabel),
                        value = prefs.efficiencyDisplay(model.worstEfficiency),
                        max = WORST_BAR_MAX,
                        valueText = "${prefs.integer(prefs.efficiencyDisplay(model.worstEfficiency))} $unit",
                        color = TeslaTokens.status.danger,
                    )
                    MetricBar(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_routeEfficiency_mostDrivenLabel),
                        value = mostDriven.tripCount.asDouble(),
                        max = maxOf(mostDriven.tripCount, TRIPS_BAR_MIN_MAX).asDouble(),
                        valueText = "${mostDriven.tripCount} ${stringResource(R.string.translation_routeEfficiency_trips)}",
                        color = paletteColor(ACCENT_PURPLE),
                    )
                }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_common_noData),
                icon = RouteEfficiencyGlyphs.Activity,
            )
        }
    }
}

// ── Shared small pieces ───────────────────────────────────────────────────────────────────────────────────────

/** A two-up metric row (the phone-width grid cell the web `grid-cols-2` collapses to). */
@Composable
private fun MetricRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** Maps a route's SI average efficiency to the badge variant the web `efficiencyVariant` selects. */
private fun Double.toBadgeVariant(): BadgeVariant =
    when (efficiencyGrade(this)) {
        RouteEfficiencyGrade.Success -> BadgeVariant.Success
        RouteEfficiencyGrade.Info -> BadgeVariant.Info
        RouteEfficiencyGrade.Warning -> BadgeVariant.Warning
        RouteEfficiencyGrade.Danger -> BadgeVariant.Danger
    }

/** Widens an Int count to the Double the count-up + metric-bar composables consume. */
private fun Int.asDouble(): Double =
    toDouble() // parity:allow toDouble() Int→Double widening for the chart/metric composables, not a TODO stub
