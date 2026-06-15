// Page-host wiring for the PrivacyPage settings surface (A7) — the seam that attaches real screen content
// to the `accountPrivacy` ⁄ `/account/privacy` navigation destination (Destinations.kt, already a
// metadata-only route under NavGroup.Settings). It mirrors the sibling
// [io.teslasync.android.notifications.channels.ChannelsPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [PrivacyRoute] performs no HTTP and constructs no data source — the embedded
// PrivacySection feature view self-wires its client-side recent-pages + cookie-consent stores and the
// shared version-policy feed from the composition locals.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.privacy

import androidx.compose.runtime.Composable
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `accountPrivacy` destination. Renders the [PrivacyPage]
 * wrapper, which sets the page header and embeds the shared PrivacySection feature view; the browser-local
 * privacy state (recent-pages count + clear, cookie-consent tri-state) and the version-policy feed live
 * entirely in that feature view, so this route owns no data of its own.
 */
@Composable
fun PrivacyRoute() {
    PrivacyPage()
}

/**
 * Registers the [PrivacyRoute] host for the `accountPrivacy` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object PrivacyPageHost {
    private val id: String = PrivacyPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { PrivacyRoute() }
    }
}
