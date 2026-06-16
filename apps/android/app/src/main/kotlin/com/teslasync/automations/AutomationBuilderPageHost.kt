// Page-host wiring for the AutomationBuilderPage automations surface (A7) — the seam that attaches real screen content
// to the `automationBuilder` ⁄ `/automations/new` navigation destination (Destinations.kt), reading the optional `id`
// path argument (edit mode) and `preset` query argument (install-preset mode) off the back-stack entry. It mirrors the
// sibling analytics/admin host precedents: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [AutomationBuilderRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 Automations
// + Vehicles holders + a page-local channel-list repository over the shared client + cache (via
// [automationBuilderPageSourceOf]), and routes the post-save / cancel return through the activity back dispatcher
// (the web `navigate('/automations')`). It performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations.builder

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpAutomationsRepository
import io.teslasync.shared.core.data.repo.HttpNotificationChannelsRepository

/**
 * The stateful route entry registered for the `automationBuilder` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared Automations + Vehicles holders + a page-local
 * [HttpNotificationChannelsRepository] (constructed from the shared client + offline cache the container exposes), reads
 * the optional id/preset arguments off [entry], and binds the page to the app's redacting logger. The post-save /
 * cancel return pops the back stack (the web `navigate('/automations')`).
 */
@Composable
fun AutomationBuilderRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            automationBuilderPageSourceOf(
                automationsStore = container.automationsStore,
                detailRepository = HttpAutomationsRepository(container.api, container.cacheStore),
                vehiclesStore = container.vehiclesStore,
                notificationChannelsRepository = HttpNotificationChannelsRepository(container.api, container.cacheStore),
            )
        }
    val automationId = entry.arguments?.getString(AutomationBuilderPageRegistration.ARG_ID)?.toLongOrNull()
    val presetId = entry.arguments?.getString(AutomationBuilderPageRegistration.ARG_PRESET)?.takeIf { it.isNotBlank() }
    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher

    AutomationBuilderPage(
        source = source,
        onNavigateToList = { backDispatcher?.onBackPressed() },
        automationId = automationId,
        presetId = presetId,
        logger = container.logger,
    )
}

/**
 * Registers the [AutomationBuilderRoute] host for the `automationBuilder` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AutomationBuilderPageHost {
    private val id: String = AutomationBuilderPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> AutomationBuilderRoute(entry) }
    }
}
