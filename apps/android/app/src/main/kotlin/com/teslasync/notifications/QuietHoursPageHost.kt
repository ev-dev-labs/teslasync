// Page-host wiring for the QuietHoursPage notifications surface (A7) — the seam that attaches real screen
// content to the `notificationsQuietHours` ⁄ `/notifications/quiet-hours` navigation destination
// (Destinations.kt, already a metadata-only route). It mirrors the sibling
// [io.teslasync.android.notifications.archived.ArchivedPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [QuietHoursRoute] reads the app DI graph from [LocalDataContainer], binds the
// canonical panel to a notifications repository over the shared resilient client + offline cache, binds the AI
// advisor's draft stream to the same shared client, derives the advisor's AI-Off gate from the shared S8
// SettingsStore, and performs no HTTP itself.
//
// The quiet-hours feed is bound through an [HttpNotificationsRepository] (the same resilient client + cache the
// shared stores run on) rather than a shared store so the panel view-model controls the refresh its freshness
// contract drives — exactly the binding the sibling ArchivedRoute uses. The advisor's gate is the settings
// document's `ai_mode`/`ai_features` (web `withAiFeature('quiet-hours-suggestion')`); connectivity defaults to
// online, the same fail-open default the advisor view-model carries until a shared connectivity monitor lands.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.quiethours

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.quiethourspanel.quietHoursPanelSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * The stateful route entry registered for the `notificationsQuietHours` destination. Resolves the app data
 * graph from the CompositionLocal, builds the panel source over a notifications repository (the shared
 * resilient client + offline cache), binds the AI advisor's draft stream over the same shared client, derives
 * the advisor's AI-Off gate from the shared SettingsStore, and binds the page to the app's redacting logger.
 * Connectivity defaults to online — the advisor's own fail-open default — because the app exposes no shared
 * connectivity monitor yet.
 */
@Composable
fun QuietHoursRoute() {
    val container = LocalDataContainer.current
    val scope = rememberCoroutineScope()

    val panelSource =
        remember(container) {
            quietHoursPanelSource(HttpNotificationsRepository(container.api, container.cacheStore))
        }
    val aiSource = remember(container) { container.api.asAiQuietHoursStreamSource() }

    val featureEnabled =
        remember(container, scope) {
            container.settingsStore
                .settings()
                .map { quietHoursSuggestionEnabled(it.cached) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.Eagerly,
                    initialValue = quietHoursSuggestionEnabled(container.settingsStore.settings().value.cached),
                )
        }
    val connectivity = remember { MutableStateFlow(true) }

    QuietHoursPage(
        panelSource = panelSource,
        aiSource = aiSource,
        connectivity = connectivity,
        featureEnabled = featureEnabled,
        logger = container.logger,
    )
}

/**
 * Registers the [QuietHoursRoute] host for the `notificationsQuietHours` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object QuietHoursPageHost {
    private val id: String = QuietHoursPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { QuietHoursRoute() }
    }
}
