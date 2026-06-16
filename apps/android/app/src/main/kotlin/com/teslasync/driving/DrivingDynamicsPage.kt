// The native Jetpack Compose + Material 3 DrivingDynamicsPage driving surface — a parity port of
// web/src/features/driving/pages/DrivingDynamicsPage.tsx, the live motor-telemetry, G-force & driving-analysis
// dashboard. It reproduces the page's eleven sections (live motor status, acceleration G-force, pedal usage,
// speed & gear, autopilot & cruise, the motor power/torque/RPM history charts, the motor-efficiency insights, the
// summary stat grid, the driving-coach report, the drive-analytics charts, and the driving-style tips), every
// data state (loading / error / success, plus the cache-then-network stale/offline tier the bound state holder
// carries), and every visible string (resolved from the generated res/values `dynamics.*` catalog, ADR-014).
//
// Composition: [DrivingDynamicsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the five feeds + the selection); [DrivingDynamicsPageContent]
// is the stateless render layer (the page chrome — title / subtitle / freshness chip / vehicle-scope picker —
// then the `/motor/latest`-gated body: a loader on a first load, a retryable error panel on a hard failure, or
// the eleven sections otherwise). Each section is one of the shipped A3 driving feature views, threaded the
// typed inputs the framework-free model decodes from the raw SI feeds; the self-fetching G-Force + Autopilot
// panels bind their own feeds via the selected vehicle id. SI values are converted to the user's units only
// inside each feature view at its display boundary (Phase-48 SI-canonical) — never here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sections.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.driving.drivingdynamics

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.autopilotsection.AutopilotSection
import io.teslasync.android.featureviews.autopilotsection.AutopilotSectionSource
import io.teslasync.android.featureviews.driveanalyticssection.DriveAnalyticsSection
import io.teslasync.android.featureviews.drivingcoachsection.DrivingCoachData
import io.teslasync.android.featureviews.drivingcoachsection.DrivingCoachSection
import io.teslasync.android.featureviews.drivingtips.DrivingTips
import io.teslasync.android.featureviews.gforcepanel.GForcePanel
import io.teslasync.android.featureviews.livemotorstatus.MotorLive
import io.teslasync.android.featureviews.livemotorstatus.drivingdynamics.DrivingDynamicsLiveMotorStatus
import io.teslasync.android.featureviews.motorefficiencyinsights.MotorEfficiencyInsights
import io.teslasync.android.featureviews.motorhistorycharts.MotorHistoryCharts
import io.teslasync.android.featureviews.pedalusage.DriveDynamicsLive
import io.teslasync.android.featureviews.pedalusage.PedalUsage
import io.teslasync.android.featureviews.speedgearpanel.SpeedGearPanel
import io.teslasync.android.featureviews.summarystats.SummaryStats
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DrivingDynamicsPageViewModel] over the supplied [source] (the host wires the
 * shared Vehicles holder + page-local Driving/Telemetry repositories + the active-vehicle selection via
 * [drivingDynamicsPageSourceOf]). [logger] defaults to the app's redacting logger. Records the one-shot
 * `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun DrivingDynamicsPage(
    source: DrivingDynamicsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DrivingDynamicsPageViewModel =
        viewModel(
            key = DrivingDynamicsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DrivingDynamicsPageViewModel(source, logger) } },
        )
    DrivingDynamicsPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel]'s feeds to the stateless content. */
@Composable
fun DrivingDynamicsPage(
    viewModel: DrivingDynamicsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val motorState by viewModel.motorState.collectAsStateWithLifecycle()
    val driveDynamics by viewModel.driveDynamics.collectAsStateWithLifecycle()
    val motorHistory by viewModel.motorHistory.collectAsStateWithLifecycle()
    val drives by viewModel.drives.collectAsStateWithLifecycle()
    val coach by viewModel.coach.collectAsStateWithLifecycle()
    val vehicleId by viewModel.vehicleId.collectAsStateWithLifecycle()

    DrivingDynamicsPageContent(
        motorState = motorState,
        driveDynamics = driveDynamics,
        motorHistory = motorHistory,
        drives = drives,
        coach = coach,
        vehicleId = vehicleId,
        autopilotSource = viewModel.autopilotSource,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker),
 * then the `/motor/latest`-gated body — a centered loader on a first load (web `loading={motorLoading}`), a
 * retryable error panel on a hard failure with nothing cached, or the eleven sections otherwise (web
 * `error={null}` always renders the sections). Each section renders its own content-or-empty surface so no
 * section is ever hidden.
 */
@Composable
fun DrivingDynamicsPageContent(
    motorState: UiState<MotorLive?>,
    driveDynamics: DriveDynamicsLive?,
    motorHistory: MotorHistoryDerived,
    drives: DrivesDerived,
    vehicleId: Long?,
    autopilotSource: AutopilotSectionSource,
    onRetry: () -> Unit,
    coach: DrivingCoachData?,
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
        DrivingDynamicsChrome(state = motorState)

        when {
            motorState.isLoading -> DrivingDynamicsLoading()
            motorState.isError -> DrivingDynamicsError(onRetry = onRetry)
            else ->
                DrivingDynamicsBody(
                    motor = motorState.data,
                    driveDynamics = driveDynamics,
                    motorHistory = motorHistory,
                    drives = drives,
                    coach = coach,
                    vehicleId = vehicleId,
                    autopilotSource = autopilotSource,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer` title/subtitle), the freshness chip, and the scope picker. */
@Composable
private fun DrivingDynamicsChrome(state: UiState<MotorLive?>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_dynamics_title))
                BodyText(
                    stringResource(R.string.translation_dynamics_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // web `DataFreshnessAuto` — the live motor-snapshot freshness chip.
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `actions={<VehicleSelect />}` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading` ▸ skeleton). */
@Composable
private fun DrivingDynamicsLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun DrivingDynamicsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * The loaded body — the eleven sections in their web order, each a shipped A3 driving feature view threaded the
 * typed inputs the framework-free model decoded from the raw SI feeds. The self-fetching G-Force + Autopilot
 * panels resolve their own feeds from the selected [vehicleId]; the statistics panels read the cross-section
 * stats the motor history fanned out; the SpeedGearPanel + DriveAnalyticsSection read their drive slices. Every
 * panel owns its own loading / empty / content surface, so no section is hidden when a slice is absent.
 */
@Composable
private fun DrivingDynamicsBody(
    motor: MotorLive?,
    driveDynamics: DriveDynamicsLive?,
    motorHistory: MotorHistoryDerived,
    drives: DrivesDerived,
    coach: DrivingCoachData?,
    vehicleId: Long?,
    autopilotSource: AutopilotSectionSource,
) {
    val stats = motorHistory.stats
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        DrivingDynamicsLiveMotorStatus(motor = motor)
        GForcePanel(vehicleId = vehicleId)
        PedalUsage(dynamics = driveDynamics)
        SpeedGearPanel(motor = motorShiftOf(motor), drives = drives.speedSamples)
        AutopilotSection(source = autopilotSource, vehicleId = vehicleId)
        MotorHistoryCharts(motorHistory = motorHistory.samples)
        MotorEfficiencyInsights(
            motorStats = stats?.toEfficiencyStats(),
            throttleStyle = stats?.efficiencyThrottleStyle(),
        )
        SummaryStats(motorStats = stats?.toSummaryStats())
        DrivingCoachSection(data = coach)
        DriveAnalyticsSection(drives = drives.analyticsDrives)
        DrivingTips(motorStats = stats?.toTipsStats(), throttleStyle = stats?.tipsThrottleStyle())
    }
}
