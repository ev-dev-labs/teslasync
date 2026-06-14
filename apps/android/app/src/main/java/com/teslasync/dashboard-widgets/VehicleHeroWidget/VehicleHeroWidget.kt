// The native Jetpack Compose + Material 3 Vehicle Hero dashboard widget — a parity port of
// web/src/features/dashboard/widgets/VehicleHeroWidget.tsx. The web widget is a thin wrapper: it loads the
// vehicle (`useVehicles`), its last-known state (`useVehicleState`), and its live signals (`useVehicleLive`),
// resolves the firmware string, and renders `<WidgetShell><VehicleHero …/></WidgetShell>`. This port keeps
// that contract: the shared [VehicleHeroWidgetViewModel] binds the same feeds (P1/S8 + the app-scoped live
// session) into a [UiState], and the rendering is delegated to the shared `VehicleHero` feature view — the
// native analogue of the web `../components/VehicleHero` the widget imports — which draws the responsive
// gauges, charging banner, stat grid, quick actions, and the asleep / loading / empty / error surfaces. The
// view never performs HTTP/SSE; SI values convert to the user's units at the render boundary via the live
// [UnitFormatter]. Every string resolves through the i18n catalog (inside the feature view).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleHeroWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehiclehero

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.featureviews.vehiclehero.VehicleHeroActions
import io.teslasync.android.featureviews.vehiclehero.VehicleHeroContent
import io.teslasync.android.featureviews.vehiclehero.VehicleHeroData
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlin.time.Instant

/**
 * Stateful entry point. Binds the shared Vehicles feeds + the app-scoped live session via [source] into a
 * [VehicleHeroWidgetViewModel], records the one-shot `view.opened` diagnostic (slug `VehicleHeroWidget`),
 * collects the live [units] formatter, and renders the surface. A dashboard host supplies an optional
 * [vehicleId] (web `WidgetProps.vehicleId`), the navigation [actions] for the hero's quick-action buttons,
 * and a unique [instanceKey] per placement; everything else defaults from the app's `LocalDataContainer`.
 *
 * @param source the cache-then-network Vehicles + live seam (defaults to the shared S8 store + live session).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param actions the navigation callbacks for the hero's quick-action / wake buttons (default no-ops).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 * @param instanceKey the per-placement ViewModel key so two placements keep independent state.
 */
@Composable
fun VehicleHeroWidget(
    modifier: Modifier = Modifier,
    source: VehicleHeroWidgetSource = rememberDefaultVehicleHeroWidgetSource(),
    vehicleId: Long? = null,
    actions: VehicleHeroActions = VehicleHeroActions(),
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = VehicleHeroWidgetRegistration.ID,
) {
    val widgetViewModel: VehicleHeroWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { VehicleHeroWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(widgetViewModel) { widgetViewModel.recordViewOpened() }
    val state by widgetViewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    VehicleHeroWidgetContent(
        state = state,
        onRefresh = widgetViewModel::refresh,
        modifier = modifier,
        actions = actions,
        formatter = formatter,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Mirrors the web widget's
 * `<WidgetShell><VehicleHero …/></WidgetShell>` composition by handing the cache-then-network [state] to the
 * shared [VehicleHeroContent]: it renders the loading skeleton, the hard-error retry surface, the friendly
 * no-vehicle empty state, or the live hero (gauges + charging + stats + actions) / asleep wake card, and
 * auto-refreshes stale data — all without ever fetching. [onRefresh] backs the error retry and the stale
 * auto-refresh; [formatter] is the SI→display boundary; [actions] are the hero's navigation callbacks.
 */
@Composable
fun VehicleHeroWidgetContent(
    state: UiState<VehicleHeroData>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    actions: VehicleHeroActions = VehicleHeroActions(),
    formatter: UnitFormatter = UnitFormatter.default(),
) {
    VehicleHeroContent(
        state = state,
        modifier = modifier,
        actions = actions,
        onRetry = onRefresh,
        formatter = formatter,
    )
}

/**
 * The default production [VehicleHeroWidgetSource] — the shared S8 [io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 * for the vehicle + state feeds and the app-scoped live session (ADR-009) for the firmware signals.
 * Remembered against the container so the adapter is not rebuilt on every recomposition.
 */
@Composable
private fun rememberDefaultVehicleHeroWidgetSource(): VehicleHeroWidgetSource {
    val container = LocalDataContainer.current
    return remember(container) {
        container.vehiclesStore.asVehicleHeroWidgetSource(container.liveSessionStore.state)
    }
}

/** Design-time preview of the charging hero surface (sample data; never invoked at runtime). */
@Preview(name = "VehicleHeroWidget — charging", showBackground = true)
@Composable
private fun VehicleHeroWidgetChargingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        VehicleHeroData(
                            vehicle = previewVehicle(),
                            state = previewState(),
                            firmwareVersion = "2025.20.1",
                        ),
                    fetchedAt = 1_780_000_000_000L,
                ),
            onRefresh = {},
        )
    }
}

private fun previewVehicle(): Vehicle =
    Vehicle(
        createdAt = Instant.fromEpochSeconds(0),
        displayName = "Garage Car",
        enrolledAt = Instant.fromEpochSeconds(0),
        id = 1,
        teslaId = 1,
        timezone = "UTC",
        updatedAt = Instant.fromEpochSeconds(0),
        vin = "5YJ3E1EA1KF000000",
        model = "Model 3",
        trimLevel = "Long Range",
    )

private fun previewState(): VehicleState =
    VehicleState(
        batteryLevel = 72,
        chargeRate = 12.5,
        chargerPower = 11.0,
        idealRange = 402_336.0,
        insideTemp = 21.0,
        isCharging = true,
        isClimateOn = true,
        isLocked = true,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 24_140_160.0,
        outsideTemp = 9.0,
        power = -11.0,
        ratedRange = 402_336.0,
        sentryMode = false,
        softwareVersion = "2025.20.1",
        speed = 0.0,
        state = "charging",
        timeToFullCharge = 2.5,
        vehicleId = 1,
    )
