// File named after its primary @Composable; the co-located adapter, registry, and
// ViewModel are supporting declarations for the same parity surface.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

// ─────────────────────────────────────────────────────────────────────────────
// Registry metadata — parity with web/src/features/dashboard/widgets/registry/analytics.ts
// (`analytics-summary`). Encoded here because the Android dashboard grid host does not exist
// yet; a future grid integration reads these constants to place + constrain the surface.
// ─────────────────────────────────────────────────────────────────────────────

/** A widget's grid footprint in (columns × rows), the Android analogue of the web `WidgetSize`. */
data class WidgetSpan(
    val cols: Int,
    val rows: Int,
)

/** Canonical registry entry for the Analytics Summary dashboard surface. */
object AnalyticsSummaryWidgetSpec {
    /** Stable registry id shared with the web + Windows surfaces. */
    const val ID: String = "analytics-summary"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SURFACE_SLUG: String = "AnalyticsSummaryWidget"

    /** Trailing window (days) the summary feed is fetched for — web `useAnalyticsSummary()` default. */
    const val DEFAULT_WINDOW_DAYS: Int = 30

    /** Default footprint (web `defaultSize`). */
    val defaultSpan: WidgetSpan = WidgetSpan(cols = 2, rows = 2)

    /** Smallest allowed footprint (web `minSize`). */
    val minSpan: WidgetSpan = WidgetSpan(cols = 1, rows = 2)

    /** Largest allowed footprint (web `maxSize`). */
    val maxSpan: WidgetSpan = WidgetSpan(cols = 4, rows = 40)

    /** Clamps [span] into the registry's [minSpan]..[maxSpan] envelope. */
    fun coerceSpan(span: WidgetSpan): WidgetSpan =
        WidgetSpan(
            cols = span.cols.coerceIn(minSpan.cols, maxSpan.cols),
            rows = span.rows.coerceIn(minSpan.rows, maxSpan.rows),
        )

    /** Compact (1-column) layout: a single large distance figure (web `isCompact`). */
    fun isCompact(span: WidgetSpan): Boolean = coerceSpan(span).cols <= 1

    /** Wide (4-column) layout: a 4-up stat grid plus trend sparklines (web `isWide`). */
    fun isWide(span: WidgetSpan): Boolean = coerceSpan(span).cols >= WIDE_COLS

    private const val WIDE_COLS = 4
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure projection (cached SI JSON → display model). Framework-free so it runs in the
// JVM unit-test gate. Mirrors the web component's derivations exactly.
// ─────────────────────────────────────────────────────────────────────────────

/** A single display metric: a numeric [value] already in the user's unit plus its [unit] label. */
data class AnalyticsMetric(
    val value: Double,
    val unit: String,
)

/**
 * Display-ready projection of the `/analytics/fleet` summary, the Kotlin port of the web
 * component's `useMemo`/derivations. Distances/efficiency are converted to the user's unit;
 * [costPerDistance] is the raw `totalCost / displayDistance` (formatting decides the `—` fallback).
 */
data class AnalyticsSummaryUi(
    val distance: AnalyticsMetric,
    val efficiency: AnalyticsMetric,
    val energy: AnalyticsMetric,
    val costPerDistance: Double,
    val hasData: Boolean,
    val sparklines: List<List<Double>>,
)

/** The user's display preferences this surface needs — the web `useUnits` + `useFormatting` ports. */
data class AnalyticsDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val currencySymbol: String,
) {
    companion object {
        /** Metric + `$` fallback used before settings load (matches the web defaults). */
        val METRIC_DEFAULT: AnalyticsDisplayPrefs =
            AnalyticsDisplayPrefs(DistanceUnitPref.KM, DEFAULT_CURRENCY)
    }
}

private const val METERS_PER_KM = 1000.0
private const val KM_PER_MILE = 1.60934
private const val DEFAULT_CURRENCY = "$"
private const val ENERGY_UNIT = "kWh"
private const val EFFICIENCY_UNIT_KM = "Wh/km"
private const val EFFICIENCY_UNIT_MI = "Wh/mi"
private const val DISTANCE_DECIMALS = 0
private const val EFFICIENCY_DECIMALS = 0
private const val ENERGY_DECIMALS = 1
private const val COST_DECIMALS = 3
private const val MIN_SPARKLINE_POINTS = 2
private const val EVENT_VIEW_OPENED = "view.opened"
private const val EVENT_REFRESH = "widget.refresh"

/**
 * Projects the cached summary [json] (SI, snake_case on the wire — camelCase tolerated) into a
 * display [AnalyticsSummaryUi] for [distanceUnit]. Null/missing fields collapse to zero exactly
 * like the web optional-chaining (`data?.x ?? 0`).
 */
fun analyticsSummaryUi(
    json: JsonElement?,
    distanceUnit: DistanceUnitPref,
): AnalyticsSummaryUi {
    val obj = json as? JsonObject
    val distanceKm = obj.numberAt("total_distance_km", "totalDistanceKm") ?: 0.0
    val energyKwh = obj.numberAt("total_energy_kwh", "totalEnergyKwh") ?: 0.0
    val totalCost = obj.numberAt("total_cost", "totalCost") ?: 0.0
    val efficiencyWhKm = obj.numberAt("avg_efficiency_wh_km", "avgEfficiencyWhKm") ?: 0.0

    val displayDistance = convertDistanceFromSI(distanceKm * METERS_PER_KM, distanceUnit)
    val isMiles = distanceUnit == DistanceUnitPref.MI
    val displayEfficiency = if (isMiles) efficiencyWhKm * KM_PER_MILE else efficiencyWhKm
    val efficiencyUnit = if (isMiles) EFFICIENCY_UNIT_MI else EFFICIENCY_UNIT_KM
    val costPerDistance = if (displayDistance > 0.0) totalCost / displayDistance else 0.0

    return AnalyticsSummaryUi(
        distance = AnalyticsMetric(displayDistance, distanceUnit.label),
        efficiency = AnalyticsMetric(displayEfficiency, efficiencyUnit),
        energy = AnalyticsMetric(energyKwh, ENERGY_UNIT),
        costPerDistance = costPerDistance,
        hasData = distanceKm > 0.0 || energyKwh > 0.0,
        sparklines =
            listOf(
                obj.doubleArrayAt("distance_trend", "distanceTrend"),
                obj.doubleArrayAt("efficiency_trend", "efficiencyTrend"),
                obj.doubleArrayAt("energy_trend", "energyTrend"),
                obj.doubleArrayAt("cost_trend", "costTrend"),
            ),
    )
}

/** Web `hasData = distKm > 0 || energyKwh > 0` — drives the empty-state classification. */
fun analyticsSummaryHasData(json: JsonElement?): Boolean {
    val obj = json as? JsonObject
    val distanceKm = obj.numberAt("total_distance_km", "totalDistanceKm") ?: 0.0
    val energyKwh = obj.numberAt("total_energy_kwh", "totalEnergyKwh") ?: 0.0
    return distanceKm > 0.0 || energyKwh > 0.0
}

/** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
fun displayPrefsFrom(settings: JsonElement?): AnalyticsDisplayPrefs =
    AnalyticsDisplayPrefs(
        distanceUnit = UnitPreferences.fromSettings(settings).distance,
        currencySymbol = currencySymbolFrom(settings),
    )

/** Formats the cost-per-distance figure as `currency` + 3 decimals, or the em-dash when zero. */
fun formatCostPerDistance(
    costPerDistance: Double,
    currencySymbol: String,
    locale: Locale = Locale.getDefault(),
): String =
    if (costPerDistance > 0.0) {
        "$currencySymbol${ChartFormat.number(costPerDistance, COST_DECIMALS, locale)}"
    } else {
        ChartFormat.EMPTY
    }

private fun currencySymbolFrom(settings: JsonElement?): String {
    val raw = (settings as? JsonObject)?.get("currency_symbol") as? JsonPrimitive
    val value = raw?.contentOrNull?.trim()
    return if (!value.isNullOrEmpty()) value else DEFAULT_CURRENCY
}

private fun JsonObject?.numberAt(vararg keys: String): Double? =
    keys.firstNotNullOfOrNull { key -> (this?.get(key) as? JsonPrimitive)?.doubleOrNull }

private fun JsonObject?.doubleArrayAt(vararg keys: String): List<Double> =
    keys
        .firstNotNullOfOrNull { key -> this?.get(key) as? JsonArray }
        ?.mapNotNull { (it as? JsonPrimitive)?.doubleOrNull }
        ?: emptyList()

// ─────────────────────────────────────────────────────────────────────────────
// State-decision logic (also JVM-testable): which mutually-exclusive surface to draw.
// ─────────────────────────────────────────────────────────────────────────────

/** The mutually-exclusive surface drawn for a given [UiState] phase (web WidgetShell branches). */
enum class AnalyticsSummarySurface { Loading, Error, Empty, Content }

/** Maps a [UiState] onto the surface to render. Stale/offline are Content/Empty + a freshness chip. */
fun analyticsSummarySurface(state: UiState<*>): AnalyticsSummarySurface =
    when (state.phase) {
        UiPhase.Loading -> AnalyticsSummarySurface.Loading
        UiPhase.Error -> AnalyticsSummarySurface.Error
        UiPhase.Empty -> AnalyticsSummarySurface.Empty
        UiPhase.Content -> AnalyticsSummarySurface.Content
    }

/** Maps the Android [ErrorKind] + HTTP status onto the feedback layer's recovery-oriented bucket. */
fun analyticsSummaryErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

// ─────────────────────────────────────────────────────────────────────────────
// State holder — binds the shared P1/S8 AnalyticsStore + SettingsStore (no HTTP in the view)
// and emits the diagnostics `view.opened` event on first composition.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Page-style ViewModel for the Analytics Summary widget. Binds the shared [AnalyticsStore] summary
 * feed (web `useAnalyticsSummary`) onto a lifecycle-aware [UiState] and derives the display
 * preferences from the shared [SettingsStore] (web `useUnits`/`useFormatting`). It owns no
 * networking — the shared holders do (ADR-002) — and emits the `view.opened` telemetry on creation.
 */
class AnalyticsSummaryWidgetViewModel(
    private val analytics: AnalyticsStore,
    settings: SettingsStore,
    logger: Logger,
    private val days: Int = AnalyticsSummaryWidgetSpec.DEFAULT_WINDOW_DAYS,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    /** The summary as cache-then-network UI state (loading / content / empty / stale / error). */
    val summary: StateFlow<UiState<JsonElement>> =
        analytics.analyticsSummary(days).asUiState(::isSummaryEmpty)

    /** The live display preferences (distance unit + currency), re-derived as settings change. */
    val displayPrefs: StateFlow<AnalyticsDisplayPrefs> =
        settings
            .settings()
            .map { resource -> displayPrefsFrom(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = AnalyticsDisplayPrefs.METRIC_DEFAULT,
            )

    init {
        logger.info(EVENT_VIEW_OPENED, mapOf("surface" to AnalyticsSummaryWidgetSpec.SURFACE_SLUG))
    }

    /** Re-fetches the summary feed (manual refresh / auto-refresh on staleness). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("surface" to AnalyticsSummaryWidgetSpec.SURFACE_SLUG))
        analytics.refreshAnalyticsSummary(days)
    }

    private fun isSummaryEmpty(json: JsonElement): Boolean = !analyticsSummaryHasData(json)
}

// ─────────────────────────────────────────────────────────────────────────────
// Composables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bound entry point: collects the [viewModel] state with the lifecycle and renders the stateless
 * surface. Host this in a dashboard grid cell sized by [span].
 */
@Composable
fun AnalyticsSummaryWidget(
    viewModel: AnalyticsSummaryWidgetViewModel,
    modifier: Modifier = Modifier,
    span: WidgetSpan = AnalyticsSummaryWidgetSpec.defaultSpan,
) {
    val state by viewModel.summary.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    AnalyticsSummaryWidget(
        state = state,
        prefs = prefs,
        span = span,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless Analytics Summary surface. Renders every state from the web source: loading skeleton,
 * classified error with retry, friendly empty state, and the compact/standard/wide content layouts —
 * with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes.
 */
@Composable
fun AnalyticsSummaryWidget(
    state: UiState<JsonElement>,
    prefs: AnalyticsDisplayPrefs,
    span: WidgetSpan,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }

    val compact = AnalyticsSummaryWidgetSpec.isCompact(span)
    val wide = AnalyticsSummaryWidgetSpec.isWide(span)
    val title = stringResource(R.string.translation_widget_analyticsSummary_title)

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when (analyticsSummarySurface(state)) {
            AnalyticsSummarySurface.Loading -> AnalyticsSummaryLoading(compact = compact, accessibilityLabel = title)
            AnalyticsSummarySurface.Error -> AnalyticsSummaryError(state = state, onRetry = onRefresh)
            AnalyticsSummarySurface.Empty -> {
                if (!compact) AnalyticsSummaryHeader(title = title, state = state, onRefresh = onRefresh)
                AnalyticsSummaryEmpty()
            }
            AnalyticsSummarySurface.Content ->
                if (compact) {
                    AnalyticsSummaryCompact(state = state, prefs = prefs)
                } else {
                    AnalyticsSummaryHeader(title = title, state = state, onRefresh = onRefresh)
                    AnalyticsSummaryStandard(json = state.data, prefs = prefs, wide = wide)
                }
        }
    }
}

@Composable
private fun AnalyticsSummaryHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            NavGlyphs.Chart,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title, modifier = Modifier.weight(1f))
        AnalyticsSummaryFreshness(state = state, compact = false)
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun AnalyticsSummaryFreshness(
    state: UiState<*>,
    compact: Boolean,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt,
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = compact,
    )
}

@Composable
private fun AnalyticsSummaryLoading(
    compact: Boolean,
    accessibilityLabel: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = accessibilityLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (!compact) Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        if (compact) {
            Skeleton(widthFraction = LOADING_NUMBER_FRACTION, height = LOADING_NUMBER_HEIGHT)
        } else {
            StatGridSkeleton(count = 2)
            StatGridSkeleton(count = 2)
        }
    }
}

@Composable
private fun AnalyticsSummaryError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = analyticsSummaryErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_analyticsSummary_title),
        onRetry = onRetry,
    )
}

@Composable
private fun AnalyticsSummaryEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_analyticsSummary_noData),
        icon = NavGlyphs.Chart,
    )
}

@Composable
private fun AnalyticsSummaryCompact(
    state: UiState<JsonElement>,
    prefs: AnalyticsDisplayPrefs,
) {
    val locale = Locale.getDefault()
    val ui = remember(state.data, prefs) { analyticsSummaryUi(state.data, prefs.distanceUnit) }
    val reduce = rememberReducedMotion()
    val label = stringResource(R.string.translation_widget_analyticsSummary_totalDistance)
    val valueText = ChartFormat.number(ui.distance.value, DISTANCE_DECIMALS, locale)
    val suffix = " ${ui.distance.unit}"

    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        AnalyticsSummaryFreshness(state = state, compact = true)
    }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = COMPACT_MIN_HEIGHT)
                .semantics { contentDescription = "$label: $valueText$suffix" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (reduce) {
            MetricValue("$valueText$suffix")
        } else {
            AnimatedNumber(value = ui.distance.value, decimals = DISTANCE_DECIMALS, suffix = suffix)
        }
        MetricLabel(label)
    }
}

@Composable
private fun AnalyticsSummaryStandard(
    json: JsonElement?,
    prefs: AnalyticsDisplayPrefs,
    wide: Boolean,
) {
    val locale = Locale.getDefault()
    val ui = remember(json, prefs) { analyticsSummaryUi(json, prefs.distanceUnit) }

    val distance =
        StatItem(
            label = stringResource(R.string.translation_widget_analyticsSummary_totalDistance),
            value = ChartFormat.number(ui.distance.value, DISTANCE_DECIMALS, locale),
            unit = ui.distance.unit,
            icon = NavGlyphs.Route,
        )
    val efficiency =
        StatItem(
            label = stringResource(R.string.translation_widget_analyticsSummary_avgEfficiency),
            value = ChartFormat.number(ui.efficiency.value, EFFICIENCY_DECIMALS, locale),
            unit = ui.efficiency.unit,
            icon = DataDisplayGlyphs.Gauge,
        )
    val energy =
        StatItem(
            label = stringResource(R.string.translation_widget_analyticsSummary_energyConsumed),
            value = ChartFormat.number(ui.energy.value, ENERGY_DECIMALS, locale),
            unit = ui.energy.unit,
            icon = DataDisplayGlyphs.Bolt,
        )
    val cost =
        StatItem(
            label = stringResource(R.string.translation_widget_analyticsSummary_costPerDist, prefs.distanceUnit.label),
            value = formatCostPerDistance(ui.costPerDistance, prefs.currencySymbol, locale),
            unit = null,
            icon = FormsGlyphs.Tag,
        )

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (wide) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                StatTile(distance)
                StatTile(efficiency)
                StatTile(energy)
                StatTile(cost)
            }
            AnalyticsSummarySparklines(ui.sparklines)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                StatTile(distance)
                StatTile(efficiency)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                StatTile(energy)
                StatTile(cost)
            }
        }
    }
}

@Composable
private fun AnalyticsSummarySparklines(sparklines: List<List<Double>>) {
    if (sparklines.none { it.size >= MIN_SPARKLINE_POINTS }) return
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = SPARKLINE_ROW_HEIGHT),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        sparklines.forEachIndexed { index, trend ->
            Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                if (trend.size >= MIN_SPARKLINE_POINTS) {
                    Sparkline(data = trend, color = paletteColor(index))
                }
            }
        }
    }
}

@Composable
private fun RowScope.StatTile(item: StatItem) {
    StatCard(
        label = item.label,
        value = item.value,
        modifier = Modifier.weight(1f),
        unit = item.unit,
        icon = item.icon,
    )
}

private data class StatItem(
    val label: String,
    val value: String,
    val unit: String?,
    val icon: ImageVector,
)

private const val LOADING_TITLE_FRACTION = 0.5f
private const val LOADING_NUMBER_FRACTION = 0.6f
private val LOADING_TITLE_HEIGHT = 12.dp
private val LOADING_NUMBER_HEIGHT = 28.dp
private val COMPACT_MIN_HEIGHT = 44.dp
private val SPARKLINE_ROW_HEIGHT = 30.dp
