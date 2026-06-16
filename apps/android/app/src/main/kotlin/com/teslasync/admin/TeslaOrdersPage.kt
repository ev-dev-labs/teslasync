// The native Jetpack Compose + Material 3 TeslaOrdersPage admin surface — a parity port of
// web/src/features/admin/pages/TeslaOrdersPage.tsx, the dedicated /tesla-orders wrapper. Like the web page it
// is a thin promotion wrapper: it sets the page title/subtitle header (web `PageContainer` title + subtitle)
// and embeds the shared ActiveOrdersSection feature view (web `<ActiveOrdersSection />`) verbatim, so the
// order grid, the per-order model/status/Order-ID/VIN/Delivery-Date/Upgradable rows, the "Refresh" action,
// the sync stamp, and every cache-then-network data state (loading skeleton / stale-offline / error-retry /
// empty / content) come from that one shared surface — never re-implemented here (DRY, ADR-006). Every
// visible string resolves from the generated res/values catalog (ADR-014); the page records the one-shot
// PII-safe `view.opened` diagnostic for the /tesla-orders route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.teslaorders

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
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.activeorderssection.ActiveOrdersSection
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.UserStore

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11) and binds the embedded
 * ActiveOrdersSection feature view to the shared S8 [store] (the host wires the app DI graph's
 * [io.teslasync.android.data.DataContainer.userStore]). The feature view owns the Tesla-orders feed and its
 * own loading / stale / error / empty / content states, so this wrapper holds no page-level data of its own.
 *
 * @param store the shared User/Account state holder (web `useUser` domain); supplied by the host page.
 * @param modifier the layout modifier for the surface root.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TeslaOrdersPage(
    store: UserStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordTeslaOrdersPageOpened(logger) }
    TeslaOrdersPageContent(store = store, modifier = modifier)
}

/**
 * The stateless page body: the title/subtitle header (web `PageContainer` chrome) above the shared
 * ActiveOrdersSection feature view (web `<ActiveOrdersSection />`). Scrolls vertically so the embedded panel
 * is always reachable on short viewports, mirroring the sibling admin surfaces.
 */
@Composable
fun TeslaOrdersPageContent(
    store: UserStore,
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
        TeslaOrdersHeader()
        ActiveOrdersSection(store = store)
    }
}

/** The page header: the title + subtitle the web `PageContainer` renders (web `orders.title` / `orders.subtitle`). */
@Composable
private fun TeslaOrdersHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_orders_title))
        BodyText(
            stringResource(R.string.translation_orders_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
