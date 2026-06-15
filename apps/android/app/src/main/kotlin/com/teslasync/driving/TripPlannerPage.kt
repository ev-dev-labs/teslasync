// The native Jetpack Compose + Material 3 TripPlannerPage driving surface — a parity port of
// web/src/features/driving/pages/TripPlannerPage.tsx, the route-planning workspace. It reproduces the page's
// route-input form (origin/destination autocomplete, the two SOC sliders, the driving-speed dropdown, the Plan
// Trip + Send to Car actions, the vehicle-battery chip, and the plan error banner), the estimate disclaimer, the
// route map, the six summary StatCards, the feasibility warning, the weather-impact panel, the battery-along-route
// SOC chart, and the leg-by-leg breakdown — plus every plan data state (loading / error / success) and every
// visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [TripPlannerPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the form + plan + prefs + picker + battery state);
// [TripPlannerPageContent] is the stateless render layer. The one `usePlanTrip` mutation is mutation-driven, so
// the result sections render only once a plan exists (web `{route && …}` guards) while the form, map, SOC chart,
// and leg list always render (showing their own empty states before a plan). SI values are converted to the
// user's units only here at the display boundary via the model's prefs helpers (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-sections; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the
// parity-complete panel set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)

package io.teslasync.android.driving.tripplanner

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.VehicleOption
import io.teslasync.android.components.forms.VehicleSelect
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.addressinput.AddressInput
import io.teslasync.android.featureviews.addressinput.AddressLocation
import io.teslasync.android.featureviews.socroutechart.SOCRouteChart
import io.teslasync.android.featureviews.tripleglist.TripLegList
import io.teslasync.android.featureviews.tripplannermap.TripPlannerMap
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/** The two decimal places the weather efficiency-factor caption shows (web `fmtNumber(factor, 2)`). */
private const val WEATHER_FACTOR_DECIMALS = 2

/** The page's interaction callbacks, wired to the [TripPlannerPageViewModel] (web event handlers). */
data class TripPlannerActions(
    val onOriginText: (String) -> Unit,
    val onDestText: (String) -> Unit,
    val onSelectOrigin: (AddressLocation) -> Unit,
    val onSelectDestination: (AddressLocation) -> Unit,
    val onCurrentSoc: (Int) -> Unit,
    val onMinArrivalSoc: (Int) -> Unit,
    val onSpeedFactor: (Double) -> Unit,
    val onSelectVehicle: (Long) -> Unit,
    val onPlan: () -> Unit,
    val onSendToCar: () -> Unit,
    val onRetry: () -> Unit,
    val geocode: (String) -> Flow<Resource<JsonElement>>,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TripPlannerPageViewModel] over the supplied [source] (the host wires the shared
 * driving repository + vehicles/settings holders + the app-scoped active-vehicle selection + the resilient client
 * via [tripPlannerPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun TripPlannerPage(
    source: TripPlannerPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: TripPlannerPageViewModel =
        viewModel(
            key = TripPlannerPageRegistration.SLUG,
            factory = viewModelFactory { initializer { TripPlannerPageViewModel(source, logger) } },
        )
    TripPlannerPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] form + plan + prefs + picker + battery state to the content. */
@Composable
fun TripPlannerPage(
    viewModel: TripPlannerPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val form by viewModel.form.collectAsStateWithLifecycle()
    val planState by viewModel.planState.collectAsStateWithLifecycle()
    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()
    val vehicleOptions by viewModel.vehicleOptions.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val vehicleBattery by viewModel.vehicleBattery.collectAsStateWithLifecycle()
    val canPlan by viewModel.canPlan.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            TripPlannerActions(
                onOriginText = viewModel::setOriginText,
                onDestText = viewModel::setDestText,
                onSelectOrigin = { viewModel.selectOrigin(TripLocationInput(it.lat, it.lng, it.name)) },
                onSelectDestination = { viewModel.selectDestination(TripLocationInput(it.lat, it.lng, it.name)) },
                onCurrentSoc = viewModel::setCurrentSoc,
                onMinArrivalSoc = viewModel::setMinArrivalSoc,
                onSpeedFactor = viewModel::setSpeedFactor,
                onSelectVehicle = viewModel::selectVehicle,
                onPlan = viewModel::planTrip,
                onSendToCar = viewModel::sendToCar,
                onRetry = viewModel::retry,
                geocode = viewModel::geocode,
            )
        }

    TripPlannerPageContent(
        form = form,
        planState = planState,
        selectedVehicleId = selectedVehicleId,
        vehicleOptions = vehicleOptions,
        prefs = prefs,
        vehicleBattery = vehicleBattery,
        canPlan = canPlan,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. The header, the route-input form, the route map, the SOC chart, and the leg list
 * always render (so no region ever blanks — the children show their own empty states before a plan); the
 * disclaimer, the six summary StatCards, the feasibility warning, and the weather panel render once a plan exists
 * (web `{route && …}` / `{weather && …}` guards).
 */
@Composable
fun TripPlannerPageContent(
    form: TripPlannerFormState,
    planState: UiState<TripPlanResult>,
    selectedVehicleId: Long?,
    vehicleOptions: List<TripVehicleOption>,
    prefs: TripPlannerDisplayPrefs,
    vehicleBattery: Int?,
    canPlan: Boolean,
    actions: TripPlannerActions,
    modifier: Modifier = Modifier,
) {
    val plan = planState.data
    val route = plan?.route

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TripPlannerHeader(
            vehicleOptions = vehicleOptions,
            selectedVehicleId = selectedVehicleId,
            onSelectVehicle = actions.onSelectVehicle,
        )

        FadeIn { TripPlannerForm(form, planState, vehicleBattery, canPlan, route != null, actions) }

        if (route != null && route.isEstimate) {
            FadeIn(delayMs = ESTIMATE_DELAY) {
                AlertBanner(
                    message = stringResource(R.string.translation_tripPlanner_disclaimer),
                    tone = Tone.Warning,
                )
            }
        }

        FadeIn(delayMs = MAP_DELAY) {
            TripPlannerMap(snapshot = mapToMapSnapshot(form, plan))
        }

        if (route != null) {
            FadeIn(delayMs = STATS_DELAY) {
                TripStatGrid(
                    tiles = statTiles(route, prefs, stringResource(R.string.translation_common_free)),
                )
            }
        }

        if (route != null && !route.feasible) {
            FadeIn(delayMs = FEASIBILITY_DELAY) {
                AlertBanner(
                    message = stringResource(R.string.translation_tripPlanner_notFeasible),
                    tone = Tone.Danger,
                )
            }
        }

        val weather = plan?.weather
        if (weather != null && weather.hasImpact) {
            FadeIn(delayMs = WEATHER_DELAY) { TripWeatherPanel(weather = weather, prefs = prefs) }
        }

        FadeIn(delayMs = SOC_DELAY) {
            SOCRouteChart(
                socCurve = mapToSocPoints(plan),
                chargeStops = mapToSocChargeStops(plan),
                minArrivalSoc = form.minArrivalSoc.toDouble(), // parity:allow numeric widening, not a TODO stub
            )
        }

        FadeIn(delayMs = LEGS_DELAY) {
            val breakdown = mapToRouteBreakdown(plan)
            TripLegList(legs = breakdown.legs, chargeStops = breakdown.chargeStops)
        }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer`) and the vehicle picker (web `actions`). */
@Composable
private fun TripPlannerHeader(
    vehicleOptions: List<TripVehicleOption>,
    selectedVehicleId: Long?,
    onSelectVehicle: (Long) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_tripPlanner_title))
            BodyText(
                stringResource(R.string.translation_tripPlanner_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        VehicleSelect(
            vehicles = remember(vehicleOptions) { vehicleOptions.map { VehicleOption(it.id, it.label) } },
            selectedId = selectedVehicleId,
            onSelect = onSelectVehicle,
            label = stringResource(R.string.translation_tripPlanner_form_vehicle),
        )
    }
}

/** The route-input form panel (web `GlassPanel` "Plan Your Trip"). */
@Composable
private fun TripPlannerForm(
    form: TripPlannerFormState,
    planState: UiState<TripPlanResult>,
    vehicleBattery: Int?,
    canPlan: Boolean,
    hasPlan: Boolean,
    actions: TripPlannerActions,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth().semantics { heading() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                MapsGlyphs.Navigation,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(stringResource(R.string.translation_tripPlanner_form_title))
        }

        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            AddressInput(
                value = form.originText,
                onValueChange = actions.onOriginText,
                onSelect = actions.onSelectOrigin,
                geocode = actions.geocode,
                label = stringResource(R.string.translation_tripPlanner_form_from),
                hint = stringResource(R.string.translation_tripPlanner_form_origin),
            )
            AddressInput(
                value = form.destText,
                onValueChange = actions.onDestText,
                onSelect = actions.onSelectDestination,
                geocode = actions.geocode,
                label = stringResource(R.string.translation_tripPlanner_form_to),
                hint = stringResource(R.string.translation_tripPlanner_form_destination),
            )

            Slider(
                value = form.currentSoc.toFloat(),
                onValueChange = { actions.onCurrentSoc(it.toInt()) },
                label = stringResource(R.string.translation_tripPlanner_form_currentSOC),
                valueText = "${form.currentSoc}$PERCENT",
                valueRange = CURRENT_SOC_RANGE,
                steps = CURRENT_SOC_STEPS,
            )
            Slider(
                value = form.minArrivalSoc.toFloat(),
                onValueChange = { actions.onMinArrivalSoc(it.toInt()) },
                label = stringResource(R.string.translation_tripPlanner_form_minArrival),
                valueText = "${form.minArrivalSoc}$PERCENT",
                valueRange = MIN_ARRIVAL_SOC_RANGE,
                steps = MIN_ARRIVAL_SOC_STEPS,
            )
            SpeedSelect(speedFactor = form.speedFactor, onSpeedFactor = actions.onSpeedFactor)

            TripPlannerActionsRow(
                planState = planState,
                canPlan = canPlan,
                hasPlan = hasPlan,
                hasDestination = form.destination != null,
                vehicleBattery = vehicleBattery,
                onPlan = actions.onPlan,
                onSendToCar = actions.onSendToCar,
            )

            if (planState.isError) {
                AlertBanner(
                    message = stringResource(R.string.translation_tripPlanner_form_error),
                    tone = Tone.Danger,
                )
            }
        }
    }
}

/** The driving-speed dropdown (web `Select` over `speedOptions`). */
@Composable
private fun SpeedSelect(
    speedFactor: Double,
    onSpeedFactor: (Double) -> Unit,
) {
    val options =
        listOf(
            SelectOption(SpeedFactors.RELAXED.toString(), stringResource(R.string.translation_tripPlanner_speed_relaxed)),
            SelectOption(SpeedFactors.NORMAL.toString(), stringResource(R.string.translation_tripPlanner_speed_normal)),
            SelectOption(SpeedFactors.BRISK.toString(), stringResource(R.string.translation_tripPlanner_speed_brisk)),
            SelectOption(SpeedFactors.FAST.toString(), stringResource(R.string.translation_tripPlanner_speed_fast)),
        )
    Select(
        options = options,
        selectedValue = speedFactor.toString(),
        onSelect = { value -> value.toDoubleOrNull()?.let(onSpeedFactor) }, // parity:allow numeric token parse, not a TODO stub
        label = stringResource(R.string.translation_tripPlanner_form_drivingSpeed),
    )
}

/** The Plan Trip + Send to Car actions and the vehicle-battery chip (web button row). */
@Composable
private fun TripPlannerActionsRow(
    planState: UiState<TripPlanResult>,
    canPlan: Boolean,
    hasPlan: Boolean,
    hasDestination: Boolean,
    vehicleBattery: Int?,
    onPlan: () -> Unit,
    onSendToCar: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Button(
            label =
                if (planState.isLoading) {
                    stringResource(R.string.translation_tripPlanner_form_planning)
                } else {
                    stringResource(R.string.translation_tripPlanner_form_planTrip)
                },
            onClick = onPlan,
            enabled = canPlan && !planState.isLoading,
            loading = planState.isLoading,
            leadingIcon = MapsGlyphs.Route,
        )
        if (hasPlan && hasDestination) {
            Button(
                label = stringResource(R.string.translation_tripPlanner_form_sendToCar),
                onClick = onSendToCar,
                variant = ButtonVariant.Secondary,
                leadingIcon = sendGlyph,
            )
        }
        if (vehicleBattery != null) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    DataDisplayGlyphs.Battery,
                    contentDescription = null,
                    size = IconSize.Xs,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Caption(stringResource(R.string.translation_tripPlanner_form_vehicleBattery, vehicleBattery))
            }
        }
    }
}

/** The six summary StatCards (web `Grid` of `StatCard`) in a 2×3 layout. */
@Composable
private fun TripStatGrid(
    tiles: TripStatTiles,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tripPlanner_stats_distance),
                value = tiles.distance,
                unit = tiles.distanceUnit,
                icon = MapsGlyphs.Route,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tripPlanner_stats_totalTime),
                value = tiles.totalTime,
                icon = DataDisplayGlyphs.Clock,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tripPlanner_stats_drivingTime),
                value = tiles.driving,
                icon = MapsGlyphs.Navigation,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tripPlanner_stats_chargingTime),
                value = tiles.charging,
                icon = DataDisplayGlyphs.Bolt,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tripPlanner_stats_energy),
                value = tiles.energy,
                icon = DataDisplayGlyphs.Battery,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_tripPlanner_stats_cost),
                value = tiles.cost,
                icon = dollarGlyph,
            )
        }
    }
}

/** The weather-impact panel (web `GlassPanel` with the thermometer glyph). */
@Composable
private fun TripWeatherPanel(
    weather: PlannedWeather,
    prefs: TripPlannerDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                thermometerGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.tertiary,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(stringResource(R.string.translation_tripPlanner_weather_title))
                BodyText(weather.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (weather.avgTempC != null) {
                    Caption(
                        stringResource(
                            R.string.translation_tripPlanner_weather_factor,
                            prefs.number(weather.efficiencyFactor, WEATHER_FACTOR_DECIMALS),
                        ),
                    )
                }
            }
        }
    }
}

// ── Local glyphs (web lucide icons with no shared-library equivalent) ─────────────────────────────────────────

/** Web `lucide` `Send` paper-plane icon — used on the "Send to Car" action. */
private val sendGlyph: ImageVector =
    strokedGlyph("Send") {
        moveTo(22f, 2f)
        lineTo(11f, 13f)
        moveTo(22f, 2f)
        lineTo(15f, 22f)
        lineTo(11f, 13f)
        lineTo(2f, 9f)
        close()
    }

/** Web `lucide` `DollarSign` icon — used on the Est. Cost StatCard. */
private val dollarGlyph: ImageVector =
    strokedGlyph("DollarSign") {
        moveTo(12f, 2f)
        lineTo(12f, 22f)
        moveTo(17f, 5f)
        lineTo(9.5f, 5f)
        arcTo(3.5f, 3.5f, 0f, false, false, 9.5f, 12f)
        lineTo(14.5f, 12f)
        arcTo(3.5f, 3.5f, 0f, false, true, 14.5f, 19f)
        lineTo(6f, 19f)
    }

/** Web `lucide` `Thermometer` icon — used on the weather-impact panel. */
private val thermometerGlyph: ImageVector =
    strokedGlyph("Thermometer") {
        moveTo(14f, 4f)
        lineTo(14f, 14.54f)
        arcTo(4f, 4f, 0f, true, true, 10f, 14.54f)
        lineTo(10f, 4f)
        arcTo(2f, 2f, 0f, false, true, 14f, 4f)
        close()
    }

/** Authors a 24×24 stroked [ImageVector], mirroring the shared `*Glyphs` builders (no material-icons-extended). */
private fun strokedGlyph(
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

private const val PERCENT = "%"
private const val ESTIMATE_DELAY = 20
private const val MAP_DELAY = 30
private const val STATS_DELAY = 40
private const val FEASIBILITY_DELAY = 50
private const val WEATHER_DELAY = 50
private const val SOC_DELAY = 60
private const val LEGS_DELAY = 70

/** Current-SOC slider discrete steps between 10 and 100 (inclusive integers ⇒ `max − min − 1`). */
private const val CURRENT_SOC_STEPS =
    TripPlannerPageRegistration.CURRENT_SOC_MAX - TripPlannerPageRegistration.CURRENT_SOC_MIN - 1

/** Min-arrival-SOC slider discrete steps between 5 and 50 (inclusive integers ⇒ `max − min − 1`). */
private const val MIN_ARRIVAL_SOC_STEPS =
    TripPlannerPageRegistration.MIN_ARRIVAL_SOC_MAX - TripPlannerPageRegistration.MIN_ARRIVAL_SOC_MIN - 1

/** The current-SOC slider's inclusive float value range (web `min={10}` / `max={100}`). */
private val CURRENT_SOC_RANGE: ClosedFloatingPointRange<Float> =
    TripPlannerPageRegistration.CURRENT_SOC_MIN.toFloat()..TripPlannerPageRegistration.CURRENT_SOC_MAX.toFloat()

/** The min-arrival-SOC slider's inclusive float value range (web `min={5}` / `max={50}`). */
private val MIN_ARRIVAL_SOC_RANGE: ClosedFloatingPointRange<Float> =
    TripPlannerPageRegistration.MIN_ARRIVAL_SOC_MIN.toFloat()..TripPlannerPageRegistration.MIN_ARRIVAL_SOC_MAX.toFloat()
