// Page-host wiring for the TwoFactorAuthPage account-security surface (A7) — the seam that attaches real screen
// content to the `account2fa` ⁄ `/account/2fa` navigation destination (Destinations.kt, already a metadata-only
// route). It mirrors the sibling [io.teslasync.android.notifications.channels.ChannelsPageHost] precedent:
// [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route
// falls through to the shared not-found screen. [TwoFactorAuthRoute] reads the app DI graph from
// [LocalDataContainer], binds the embedded TOTPEnrollmentSection feature view to a TOTP repository over the shared
// resilient client + offline cache (via [bindTOTPEnrollmentSectionSource]), and performs no HTTP itself.
//
// The TOTP status feed is bound through an [HttpTOTPRepository] (the same resilient client + cache the shared
// stores run on) rather than the shared S8 TOTPStore so the feature view's view-model controls the
// refetch-on-retry the surface's freshness contract drives — exactly as the sibling ChannelsPage / ArchivedPage
// bind their feeds. The repository evicts the status cache key on every mutation success (the web hooks'
// `invalidate(totpKeys.status)`), so the section flips from "Not enrolled" to "Active" without a manual refetch.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.twofactor

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.totpenrollmentsection.bindTOTPEnrollmentSectionSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTOTPRepository

/**
 * The stateful route entry registered for the `account2fa` destination. Resolves the app data graph from the
 * CompositionLocal, builds the feature view's source over a TOTP repository (the shared resilient client + offline
 * cache), and binds the page to the app's redacting logger. The cache-then-network status feed and the four
 * mutations (enroll / verify / revoke / regenerate backup codes) live entirely in the embedded
 * TOTPEnrollmentSection feature view; this route owns no data of its own.
 */
@Composable
fun TwoFactorAuthRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            bindTOTPEnrollmentSectionSource(
                repository = HttpTOTPRepository(container.api, container.cacheStore),
            )
        }
    TwoFactorAuthPage(source = source, logger = container.logger)
}

/**
 * Registers the [TwoFactorAuthRoute] host for the `account2fa` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TwoFactorAuthPageHost {
    private val id: String = TwoFactorAuthPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TwoFactorAuthRoute() }
    }
}
