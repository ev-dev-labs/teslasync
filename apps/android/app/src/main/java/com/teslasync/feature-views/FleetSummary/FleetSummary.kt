// The native Jetpack Compose + Material 3 FleetSummary feature view — a parity port of
// web/src/features/vehicles/components/FleetSummary.tsx. The web component renders a responsive grid
// (`grid-cols-2 sm:grid-cols-4 gap-4`) of four `GlassPanel` KPI cards — Vehicles, Avg Battery, Total
// Range, Charging / Online — each a centered lucide icon over an `AnimatedNumber` over a muted uppercase
// label. It receives the enrolled `vehicles` list (its parent's `useVehicles`) and runs its own
// `useQuery` that fetches every vehicle's last-known state (`fetchVehicleState`, 30s refetch), then
// reduces those states into the average battery, the summed SI range, and the charging / online counts.
//
// This port keeps that contract exactly and, because the surface owns a data feed, reproduces the full
// cache-then-network state set the per-surface parity rule mandates: a skeleton grid while the enrolled
// list first-loads, a retry surface on a hard list failure, the four-card grid otherwise (with zeros for
// an empty fleet — the web `?? 0` friendly empty surface, never a blank box), and an "offline / last
// known" freshness chip + auto-refresh + retry while showing cached content after a failed refresh. All
// data flows through the shared P1/S8 feeds via [FleetSummaryViewModel] (`VehiclesStore.vehicles()` +
// per-vehicle `vehicleState(id)`); the SI range is unit-converted at this render boundary via the live
// `useUnits` formatter. The view never performs HTTP. Every string resolves through the i18n catalog
// (P1/S10) and the one interactive control (retry) carries a TalkBack label. The one-shot `view.opened`
// diagnostic (P1/S11) fires on first composition.
//
// Every derivation flows through the pure [FleetSummaryProjection] / [combineFleetSummary]; this file is
// a thin render layer that resolves the i18n labels, the live display units, the design-token accents
// (P1/S9), and the reduced-motion preference, then draws them. The count-up value renderer is local
// rather than the shared `AnimatedNumber`: the shared component forces the on-surface metric colour (so
// it cannot carry the web's per-card cyan / green / purple / amber accents or the charging card's green
// value) and does not honour reduced motion, so a local count-up reproduces its contract (count up from
// zero on first composition; collapse to a static figure under reduced motion) while adding the colour.
// GlassPanel → [GlassPanel], the motion stagger → [StaggerItem], the freshness chip → [DataFreshness].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetSummary) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleetsummary

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.util.Locale

/** Web Tailwind `sm` breakpoint (640px): at or above this width the four cards lay out one-per-column. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_SM: Int = 4
private const val GRID_COLUMNS_BASE: Int = 2

/** Web `<X className="h-5 w-5" />` — the centered lucide icon above each card value (20dp = `IconSize.Lg`). */
private val CARD_ICON_SIZE: IconSize = IconSize.Lg
private val LOADING_CARD_HEIGHT: Dp = 96.dp

// ── Data seam (P1/S8) ─────────────────────────────────────────────────────────────────────────────────

/**
 * The data port this surface binds to — the native analogue of the two web feeds the component composes:
 * `useVehicles` (the enrolled-vehicle list, threaded in as the `vehicles` prop) and the internal
 * `useQuery` that maps each vehicle to its `fetchVehicleState` (web `useVehicleState`). A narrow seam so
 * the view-model depends on an abstraction (real S8 adapter ↔ test fake), never on a concrete store or
 * the network. The view never performs HTTP.
 */
interface FleetSummarySource {
    /** The cache-then-network `GET /vehicles` enrolled-list feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` feed for one vehicle (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer feeds every
 * surface shares. The store's background refresh + live values flow through unchanged. No HTTP touches
 * the view.
 */
fun fleetSummarySource(vehicles: VehiclesStore): FleetSummarySource =
    object : FleetSummarySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = vehicles.vehicleState(vehicleId)
    }

// ── View-model ──────────────────────────────────────────────────────────────────────────────────────

/**
 * UI-thread-free state holder backing FleetSummary. It binds the enrolled list (web `useVehicles`) and
 * fans out to each vehicle's state feed (web `useQuery` over `fetchVehicleState`), folding them into one
 * [UiState] surface via [combineFleetSummary]. It exposes the single refresh action plus the PII-safe
 * `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh] /
 * [recordViewOpened].
 *
 * @param source the cache-then-network seam (an S8 adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetSummaryViewModel(
    private val source: FleetSummarySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the enrolled-list feed (and, through it, the per-vehicle states),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined enrolled-list + per-vehicle-states payload as cache-then-network UI state. The outer
     * [flatMapLatest] re-derives the per-vehicle fan-out whenever the enrolled list changes; the inner
     * [combine] joins each vehicle's state feed (an empty fleet short-circuits to a single emission so
     * `combine` of an empty list never stalls), then [combineFleetSummary] folds them into the surface.
     */
    val state: StateFlow<UiState<FleetSummaryData>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .flatMapLatest { vehiclesRes ->
                val ids = vehiclesRes.cached?.map { it.id } ?: emptyList()
                if (ids.isEmpty()) {
                    flowOf(combineFleetSummary(vehiclesRes, emptyList()))
                } else {
                    combine(ids.map { source.vehicleState(it) }) { states ->
                        combineFleetSummary(vehiclesRes, states.toList())
                    }
                }
            }.stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** Re-runs the cache-then-network load of the enrolled list + states (the web auto-refetch + error retry). */
    fun refresh() {
        logger.info("fleetSummary.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no fleet totals, so a diagnostics line can never leak vehicle counts or battery
     * levels. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        FleetSummaryDiagnostics.recordViewOpened(logger)
    }
}

// ── Composables ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry point — the faithful port of the web `FleetSummary({ vehicles })`. Binds the shared
 * feeds via [source] into a [FleetSummaryViewModel], records the one-shot `view.opened` diagnostic,
 * resolves the live display units from the shared settings store (the web `useUnits` boundary), and
 * renders. A host may supply its own [source]; by default it is bound to the app's shared
 * [VehiclesStore].
 *
 * @param source the cache-then-network seam; defaults to the shared S8 vehicles store.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey a unique key per placement so multiple instances do not share one view-model.
 */
@Composable
fun FleetSummary(
    modifier: Modifier = Modifier,
    source: FleetSummarySource? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = FleetSummaryDiagnostics.SLUG,
) {
    val container = LocalDataContainer.current
    val resolvedSource = remember(source, container) { source ?: fleetSummarySource(container.vehiclesStore) }
    val viewModel: FleetSummaryViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { FleetSummaryViewModel(resolvedSource, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by container.unitFormatter.collectAsStateWithLifecycle()
    val prefs = remember(formatter) { FleetSummaryDisplayPrefs.fromUnitPref(formatter.prefs) }

    FleetSummaryContent(
        state = state,
        prefs = prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Reproduces the
 * cache-then-network short-circuits (enrolled-list first-load → skeleton grid, hard list failure → retry
 * surface) and otherwise the four-card grid, with an "offline / last known" freshness chip above it while
 * showing cached content after a failed refresh. Stale (non-error) data auto-refreshes, mirroring the web
 * `refetchInterval`. [prefs] supplies the SI→display range conversion; [locale] drives number grouping.
 */
@Composable
fun FleetSummaryContent(
    state: UiState<FleetSummaryData>,
    prefs: FleetSummaryDisplayPrefs,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    // Web `refetchInterval`: a stale (TTL-expired) read silently re-fetches. A hard error owns the retry
    // surface and an offline read keeps its explicit retry, so neither auto-loops here.
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }

    when {
        state.isLoading -> FleetSummaryLoading(modifier = modifier)
        state.isError -> FleetSummaryError(onRetry = onRefresh, modifier = modifier)
        else -> {
            val display =
                remember(state.data, prefs) {
                    FleetSummaryProjection.project(state.data ?: FleetSummaryData.EMPTY, prefs)
                }
            Column(
                modifier = modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                if (state.stale || state.refreshing) {
                    FleetSummaryFreshness(state = state, onRefresh = onRefresh)
                }
                FleetSummaryGrid(display = display, locale = locale, reduceMotion = reduceMotion)
            }
        }
    }
}

/**
 * The web responsive grid: four KPI cards laid out one-per-column at or above [GRID_SM_MIN_WIDTH]
 * (`sm:grid-cols-4`) and two-per-row below it (`grid-cols-2`), with the web `gap-4` spacing. Each card
 * fills its column via [Modifier.weight] and the row's intrinsic max height so a row stays uniform; a
 * partial trailing row is padded with weighted spacers. Each card is wrapped in a [StaggerItem] keyed by
 * its source-order index so the entrance staggers and honours reduced motion.
 */
@Composable
private fun FleetSummaryGrid(
    display: FleetSummaryDisplay,
    locale: Locale,
    reduceMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val cards: List<@Composable (Modifier) -> Unit> =
        listOf(
            { cardModifier -> VehiclesCard(display, reduceMotion, locale, cardModifier) },
            { cardModifier -> AvgBatteryCard(display, reduceMotion, locale, cardModifier) },
            { cardModifier -> TotalRangeCard(display, reduceMotion, locale, cardModifier) },
            { cardModifier -> ChargingOnlineCard(display, reduceMotion, locale, cardModifier) },
        )
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) GRID_COLUMNS_SM else GRID_COLUMNS_BASE
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cards.chunked(columns).forEachIndexed { rowIndex, rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEachIndexed { columnIndex, card ->
                        StaggerItem(
                            index = rowIndex * columns + columnIndex,
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        ) {
                            card(Modifier.fillMaxSize())
                        }
                    }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

// ── Cards (web source order) ──────────────────────────────────────────────────────────────────────────

/** Vehicles: the enrolled count (web `Car` icon, cyan). */
@Composable
private fun VehiclesCard(
    display: FleetSummaryDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    FleetSummaryCard(
        icon = FleetSummaryGlyphs.Car,
        accent = SummaryAccent.Cyan,
        label = stringResource(R.string.translation_fleet_vehicles),
        modifier = modifier,
    ) {
        FleetSummaryCountUp(
            value = display.vehicleCount,
            decimals = COUNT_DECIMALS,
            color = MaterialTheme.colorScheme.onSurface,
            reduceMotion = reduceMotion,
            locale = locale,
        )
    }
}

/** Avg Battery: the fleet-average battery percent (web `Battery` icon, green). */
@Composable
private fun AvgBatteryCard(
    display: FleetSummaryDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    FleetSummaryCard(
        icon = DataDisplayGlyphs.Battery,
        accent = SummaryAccent.Green,
        label = stringResource(R.string.translation_fleet_avgBattery),
        modifier = modifier,
    ) {
        FleetSummaryCountUp(
            value = display.avgBattery,
            decimals = BATTERY_DECIMALS,
            suffix = BATTERY_SUFFIX,
            color = MaterialTheme.colorScheme.onSurface,
            reduceMotion = reduceMotion,
            locale = locale,
        )
    }
}

/** Total Range: the summed SI range converted to the user's unit (web `Gauge` icon, purple). */
@Composable
private fun TotalRangeCard(
    display: FleetSummaryDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    // Web appends the distance unit to the LABEL (`{t('fleet.totalRange')} {unitPrefs.distance}`), not as
    // a suffix on the animated value.
    val label = "${stringResource(R.string.translation_fleet_totalRange)} ${display.rangeUnit}"
    FleetSummaryCard(
        icon = DataDisplayGlyphs.Gauge,
        accent = SummaryAccent.Purple,
        label = label,
        modifier = modifier,
    ) {
        FleetSummaryCountUp(
            value = display.totalRange,
            decimals = RANGE_DECIMALS,
            color = MaterialTheme.colorScheme.onSurface,
            reduceMotion = reduceMotion,
            locale = locale,
        )
    }
}

/** Charging / Online: the charging count (green) over the online total (web `Zap` icon, amber). */
@Composable
private fun ChargingOnlineCard(
    display: FleetSummaryDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    FleetSummaryCard(
        icon = DataDisplayGlyphs.Bolt,
        accent = SummaryAccent.Amber,
        label = stringResource(R.string.translation_fleet_chargingOnline),
        modifier = modifier,
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            FleetSummaryCountUp(
                value = display.chargingCount,
                decimals = COUNT_DECIMALS,
                color = TeslaTokens.chart.battery,
                reduceMotion = reduceMotion,
                locale = locale,
            )
            Text(
                text = "$ONLINE_SEPARATOR${display.onlineCount}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
            )
        }
    }
}

// ── Building blocks ─────────────────────────────────────────────────────────────────────────────────

/**
 * One KPI card — a centered accent [icon], a [value] (a count-up or the charging/online pair), and a
 * muted [label], in a [GlassPanel] that fills its grid cell (web `flex flex-col justify-center
 * text-center`). The [icon] is decorative (its meaning is carried by the [label]); the [label] + value
 * read in order under TalkBack.
 */
@Composable
private fun FleetSummaryCard(
    icon: ImageVector,
    accent: SummaryAccent,
    label: String,
    modifier: Modifier = Modifier,
    value: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                size = CARD_ICON_SIZE,
                tint = summaryAccentColor(accent),
            )
            value()
            MetricLabel(label)
        }
    }
}

/**
 * The count-up figure for a card — the colored, reduced-motion-aware analogue of the shared
 * `AnimatedNumber` (which forces the on-surface metric colour and ignores reduced motion). It counts up
 * from zero on first composition, formats each frame with [decimals] + locale grouping via the shared
 * [ChartFormat], and appends the optional [suffix] (the `%` on the battery card). Under [reduceMotion] it
 * renders the final figure statically (the reduced-motion accessibility contract). The figure uses the
 * shared metric-value type (`headlineSmall` SemiBold) carrying the [color] accent.
 */
@Composable
private fun FleetSummaryCountUp(
    value: Double,
    decimals: Int,
    color: Color,
    reduceMotion: Boolean,
    locale: Locale,
    suffix: String = "",
    modifier: Modifier = Modifier,
) {
    val rendered =
        if (reduceMotion) {
            ChartFormat.number(value, decimals, locale) + suffix
        } else {
            val animated = remember(value) { Animatable(0f) }
            LaunchedEffect(value) {
                animated.animateTo(
                    targetValue = value.toFloat(),
                    animationSpec = tween(durationMillis = MotionDurations.slow, easing = FastOutSlowInEasing),
                )
            }
            ChartFormat.number(animated.value.toDouble(), decimals, locale) + suffix // parity:allow toDouble substring false positive
        }
    Text(
        text = rendered,
        modifier = modifier,
        color = color,
        style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
        textAlign = TextAlign.Center,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The "offline / last known" freshness row shown above the grid while a refresh is in flight, the cache
 * is stale, or a refresh failed (offline). Surfaces the [DataFreshness] chip + a retry control so a
 * cached-but-stale fleet is honestly labelled and recoverable — the web component delegates this to its
 * parent's query state, reproduced here per-surface.
 */
@Composable
private fun FleetSummaryFreshness(
    state: UiState<*>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.End),
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        IconButton(
            imageVector = DataDisplayGlyphs.Wifi,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** The skeleton grid shown while the enrolled list first-loads — four shimmer cards in the web layout. */
@Composable
private fun FleetSummaryLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    BoxWithConstraints(modifier = modifier.fillMaxWidth().semantics { contentDescription = label }) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) GRID_COLUMNS_SM else GRID_COLUMNS_BASE
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            val rows = (FLEET_SUMMARY_CARD_COUNT + columns - 1) / columns
            repeat(rows) { rowIndex ->
                val cellsInRow = minOf(columns, FLEET_SUMMARY_CARD_COUNT - rowIndex * columns)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    repeat(cellsInRow) {
                        GlassPanel(modifier = Modifier.weight(1f), padding = PanelPadding.Md) {
                            Skeleton(widthFraction = 1f, height = LOADING_CARD_HEIGHT, rounded = true)
                        }
                    }
                    repeat(columns - cellsInRow) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The hard-error surface (enrolled list failed with nothing cached) — a retry affordance over the grid. */
@Composable
private fun FleetSummaryError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Maps a [SummaryAccent] to its design token (P1/S9) — the web per-card utility colours. */
@Composable
private fun summaryAccentColor(accent: SummaryAccent): Color =
    when (accent) {
        SummaryAccent.Cyan -> TeslaTokens.chart.regen
        SummaryAccent.Green -> TeslaTokens.chart.battery
        SummaryAccent.Purple -> TeslaTokens.chart.power
        SummaryAccent.Amber -> TeslaTokens.chart.energy
    }

/** The number of cards the surface renders (web maps four `GlassPanel`s). */
private const val FLEET_SUMMARY_CARD_COUNT: Int = 4

/**
 * The one glyph this surface needs that the shared `DataDisplayGlyphs` set does not author — `Car` (the
 * Vehicles card, web lucide `Car`). Drawn as a 24×24 stroked vector, mirroring the in-repo
 * `DataDisplayGlyphs` authoring approach (Android has no bundled `lucide` equivalent). Monochrome and
 * recoloured at render time by the `Icon` tint. `Battery`, `Gauge`, and `Zap` reuse the shared
 * `DataDisplayGlyphs.Battery` / `DataDisplayGlyphs.Gauge` / `DataDisplayGlyphs.Bolt`.
 */
private object FleetSummaryGlyphs {
    /** Side-profile car: cabin + body outline over two wheels (web lucide `Car`). */
    val Car: ImageVector =
        stroked("Car") {
            moveTo(2.5f, 14f)
            lineTo(5.5f, 14f)
            lineTo(7.5f, 9f)
            lineTo(15.5f, 9f)
            lineTo(17.5f, 14f)
            lineTo(21.5f, 14f)
            circle(7.5f, 16f, 1.7f)
            circle(16.5f, 16f, 1.7f)
        }

    /** Appends a full circle of radius [r] centred at ([cx], [cy]) as two semicircular arcs. */
    private fun PathBuilder.circle(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx + r, cy)
        arcTo(r, r, 0f, false, true, cx - r, cy)
        arcTo(r, r, 0f, false, true, cx + r, cy)
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ────────────────────────

private val PREVIEW_DATA =
    FleetSummaryData(
        vehicleCount = 4,
        avgBatteryPercent = 73.5,
        totalRangeMeters = 1_287_480.0,
        chargingCount = 1,
        onlineCount = 3,
    )

@Preview(name = "Populated", showBackground = true, widthDp = 420)
@Composable
private fun FleetSummaryPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetSummaryContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA, fetchedAt = 1L),
            prefs = FleetSummaryDisplayPrefs.METRIC_DEFAULT,
            onRefresh = {},
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Empty — no vehicles (zeros)", showBackground = true, widthDp = 420)
@Composable
private fun FleetSummaryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetSummaryContent(
            state = UiState(phase = UiPhase.Content, data = FleetSummaryData.EMPTY, fetchedAt = 1L),
            prefs = FleetSummaryDisplayPrefs.METRIC_DEFAULT,
            onRefresh = {},
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Offline — last known (wide)", showBackground = true, widthDp = 720)
@Composable
private fun FleetSummaryOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetSummaryContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            prefs = FleetSummaryDisplayPrefs.METRIC_DEFAULT,
            onRefresh = {},
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun FleetSummaryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetSummaryContent(
            state = UiState.loading(),
            prefs = FleetSummaryDisplayPrefs.METRIC_DEFAULT,
            onRefresh = {},
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun FleetSummaryErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetSummaryContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = FleetSummaryDisplayPrefs.METRIC_DEFAULT,
            onRefresh = {},
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}
