// Page-host wiring for the FeedbackQueuePage admin surface (A7) — the seam that attaches real screen content
// to the `adminFeedback` ⁄ `/admin/feedback` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.apilogs.ApiLogsPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [FeedbackQueueRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared
// S8 [io.teslasync.shared.core.presentation.feedback.FeedbackStore] via [asFeedbackQueueSource], and performs
// no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.feedback

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `adminFeedback` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over the shared S8 Feedback holder, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun FeedbackQueueRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.feedbackStore.asFeedbackQueueSource() }
    FeedbackQueuePage(source = source, logger = container.logger)
}

/**
 * Registers the [FeedbackQueueRoute] host for the `adminFeedback` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object FeedbackQueuePageHost {
    private val id: String = FeedbackQueueRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { FeedbackQueueRoute() }
    }
}
