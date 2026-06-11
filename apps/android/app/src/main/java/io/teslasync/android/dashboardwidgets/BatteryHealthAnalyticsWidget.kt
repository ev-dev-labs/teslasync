// File named after its primary @Composable; the co-located registry, projection, Source seam, and
// ViewModel are supporting declarations for the same parity surface.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.datadisplay.severityColor
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

// ─────────────────────────────────────────────────────────────────────────────
// Registry metadata — parity with web/src/features/dashboard/widgets/registry/battery.ts
// (`battery-health-analytics`). Encoded here because the Android dashboard grid host does not
// exist yet; a future grid integration reads these constants to place + constrain the surface.
// ─────────────────────────────────────────────────────────────────────────────

/** A widget's grid footprint in (columns × rows), the Android analogue of the web `WidgetSize`. */
data class BatteryHealthSpan(
    val cols: Int,
    val rows: Int,
)

/** Canonical registry entry for the Battery Analytics dashboard surface. */
object BatteryHealthAnalyticsWidgetSpec {
    /** Stable registry id shared with the web + other native surfaces. */
    const val ID: String = "battery-health-analytics"

    /** Widget category (web registry `battery`). */
    const val CATEGORY: String = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SURFACE_SLUG: String = "BatteryHealthAnalyticsWidget"

    /** Default footprint (web `defaultSize` 2×4). */
    val defaultSpan: BatteryHealthSpan = BatteryHealthSpan(cols = 2, rows = 4)

    /** Smallest allowed footprint (web `minSize` 1×2). */
    val minSpan: BatteryHealthSpan = BatteryHealthSpan(cols = 1, rows = 2)

    /** Largest allowed footprint (web `maxSize` 4×40). */
    val maxSpan: BatteryHealthSpan = BatteryHealthSpan(cols = 4, rows = 40)

    /** Clamps [span] into the registry's [minSpan]..[maxSpan] envelope. */
    fun coerceSpan(span: BatteryHealthSpan): BatteryHealthSpan =
        BatteryHealthSpan(
            cols = span.cols.coerceIn(minSpan.cols, maxSpan.cols),
            rows = span.rows.coerceIn(minSpan.rows, maxSpan.rows),
        )

    /** Compact (1-column) layout: gauge only, no title/stats (web `isCompact = size.cols <= 1`). */
    fun isCompact(span: BatteryHealthSpan): Boolean = coerceSpan(span).cols <= 1
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure projection (cached SI JSON → display model). Framework-free so it runs in the JVM
// unit-test gate. Mirrors the web component's `data?.x ?? 0` derivations exactly. The web
// `useUnits`/`convertTempFromSI` import is vestigial there — no rendered value is unit-converted
// (`temp_exposure_score` is a 0–100 score, not a temperature), so no conversion is reproduced.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display-ready projection of the `/analytics/battery-health` payload — the Kotlin port of the web
 * widget's gauge + stat derivations. Every field collapses to zero when missing, exactly like the
 * web optional-chaining; [severity] is derived from [healthScore] via [batteryHealthScoreSeverity]
 * (the web `scoreColor` thresholds).
 */
data class BatteryHealthAnalyticsUi(
    val healthScore: Double,
    val severity: Severity,
    val totalCycles: Double,
    val fullChargePct: Double,
    val avgDepthOfDischarge: Double,
    val fastChargePct: Double,
    val tempExposureScore: Double,
    val chargeHabitsScore: Double,
)

private const val SCORE_GOOD_THRESHOLD = 80.0
private const val SCORE_WARN_THRESHOLD = 50.0
private const val GAUGE_MAX = 100.0
private const val PERCENT_UNIT = "%"
private const val SCORE_OUT_OF_UNIT = "/ 100"
private const val VALUE_DECIMALS = 0
private const val STATS_PER_ROW = 3
private val GAUGE_SIZE_COMPACT = 70.dp
private val GAUGE_SIZE_STANDARD = 100.dp
private val BODY_MIN_HEIGHT = 96.dp
private const val LOADING_TITLE_FRACTION = 0.5f
private val LOADING_TITLE_HEIGHT = 12.dp
private val LOADING_GAUGE_HEIGHT = 96.dp

/**
 * Maps the state-of-health [score] onto a [Severity] tone — the Android port of the web `scoreColor`
 * (≥80 healthy/green, ≥50 caution/amber, otherwise critical/red). Kept framework-free so the gate
 * unit-tests the thresholds without a device; the render layer resolves the theme color via
 * [severityColor] so light/dark/high-contrast all stay correct (no raw hex).
 */
fun batteryHealthScoreSeverity(score: Double): Severity =
    when {
        score >= SCORE_GOOD_THRESHOLD -> Severity.Success
        score >= SCORE_WARN_THRESHOLD -> Severity.Warn
        else -> Severity.Critical
    }

/**
 * Projects the cached battery-health [json] (SI/score values, snake_case on the wire — camelCase
 * tolerated) into a display [BatteryHealthAnalyticsUi]. Null/missing fields collapse to zero exactly
 * like the web `data?.field ?? 0`.
 */
fun batteryHealthAnalyticsUi(json: JsonElement?): BatteryHealthAnalyticsUi {
    val obj = json as? JsonObject
    val healthScore = obj.numberAt("current_soh", "currentSoh") ?: 0.0
    return BatteryHealthAnalyticsUi(
        healthScore = healthScore,
        severity = batteryHealthScoreSeverity(healthScore),
        totalCycles = obj.numberAt("total_cycles", "totalCycles") ?: 0.0,
        fullChargePct = obj.numberAt("full_charge_pct", "fullChargePct") ?: 0.0,
        avgDepthOfDischarge = obj.numberAt("avg_depth_of_discharge", "avgDepthOfDischarge") ?: 0.0,
        fastChargePct = obj.numberAt("fast_charge_pct", "fastChargePct") ?: 0.0,
        tempExposureScore = obj.numberAt("temp_exposure_score", "tempExposureScore") ?: 0.0,
        chargeHabitsScore = obj.numberAt("charge_habits_score", "chargeHabitsScore") ?: 0.0,
    )
}

/**
 * Web `hasData = !!data` — true once the endpoint returns an object (even all-zero), false when the
 * query is disabled/absent (no resolved vehicle) or the payload is `null`. Drives the empty-state
 * classification; an empty object is still "has data" exactly like the web truthiness check.
 */
fun batteryHealthAnalyticsHasData(json: JsonElement?): Boolean = json is JsonObject

private fun JsonObject?.numberAt(vararg keys: String): Double? =
    keys.firstNotNullOfOrNull { key -> (this?.get(key) as? JsonPrimitive)?.doubleOrNull }

// ─────────────────────────────────────────────────────────────────────────────
// State-decision logic (also JVM-testable): which mutually-exclusive surface to draw.
// ─────────────────────────────────────────────────────────────────────────────

/** The mutually-exclusive surface drawn for a given [UiState] phase (web WidgetShell branches). */
enum class BatteryHealthAnalyticsSurface { Loading, Error, Empty, Content }

/** Maps a [UiState] onto the surface to render. Stale/offline are Content/Empty + a freshness chip. */
fun batteryHealthAnalyticsSurface(state: UiState<*>): BatteryHealthAnalyticsSurface =
    when (state.phase) {
        UiPhase.Loading -> BatteryHealthAnalyticsSurface.Loading
        UiPhase.Error -> BatteryHealthAnalyticsSurface.Error
        UiPhase.Empty -> BatteryHealthAnalyticsSurface.Empty
        UiPhase.Content -> BatteryHealthAnalyticsSurface.Content
    }

/** Maps the Android [ErrorKind] + HTTP status onto the feedback layer's recovery-oriented bucket. */
fun batteryHealthAnalyticsErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

// ─────────────────────────────────────────────────────────────────────────────
// Data seam — the P1/S8 binding. A fresh cache-then-network stream per call so the ViewModel's
// refresh/retry trigger a real re-fetch (the web `refetch()`), mirroring the AlertFeed source seam.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The data port the [BatteryHealthAnalyticsWidgetViewModel] binds to — the Android analogue of the
 * web `useBatteryHealthAnalytics` hook. Each [stream] is a fresh cache-then-network [Resource] flow
 * of the `GET /analytics/battery-health` payload; the view never performs HTTP itself.
 */
fun interface BatteryHealthAnalyticsSource {
    /** Stream the cache-then-network battery-health snapshots for [vehicleId], newest following cache. */
    fun stream(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared S7 [EnergyRepository] — each [BatteryHealthAnalyticsSource.stream]
 * starts a new `repository.batteryHealthAnalytics(id)` collection, so the ViewModel's refresh/retry
 * trigger a real re-fetch (web `refetch()`).
 */
fun batteryHealthAnalyticsSource(repository: EnergyRepository): BatteryHealthAnalyticsSource =
    BatteryHealthAnalyticsSource { vehicleId -> repository.batteryHealthAnalytics(vehicleId) }

/**
 * Binds the surface to the shared S8 [EnergyStore] holder (web `useBatteryHealthAnalytics` port). Use
 * this when a host shares one app-wide energy feed across surfaces; the store folds every observer of
 * the same `(feed, vehicle)` into a single upstream collection.
 */
fun batteryHealthAnalyticsSource(store: EnergyStore): BatteryHealthAnalyticsSource =
    BatteryHealthAnalyticsSource { vehicleId -> store.batteryHealthAnalytics(vehicleId) }

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle resolution — web `vid = vehicleId ?? vehicles?.[0]?.id`. While the fleet list is still
// loading we show Loading; an explicit empty fleet (or a disabled query) shows the empty state.
// ─────────────────────────────────────────────────────────────────────────────

/** The outcome of resolving which vehicle the surface reads (web `vid ?? vehicles[0]`). */
internal sealed interface VehicleResolution {
    /** A concrete vehicle id is available. */
    data class Resolved(
        val vehicleId: Long,
    ) : VehicleResolution

    /** The fleet list is still loading and no id is known yet (web query not yet enabled). */
    data object Resolving : VehicleResolution

    /** The fleet resolved with no vehicle (web `vid == null` → query disabled → empty). */
    data object Absent : VehicleResolution
}

/** Folds the shared vehicles feed onto a [VehicleResolution] — the web `vehicles?.[0]?.id` fallback. */
internal fun resolveVehicle(res: Resource<List<Vehicle>>): VehicleResolution {
    val id = res.cached?.firstOrNull()?.id
    return when {
        id != null -> VehicleResolution.Resolved(id)
        res is Resource.Loading -> VehicleResolution.Resolving
        else -> VehicleResolution.Absent
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State holder — binds the shared P1/S8 layer (no HTTP in the view) and emits the diagnostics
// `view.opened` event on first composition.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Widget ViewModel for the Battery Analytics surface. It binds the injected
 * [BatteryHealthAnalyticsSource] (the P1/S8 seam over the shared Energy holder) and resolves the
 * read's vehicle from an explicit [explicitVehicleId] or the shared [VehiclesStore]'s first vehicle
 * (web `vehicleId ?? vehicles?.[0]?.id`), projecting the cache-then-network [Resource] onto a
 * lifecycle-aware [UiState].
 *
 * It owns NO networking — the shared layer does (ADR-002) — and emits the consent-gated, slug-only
 * `view.opened` telemetry (P1/S11) exactly once per surface open. [refresh]/[retry] bump a trigger
 * that restarts a fresh upstream collection (the web `refetch()`).
 *
 * @param source the cache-then-network battery-health seam.
 * @param vehicles the shared S8 vehicles holder, used for the first-vehicle fallback.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param explicitVehicleId an explicit selection (web `vehicleId` prop); `null` falls back to [vehicles].
 * @param scope test seam; production uses the ViewModel scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryHealthAnalyticsWidgetViewModel(
    private val source: BatteryHealthAnalyticsSource,
    vehicles: VehiclesStore,
    logger: Logger,
    private val explicitVehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val resolution: Flow<VehicleResolution> =
        if (explicitVehicleId != null) {
            flowOf(VehicleResolution.Resolved(explicitVehicleId))
        } else {
            vehicles.vehicles().map(::resolveVehicle)
        }

    /** The battery-health payload as cache-then-network UI state (loading / content / empty / stale / error). */
    val state: StateFlow<UiState<JsonElement>> =
        combine(refreshTrigger, resolution) { _, resolved -> resolved }
            .flatMapLatest { resolved ->
                when (resolved) {
                    is VehicleResolution.Resolved -> source.stream(resolved.vehicleId.toString())
                    VehicleResolution.Resolving -> LOADING_FEED
                    VehicleResolution.Absent -> ABSENT_FEED
                }
            }.asUiState { !batteryHealthAnalyticsHasData(it) }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("surface" to BatteryHealthAnalyticsWidgetSpec.SURFACE_SLUG))
    }

    /** Re-fetches the battery-health payload (web `refetch()`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("surface" to BatteryHealthAnalyticsWidgetSpec.SURFACE_SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "widget.refresh"

        private val LOADING_FEED: Flow<Resource<JsonElement>> =
            flowOf(Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false))

        private val ABSENT_FEED: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success<JsonElement>(JsonNull, fetchedAt = 0L, stale = false))

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: BatteryHealthAnalyticsSource,
            vehicles: VehiclesStore,
            logger: Logger,
            explicitVehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BatteryHealthAnalyticsWidgetViewModel(source, vehicles, logger, explicitVehicleId) }
            }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Composables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bound entry point: collects the [viewModel] state with the lifecycle, emits the one-shot
 * `view.opened` event, and renders the stateless surface. Host this in a dashboard grid cell sized
 * by [span].
 */
@Composable
fun BatteryHealthAnalyticsWidget(
    viewModel: BatteryHealthAnalyticsWidgetViewModel,
    modifier: Modifier = Modifier,
    span: BatteryHealthSpan = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    BatteryHealthAnalyticsWidget(
        state = state,
        span = span,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless Battery Analytics surface. Renders every state from the web source: loading skeleton,
 * classified error with retry, friendly empty state, and the compact (gauge-only) / standard
 * (gauge + 6-stat grid) content layouts — with a freshness chip that reflects refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the web `WidgetShell`.
 */
@Composable
fun BatteryHealthAnalyticsWidget(
    state: UiState<JsonElement>,
    span: BatteryHealthSpan,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }

    val compact = BatteryHealthAnalyticsWidgetSpec.isCompact(span)
    val title = stringResource(R.string.translation_widget_batteryHealthAnalytics_title)

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        if (!compact) {
            BatteryHealthHeader(title = title, state = state, onRefresh = onRefresh)
        } else {
            BatteryHealthCompactFreshness(state = state)
        }
        Box(
            modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT),
            contentAlignment = Alignment.Center,
        ) {
            when (batteryHealthAnalyticsSurface(state)) {
                BatteryHealthAnalyticsSurface.Loading -> BatteryHealthLoading(compact = compact, accessibilityLabel = title)
                BatteryHealthAnalyticsSurface.Error -> BatteryHealthError(state = state, onRetry = onRetry)
                BatteryHealthAnalyticsSurface.Empty -> BatteryHealthEmpty()
                BatteryHealthAnalyticsSurface.Content -> BatteryHealthContent(json = state.data, compact = compact)
            }
        }
    }
}

@Composable
private fun BatteryHealthHeader(
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
            DataDisplayGlyphs.Battery,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title, modifier = Modifier.weight(1f))
        BatteryHealthFreshness(state = state, compact = false)
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun BatteryHealthCompactFreshness(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        BatteryHealthFreshness(state = state, compact = true)
    }
}

@Composable
private fun BatteryHealthFreshness(
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
private fun BatteryHealthLoading(
    compact: Boolean,
    accessibilityLabel: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = accessibilityLabel },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (!compact) Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_GAUGE_HEIGHT, rounded = true)
    }
}

@Composable
private fun BatteryHealthError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = batteryHealthAnalyticsErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_batteryHealthAnalytics_title),
        onRetry = onRetry,
    )
}

@Composable
private fun BatteryHealthEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_batteryHealthAnalytics_noData),
        icon = DataDisplayGlyphs.Battery,
    )
}

@Composable
private fun BatteryHealthContent(
    json: JsonElement?,
    compact: Boolean,
) {
    val ui = remember(json) { batteryHealthAnalyticsUi(json) }
    val scoreUnit = stringResource(R.string.translation_widget_batteryHealthAnalytics_score)
    val stats = if (compact) emptyList() else batteryHealthStats(ui)
    BatteryHealthGaugeHero(
        ui = ui,
        scoreUnit = scoreUnit,
        stats = stats,
        compact = compact,
    )
}

/** Builds the six localized gauge-hero stats (web `stats` array) — values are dimensionless scores/percentages. */
@Composable
private fun batteryHealthStats(ui: BatteryHealthAnalyticsUi): List<GaugeHeroStat> {
    val locale = Locale.getDefault()
    return listOf(
        GaugeHeroStat(
            label = stringResource(R.string.translation_widget_batteryHealthAnalytics_totalCycles),
            value = ChartFormat.number(ui.totalCycles, VALUE_DECIMALS, locale),
            unit = null,
        ),
        GaugeHeroStat(
            label = stringResource(R.string.translation_widget_batteryHealthAnalytics_avgChargeDepth),
            value = ChartFormat.number(ui.fullChargePct, VALUE_DECIMALS, locale),
            unit = PERCENT_UNIT,
        ),
        GaugeHeroStat(
            label = stringResource(R.string.translation_widget_batteryHealthAnalytics_avgDischargeDepth),
            value = ChartFormat.number(ui.avgDepthOfDischarge, VALUE_DECIMALS, locale),
            unit = PERCENT_UNIT,
        ),
        GaugeHeroStat(
            label = stringResource(R.string.translation_widget_batteryHealthAnalytics_dcFastRatio),
            value = ChartFormat.number(ui.fastChargePct, VALUE_DECIMALS, locale),
            unit = PERCENT_UNIT,
        ),
        GaugeHeroStat(
            label = stringResource(R.string.translation_widget_batteryHealthAnalytics_tempExposure),
            value = ChartFormat.number(ui.tempExposureScore, VALUE_DECIMALS, locale),
            unit = SCORE_OUT_OF_UNIT,
        ),
        GaugeHeroStat(
            label = stringResource(R.string.translation_widget_batteryHealthAnalytics_chargeHabits),
            value = ChartFormat.number(ui.chargeHabitsScore, VALUE_DECIMALS, locale),
            unit = SCORE_OUT_OF_UNIT,
        ),
    )
}

/** One projected gauge-hero stat (web `GaugeHeroStat`): a localized [label] + formatted [value] + optional [unit]. */
private data class GaugeHeroStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The Android port of the web `WidgetGaugeHero`: a state-of-health [RadialGauge] (tinted by the
 * derived [BatteryHealthAnalyticsUi.severity]) above a centered grid of [stats]. The standard layout
 * shows the grid; the compact layout shows the gauge alone (web `compact`).
 */
@Composable
private fun BatteryHealthGaugeHero(
    ui: BatteryHealthAnalyticsUi,
    scoreUnit: String,
    stats: List<GaugeHeroStat>,
    compact: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        RadialGauge(
            value = ui.healthScore,
            max = GAUGE_MAX,
            label = ChartFormat.number(ui.healthScore, VALUE_DECIMALS),
            unit = scoreUnit,
            color = severityColor(ui.severity),
            size = gaugeSize(compact),
            decimals = VALUE_DECIMALS,
        )
        if (!compact && stats.isNotEmpty()) {
            BatteryHealthStatGrid(stats)
        }
    }
}

@Composable
private fun BatteryHealthStatGrid(stats: List<GaugeHeroStat>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.chunked(STATS_PER_ROW).forEach { rowStats ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                rowStats.forEach { stat ->
                    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        GaugeHeroStatCell(stat)
                    }
                }
                repeat(STATS_PER_ROW - rowStats.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun GaugeHeroStatCell(stat: GaugeHeroStat) {
    val valueText = if (stat.unit != null) "${stat.value} ${stat.unit}" else stat.value
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.none),
    ) {
        Caption(text = stat.label)
        BodyText(text = valueText, maxLines = 1)
    }
}

private fun gaugeSize(compact: Boolean): Dp = if (compact) GAUGE_SIZE_COMPACT else GAUGE_SIZE_STANDARD

// ─────────────────────────────────────────────────────────────────────────────
// Previews — one per rendered state (content / compact / empty / loading / error).
// ─────────────────────────────────────────────────────────────────────────────

private fun previewBatteryHealthJson(): JsonElement =
    JsonObject(
        mapOf(
            "current_soh" to JsonPrimitive(92.0),
            "total_cycles" to JsonPrimitive(312.0),
            "full_charge_pct" to JsonPrimitive(18.0),
            "avg_depth_of_discharge" to JsonPrimitive(47.0),
            "fast_charge_pct" to JsonPrimitive(23.0),
            "temp_exposure_score" to JsonPrimitive(88.0),
            "charge_habits_score" to JsonPrimitive(74.0),
        ),
    )

@Preview(name = "BatteryHealthAnalytics · content", showBackground = true)
@Composable
private fun BatteryHealthAnalyticsContentPreview() {
    TeslaSyncTheme {
        BatteryHealthAnalyticsWidget(
            state = UiState(phase = UiPhase.Content, data = previewBatteryHealthJson(), fetchedAt = System.currentTimeMillis()),
            span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "BatteryHealthAnalytics · compact", showBackground = true)
@Composable
private fun BatteryHealthAnalyticsCompactPreview() {
    TeslaSyncTheme {
        BatteryHealthAnalyticsWidget(
            state = UiState(phase = UiPhase.Content, data = previewBatteryHealthJson(), fetchedAt = System.currentTimeMillis()),
            span = BatteryHealthSpan(cols = 1, rows = 2),
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "BatteryHealthAnalytics · empty", showBackground = true)
@Composable
private fun BatteryHealthAnalyticsEmptyPreview() {
    TeslaSyncTheme {
        BatteryHealthAnalyticsWidget(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "BatteryHealthAnalytics · loading", showBackground = true)
@Composable
private fun BatteryHealthAnalyticsLoadingPreview() {
    TeslaSyncTheme {
        BatteryHealthAnalyticsWidget(
            state = UiState.loading(),
            span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "BatteryHealthAnalytics · error", showBackground = true)
@Composable
private fun BatteryHealthAnalyticsErrorPreview() {
    TeslaSyncTheme {
        BatteryHealthAnalyticsWidget(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
            onRefresh = {},
            onRetry = {},
        )
    }
}
