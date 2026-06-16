// Page-host wiring for the HelixPage settings surface (A7) — the seam that attaches real screen content to the
// `integrationsHelix` ⁄ `/integrations/helix` navigation destination (Destinations.kt, already a metadata-only
// route). It mirrors the sibling [io.teslasync.android.admin.gasprice.GasPriceAutoPollPageHost] precedent:
// [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the
// route falls through to the shared not-found screen. [HelixRoute] reads the app DI graph from
// [LocalDataContainer], binds the page's own `useSettings` loading flag to the shared S8
// [io.teslasync.shared.core.presentation.settings.SettingsStore] via [helixPageSource], wires the embedded
// AISettings feature view to the shared S7 settings/usage/AI repositories via [aiSettingsViewSource], and
// performs no HTTP itself.
//
// The AISettings feeds are bound through the shared resilient client + offline cache repositories (the
// refetch-on-retry binding the AISettings freshness contract drives), exactly as the sibling ArchivedPage /
// ChannelsPage hosts bind their feature views over [container.api] + [container.cacheStore].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.helix

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.aisettings.aiSettingsViewSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpAiSettingsRepository
import io.teslasync.shared.core.data.repo.HttpAiUsageRepository
import io.teslasync.shared.core.data.repo.HttpSettingsRepository

/**
 * The stateful route entry registered for the `integrationsHelix` destination. Resolves the app data graph from
 * the CompositionLocal, builds the page's settings source over the shared S8 Settings holder and the embedded
 * AISettings source over the shared S7 settings/usage/AI repositories (the same resilient client + offline
 * cache the shared stores run on), and binds the page to the app's redacting logger.
 */
@Composable
fun HelixRoute() {
    val container = LocalDataContainer.current
    val helixSource = remember(container) { helixPageSource(container.settingsStore) }
    val aiSettingsSource =
        remember(container) {
            aiSettingsViewSource(
                settingsRepository = HttpSettingsRepository(container.api, container.cacheStore),
                aiUsageRepository = HttpAiUsageRepository(container.api, container.cacheStore),
                aiSettingsRepository = HttpAiSettingsRepository(container.api, container.cacheStore),
            )
        }
    HelixPage(
        helixSource = helixSource,
        aiSettingsSource = aiSettingsSource,
        logger = container.logger,
    )
}

/**
 * Registers the [HelixRoute] host for the `integrationsHelix` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object HelixPageHost {
    private val id: String = HelixPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { HelixRoute() }
    }
}
