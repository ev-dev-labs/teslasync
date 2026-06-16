// Page-host wiring for the SettingsPage surface (A7) — the seam that attaches the generated web-parity
// settings screen to the `settings` ⁄ `/settings` navigation destination (Destinations.kt). It supersedes the
// temporary A8 native-settings seam (io.teslasync.android.settings.SettingsPageHost), whose own doc stated it
// stood in "until A7 wires its generated pages"; TeslaSyncApplication now calls THIS host at process start.
// It mirrors the sibling A7 hosts (GlancePageHost, ArchivedPageHost): [SettingsPageRoute] reads the app DI
// graph from [LocalDataContainer], binds the page to the shared S8 SettingsStore feed and constructs the two
// page-local stores the composed Reset / Advanced sections need — a [SettingsResetStore] over the shared
// resilient client + offline cache, and a device-local [SharedPreferencesConfirmSilenceStore] — and performs
// no HTTP itself.
//
// The Reset section binds through a page-local [SettingsResetStore] (built over the same resilient client +
// cache the shared stores run on) rather than a DI-graph holder, exactly as the GlancePage precedent
// constructs a page-local VehicleCommandStore for a domain the Android DI graph does not yet wire; the
// confirm-silence allowlist is a device-local SharedPreferences store the AdvancedSettings panel owns.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.page

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.advancedsettings.SharedPreferencesConfirmSilenceStore
import io.teslasync.android.featureviews.resetsection.asResetSectionSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpSettingsResetRepository
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetStore

/**
 * The stateful route entry registered for the `settings` destination. Resolves the app data graph from the
 * CompositionLocal, builds the page-level source over the shared [SettingsStore], the Reset section's source
 * over a page-local [SettingsResetStore] (the shared resilient client + offline cache), and the Advanced
 * section's allowlist over a device-local [SharedPreferencesConfirmSilenceStore], then binds the page to the
 * app's redacting logger.
 */
@Composable
fun SettingsPageRoute() {
    val container = LocalDataContainer.current
    val context = LocalContext.current
    val source = remember(container) { settingsPageSourceOf(container.settingsStore) }
    val resetSource =
        remember(container) {
            SettingsResetStore(HttpSettingsResetRepository(container.api, container.cacheStore)).asResetSectionSource()
        }
    val confirmSilenceStore = remember(context) { SharedPreferencesConfirmSilenceStore(context) }
    SettingsPage(
        source = source,
        resetSource = resetSource,
        confirmSilenceStore = confirmSilenceStore,
        logger = container.logger,
    )
}

/**
 * Registers the [SettingsPageRoute] host for the `settings` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SettingsPageHost {
    private val id: String = SettingsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SettingsPageRoute() }
    }
}
