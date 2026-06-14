// The native Jetpack Compose + Material 3 TeslaRegionPage admin surface — a parity port of
// web/src/features/admin/pages/TeslaRegionPage.tsx, the dedicated /tesla-region wrapper. Like the web page it
// is a thin promotion wrapper: it sets the page title/subtitle header (web `PageContainer` title + subtitle) and
// embeds the shared RegionSettings feature view (web `<RegionSettings />`) verbatim, so the region-code +
// Fleet-API-base-URL cards, the "Synced" stamp, the Refresh action, and every cache-then-network data state
// (loading / stale-offline / error-retry / empty / content) come from that one shared surface — never
// re-implemented here (DRY, ADR-006). Every visible string resolves from the generated res/values catalog
// (ADR-014); the page records the one-shot PII-safe `view.opened` diagnostic for the /tesla-region route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.region

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
import io.teslasync.android.featureviews.regionsettings.RegionSettings
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.UserStore

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11) and binds the embedded
 * RegionSettings feature view to the shared User/Account [store] (P1/S8). The feature view owns the Tesla
 * region feed and its own loading / stale / error / empty / content states, so this wrapper holds no
 * page-level data of its own. [logger] defaults to the app's redacting logger.
 */
@Composable
fun TeslaRegionPage(
    store: UserStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordTeslaRegionPageOpened(logger) }
    TeslaRegionPageContent(store = store, modifier = modifier, logger = logger)
}

/**
 * The page body: the title/subtitle header (web `PageContainer` chrome) above the shared RegionSettings feature
 * view (web `<RegionSettings />`). Scrolls vertically so the embedded panel is always reachable on short
 * viewports, mirroring the sibling admin surfaces.
 */
@Composable
fun TeslaRegionPageContent(
    store: UserStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TeslaRegionHeader()
        RegionSettings(store = store, logger = logger)
    }
}

/** The page header: the title + subtitle the web `PageContainer` renders (web `region.title` / `region.subtitle`). */
@Composable
private fun TeslaRegionHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_region_title))
        BodyText(
            stringResource(R.string.translation_region_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
