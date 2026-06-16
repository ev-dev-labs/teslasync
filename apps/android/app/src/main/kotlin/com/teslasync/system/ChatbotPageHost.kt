// Page-host wiring for the ChatbotPage system surface (A7) — the seam that attaches real screen content to the
// `chatbot` ⁄ `/chatbot` navigation destination (Destinations.kt, already a metadata-only route). It mirrors the
// sibling page-host precedents: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [ChatbotRoute] reads the app DI graph from [LocalDataContainer], binds the page to a chat repository
// over the shared resilient client + offline cache via [chatbotPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpChatRepository

/**
 * The stateful route entry registered for the `chatbot` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a chat repository (the shared resilient client + offline cache), and
 * binds the page to the app's redacting logger.
 */
@Composable
fun ChatbotRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { chatbotPageSourceOf(HttpChatRepository(container.api, container.cacheStore)) }
    ChatbotPage(source = source, logger = container.logger)
}

/**
 * Registers the [ChatbotRoute] host for the `chatbot` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ChatbotPageHost {
    private val id: String = ChatbotPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ChatbotRoute() }
    }
}
