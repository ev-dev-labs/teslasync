// The native Jetpack Compose + Material 3 GasPriceAutoPollPage admin surface — a parity port of
// web/src/features/admin/pages/GasPriceAutoPollPage.tsx, the dedicated /gas-price wrapper. Like the web page it
// is a thin promotion wrapper: it sets the page title/subtitle header (web `PageContainer` title + subtitle) and
// embeds the shared GasPriceSettings feature view (web `<GasPriceSettings />`) verbatim, so the auto-poll toggle,
// poll-interval Select, current-price + last-polled metric cards, the "Poll Now" action, and every cache-then-
// network data state (loading / stale-offline / error-retry / content) come from that one shared surface — never
// re-implemented here (DRY, ADR-006). Every visible string resolves from the generated res/values catalog
// (ADR-014); the page records the one-shot PII-safe `view.opened` diagnostic for the /gas-price route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.gasprice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.gaspricesettings.GasPriceSettings
import io.teslasync.android.featureviews.gaspricesettings.GasPriceSettingsSource
import io.teslasync.android.featureviews.gaspricesettings.GasPriceSettingsViewModel
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry: constructs the embedded [GasPriceSettingsViewModel] over the supplied [source] (the host wires
 * the shared S8 [io.teslasync.shared.core.presentation.settings.SettingsStore] via
 * [io.teslasync.android.featureviews.gaspricesettings.gasPriceSettingsSource]). The view-model is keyed by this
 * surface's slug so it is scoped to the /gas-price navigation entry. [logger] defaults to the app's redacting
 * logger.
 */
@Composable
fun GasPriceAutoPollPage(
    source: GasPriceSettingsSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: GasPriceSettingsViewModel =
        viewModel(
            key = GasPriceAutoPollPageRegistration.SLUG,
            factory = GasPriceSettingsViewModel.factory(source, logger),
        )
    GasPriceAutoPollPage(viewModel = vm, modifier = modifier, logger = logger)
}

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11) and binds the embedded
 * GasPriceSettings feature view to the stateless content. The feature view owns the gas-price status feed and its
 * own loading / stale / error / content states, so this wrapper holds no page-level data of its own.
 */
@Composable
fun GasPriceAutoPollPage(
    viewModel: GasPriceSettingsViewModel,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordGasPriceAutoPollPageOpened(logger) }
    GasPriceAutoPollPageContent(viewModel = viewModel, modifier = modifier)
}

/**
 * The stateless page body: the title/subtitle header (web `PageContainer` chrome) above the shared
 * GasPriceSettings feature view (web `<GasPriceSettings />`). Scrolls vertically so the embedded panel is always
 * reachable on short viewports, mirroring the sibling admin surfaces.
 */
@Composable
fun GasPriceAutoPollPageContent(
    viewModel: GasPriceSettingsViewModel,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        GasPriceAutoPollHeader()
        GasPriceSettings(viewModel = viewModel)
    }
}

/** The page header: the title + subtitle the web `PageContainer` renders (web `gas.title` / `gas.subtitle`). */
@Composable
private fun GasPriceAutoPollHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_gas_title))
        BodyText(
            stringResource(R.string.translation_gas_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
