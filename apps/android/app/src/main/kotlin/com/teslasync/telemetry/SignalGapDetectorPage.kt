// The native Jetpack Compose + Material 3 SignalGapDetectorPage telemetry surface — a parity port of
// web/src/features/telemetry/pages/SignalGapDetectorPage.tsx, the /signal-gaps wrapper. Like the web page it is a thin
// promotion wrapper around the shared signal catalog: it sets the page title/subtitle header (web `PageContainer`
// title + subtitle) plus the `<VehicleSelect />` action, reads the global active-vehicle selection (web
// `useSelectedVehicle`) through a [SignalGapDetectorPageViewModel], and then renders EXACTLY the web ternary — the
// "select a vehicle to begin" empty state while no vehicle is selected (web `!vehicleId || vehicleId <= 0`), or the
// shared SignalCatalogPanel feature view bound to the selected vehicle (web `<SignalCatalogPanel vehicleId />`). The
// catalog's four summary cards, search/filter/sort controls, the staleness table, and every loading / empty /
// filtered-empty / error / content / stale state come from that one shared surface — never re-implemented here (DRY,
// ADR-006), mirroring the sibling notifications/ChannelsPage (a wrapper that embeds NotificationChannelsView). Every
// visible string resolves from the generated res/values catalog (ADR-014); the page records the one-shot PII-safe
// `view.opened` diagnostic for the /signal-gaps route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + header + empty composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.signalgapdetector

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.signalcatalogpanel.SignalCatalogPanel
import io.teslasync.android.featureviews.signalcatalogpanel.SignalCatalogPanelSource
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Stateful entry point ────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SignalGapDetectorPageViewModel] over the app-scoped selection + fleet holders (web
 * `useSelectedVehicle`), records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved-selection
 * [SignalGapDetectorPageState], and renders the header + the empty/catalog branch. The host supplies the
 * [catalogSource] (an adapter over the shared Telemetry layer) so the embedded SignalCatalogPanel binds the live
 * `GET /signals/{id}/live` feed; [logger] defaults to the app's redacting logger.
 */
@Composable
fun SignalGapDetectorPage(
    catalogSource: SignalCatalogPanelSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val container = LocalDataContainer.current
    val viewModel: SignalGapDetectorPageViewModel =
        viewModel(
            key = SignalGapDetectorPageRegistration.SLUG,
            factory =
                SignalGapDetectorPageViewModel.factory(
                    selectedVehicleStore = container.selectedVehicleStore,
                    vehiclesStore = container.vehiclesStore,
                    logger = logger,
                ),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    SignalGapDetectorPageContent(state = state, catalogSource = catalogSource, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The page body — the unit/UI-test and preview entry point. Always draws the title/subtitle/picker header (web
 * `PageContainer` chrome), then the same branch the web ternary picks: the friendly empty state while no vehicle is
 * selected, or the shared SignalCatalogPanel bound to the selected vehicle. Scrolls vertically so the embedded
 * catalog (a non-lazy table by design) is always reachable on short viewports, mirroring the sibling ChannelsPage.
 */
@Composable
fun SignalGapDetectorPageContent(
    state: SignalGapDetectorPageState,
    catalogSource: SignalCatalogPanelSource,
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
        SignalGapDetectorHeader()

        val vehicleId = state.vehicleId
        if (state.hasVehicle && vehicleId != null) {
            SignalCatalogPanel(source = catalogSource, vehicleId = vehicleId)
        } else {
            SignalGapDetectorEmpty()
        }
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the title heading, the descriptive subtitle, and the
 * `<VehicleSelect />` action (the global vehicle-scope picker, bound to the shared selection store). Stacked so the
 * full-width picker has room on a phone.
 */
@Composable
private fun SignalGapDetectorHeader() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_signalGap_title))
            BodyText(
                text = stringResource(R.string.translation_signalGap_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        VehicleSelect()
    }
}

/**
 * The empty branch — the friendly "select a vehicle to begin" state (web `<EmptyState icon={<Activity/>} …/>`), shown
 * while no vehicle is selected. The vehicle picker is in the header above, so no inline CTA is needed (web comment).
 * Never a blank region.
 */
@Composable
private fun SignalGapDetectorEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_signalGap_noVehicleDesc),
        modifier = Modifier.fillMaxWidth(),
        icon = NavGlyphs.Pulse,
        title = stringResource(R.string.translation_signalGap_noVehicle),
    )
}
