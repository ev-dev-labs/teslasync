// The native Jetpack Compose + Material 3 PowersharePage charging surface — a parity port of
// web/src/features/charging/pages/PowersharePage.tsx, the bidirectional power-sharing monitor. It reproduces the
// page's two inline panels (GlassPanel 1 — the status row with its three KPI tiles; GlassPanel 5 — the stop
// reason), every data state (loading skeleton / empty / error-retry / content), and every visible string
// (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [PowersharePage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the folded readings snapshot); [PowersharePageContent]
// is the stateless render layer. The single bound [PowersharePageViewModel.state] —
// `UiState<PowershareReadings>`, the fold of the web page's five `useSignalObservations` queries — drives the
// page chrome (title, subtitle, the global `VehicleSelect` scope) plus the two panels, exactly as the web page
// threads its five latest values into its `hasData` snapshot.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.powershare

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the two body panels' entrance fades (web `FadeIn delay={0.05}`). */
private const val FADE_STEP_MS = 50

/** The Output Power tile's unit symbol — the web hardcodes `unit={'kW'}` (not an i18n key, like the web). */
private const val UNIT_KW = "kW"

/** The Hours Remaining tile's unit symbol — the web hardcodes `unit={'h'}` (not an i18n key, like the web). */
private const val UNIT_HOURS = "h"

/** Height of the stop-reason loading skeleton row. */
private val STOP_REASON_SKELETON_HEIGHT = 24.dp

/** Width fraction of the stop-reason loading skeleton. */
private const val STOP_REASON_SKELETON_FRACTION = 0.5f

/** The page's interaction callbacks, wired to the [PowersharePageViewModel] (web error-retry affordance). */
data class PowershareActions(
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [PowersharePageViewModel] over the supplied [source] (the host wires the shared
 * telemetry repository + the app-scoped active-vehicle selection via [powersharePageSourceOf]). [logger] defaults
 * to the app's redacting logger.
 */
@Composable
fun PowersharePage(
    source: PowersharePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: PowersharePageViewModel =
        viewModel(
            key = PowersharePageRegistration.SLUG,
            factory = viewModelFactory { initializer { PowersharePageViewModel(source, logger) } },
        )
    PowersharePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] readings snapshot + interaction callbacks to the stateless content. */
@Composable
fun PowersharePage(
    viewModel: PowersharePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val actions = remember(viewModel) { PowershareActions(onRetry = viewModel::retry) }

    PowersharePageContent(state = state, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the page chrome (title + subtitle + the global vehicle-scope picker) followed by the
 * two always-visible panels (web GlassPanel 1 — status; GlassPanel 5 — stop reason). Each panel renders the full
 * state matrix internally (loading skeleton / hard-error retry / content / friendly empty state) so no region
 * ever collapses to a blank box.
 */
@Composable
fun PowersharePageContent(
    state: UiState<PowershareReadings>,
    actions: PowershareActions,
    modifier: Modifier = Modifier,
) {
    val readings = state.data ?: PowershareReadings()
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PowershareHeader()

        FadeIn { PowershareStatusPanel(state = state, readings = readings, onRetry = actions.onRetry) }
        FadeIn(delayMs = FADE_STEP_MS) {
            PowershareStopReasonPanel(state = state, readings = readings, onRetry = actions.onRetry)
        }
    }
}

/** The page chrome — the title + muted subtitle (web `PageContainer`) and the global `<VehicleSelect />`. */
@Composable
private fun PowershareHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_powershare_title))
            BodyText(
                stringResource(R.string.translation_powershare_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // web `actions={<VehicleSelect />}` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/**
 * GlassPanel 1 — the status row (web first `FadeIn` panel). The header pairs a bolt glyph with the section title
 * and a status Badge (the latest `PowershareStatus`, or the no-data Badge). The body shows the three KPI tiles
 * (Type / Output Power / Hours Remaining) once any reading is present, a loading skeleton on the first load, a
 * retry surface on a hard error, or the friendly empty state when no telemetry has arrived.
 */
@Composable
private fun PowershareStatusPanel(
    state: UiState<PowershareReadings>,
    readings: PowershareReadings,
    onRetry: () -> Unit,
) {
    val sectionTitle = stringResource(R.string.translation_powershare_statusSection)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = sectionTitle },
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(
                    DataDisplayGlyphs.Bolt,
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = TeslaTokens.status.warning,
                )
                SectionTitle(sectionTitle)
            }
            PowershareStatusBadge(readings.status)
        }

        when {
            state.isLoading -> PowershareStatusGrid(readings = readings, loading = true)
            state.isError -> PowershareErrorBody(onRetry = onRetry)
            readings.hasData -> PowershareStatusGrid(readings = readings, loading = false)
            else ->
                EmptyState(
                    icon = DataDisplayGlyphs.Info,
                    message = stringResource(R.string.translation_powershare_noData),
                )
        }
    }
}

/** The status Badge — the latest `PowershareStatus` toned by [statusVariant], or the no-data Badge (web `'—'`). */
@Composable
private fun PowershareStatusBadge(status: String?) {
    if (status != null) {
        Badge(text = status, variant = statusVariant(status))
    } else {
        Badge(text = stringResource(R.string.translation_common_noData), variant = BadgeVariant.Neutral)
    }
}

/**
 * The three KPI tiles (web `<Grid cols={{ default: 1, sm: 2, md: 3 }}>`), stacked one-per-row to match the web
 * mobile breakpoint. Each tile renders its raw figure verbatim (no unit conversion — see PowersharePageModel):
 * Type (text), Output Power (kW, 2 dp), Hours Remaining (h, 1 dp). When [loading] the tiles show value skeletons.
 */
@Composable
private fun PowershareStatusGrid(
    readings: PowershareReadings,
    loading: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_powershare_type),
            value = readings.shareType ?: EM_DASH,
            icon = DataDisplayGlyphs.Battery,
            sublabel = stringResource(R.string.translation_powershare_typeSub),
            loading = loading,
        )
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_powershare_outputPower),
            value = readings.powerKw?.let { PowershareFormat.power(it) } ?: EM_DASH,
            unit = readings.powerKw?.let { UNIT_KW },
            icon = DataDisplayGlyphs.Bolt,
            sublabel = stringResource(R.string.translation_powershare_outputPowerSub),
            loading = loading,
        )
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_powershare_hoursLeft),
            value = readings.hoursLeftH?.let { PowershareFormat.hours(it) } ?: EM_DASH,
            unit = readings.hoursLeftH?.let { UNIT_HOURS },
            icon = DataDisplayGlyphs.Clock,
            sublabel = stringResource(R.string.translation_powershare_hoursLeftSub),
            loading = loading,
        )
    }
}

/**
 * GlassPanel 5 — the stop reason (web second `FadeIn` panel). The header pairs an alert glyph with the section
 * title. The body shows the stop-reason Badge + help line when a reason is present, a loading skeleton on the
 * first load, a retry surface on a hard error, or the friendly empty state when no reason has been recorded.
 */
@Composable
private fun PowershareStopReasonPanel(
    state: UiState<PowershareReadings>,
    readings: PowershareReadings,
    onRetry: () -> Unit,
) {
    val sectionTitle = stringResource(R.string.translation_powershare_stopReasonSection)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = sectionTitle },
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                DataDisplayGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.danger,
            )
            SectionTitle(sectionTitle)
        }

        when {
            state.isLoading -> Skeleton(widthFraction = STOP_REASON_SKELETON_FRACTION, height = STOP_REASON_SKELETON_HEIGHT)
            state.isError -> PowershareErrorBody(onRetry = onRetry)
            readings.stopReason != null ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    Badge(text = readings.stopReason, variant = stopReasonVariant(readings.stopReason))
                    HelperText(stringResource(R.string.translation_powershare_stopReasonHelp))
                }
            else ->
                EmptyState(
                    icon = DataDisplayGlyphs.Info,
                    message = stringResource(R.string.translation_powershare_noStopReason),
                )
        }
    }
}

/** The hard-error surface shared by both panels — a localized retry-able error (web has no error UI; ADR-011). */
@Composable
private fun PowershareErrorBody(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}
