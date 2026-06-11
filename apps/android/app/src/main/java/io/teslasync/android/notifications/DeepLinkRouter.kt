package io.teslasync.android.notifications

import io.teslasync.android.navigation.RouteTable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A process-scoped bridge for deep links that arrive from a notification tap (P3/A6, ADR-009). The
 * Activity extracts a `teslasync://app/...` URI from the tap intent and [request]s it here; the
 * navigation shell observes [links] and feeds the URI into the Navigation-Compose graph. Holding the
 * pending link in a [StateFlow] means a tap that arrives before the signed-in shell is composed (e.g.
 * a cold start through the auth gate) is applied as soon as the graph appears, then [consume]d.
 */
class DeepLinkRouter {
    private val mutableLinks = MutableStateFlow<String?>(null)

    /** The pending deep-link URI to navigate to, or null when none. */
    val links: StateFlow<String?> = mutableLinks.asStateFlow()

    /** Requests navigation to [uri] (the most recent request wins). */
    fun request(uri: String) {
        mutableLinks.value = uri
    }

    /** Clears the pending link once it has been handled by the graph. */
    fun consume() {
        mutableLinks.value = null
    }
}

/**
 * The notification-tap intent contract (P3/A6). A tap carries the deep-link URI in a private extra
 * (rather than the intent's data URI) so it is routed only through the [DeepLinkRouter] and never
 * double-handled by the NavHost's automatic intent deep-linking.
 */
object NotificationIntent {
    /** The intent extra key carrying the `teslasync://app/...` deep-link URI of a tapped notification. */
    const val EXTRA_DEEP_LINK = "io.teslasync.android.intent.DEEP_LINK"

    /**
     * Validates a deep-link URI from an untrusted intent extra: only the app's own custom scheme is
     * accepted, so a forged intent can never drive navigation to an arbitrary external URI.
     */
    fun sanitize(uri: String?): String? = uri?.takeIf { it.startsWith("${RouteTable.APP_SCHEME}://") }
}
