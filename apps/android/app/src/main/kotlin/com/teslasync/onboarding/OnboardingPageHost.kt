// Page-host wiring for the OnboardingPage surface (A7) — the seam that attaches real screen content to the
// `onboarding` ⁄ `/onboarding` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.slowqueries.SlowQueriesPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [OnboardingRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// shared S8 [io.teslasync.shared.core.presentation.onboarding.OnboardingStore] via [asOnboardingPageSource], and
// performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/onboarding) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.onboarding

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `onboarding` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared S8 onboarding holder, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun OnboardingRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.onboardingStore.asOnboardingPageSource() }
    OnboardingPage(source = source, logger = container.logger)
}

/**
 * Registers the [OnboardingRoute] host for the `onboarding` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object OnboardingPageHost {
    private val id: String = OnboardingPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { OnboardingRoute() }
    }
}
