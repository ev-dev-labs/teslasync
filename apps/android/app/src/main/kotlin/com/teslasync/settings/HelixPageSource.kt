// The data seam the HelixPage settings surface binds to, plus its production binding over the shared S8
// SettingsStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's single own read: `const { isLoading } = useSettings()`
// (web/src/features/settings/pages/HelixPage.tsx → web/src/api/hooks/useSettings.ts, `GET /settings`). The
// page uses that read solely for the PageContainer `loading` flag; the embedded AISettings feature view binds
// its own settings/usage feeds for the actual configuration content.
//
// A narrow one-read seam so the view-model depends on an abstraction (the shared Settings holder in
// production ↔ a test fake), never on a concrete store or the network. The `Resource` freshness flags flow
// through unchanged (ADR-013) so the view-model can render the full lifecycle (loading → success).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/settings) cannot form a valid Kotlin package and the file hosts the seam plus its binding,
// mirroring the sibling ArchivedPageSource / AISettingsViewSource surfaces.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.settings.helix

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [HelixPageViewModel] depends on so it binds to an abstraction (the shared Settings holder
 * in production, a fake in tests), never to a concrete store or the network. [settings] is the page's own
 * cache-then-network `/settings` document feed (web `useSettings`); the page reads it only for its loading
 * state. No HTTP touches the view.
 */
interface HelixPageSource {
    /** Stream the shared, refreshable `GET /settings` document feed (web `useSettings`). */
    fun settings(): StateFlow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [settingsStore] — the same memoized, multi-observer `/settings` feed
 * every Settings/AI surface app-wide folds into (web `useSettings`), so the page's loading flag shares one
 * upstream collection with the unit formatter and any other observer rather than opening a second request. The
 * `Resource` freshness flags flow through unchanged so the view-model renders the full lifecycle. No HTTP
 * touches the view.
 */
fun helixPageSource(settingsStore: SettingsStore): HelixPageSource =
    object : HelixPageSource {
        override fun settings(): StateFlow<Resource<JsonElement>> = settingsStore.settings()
    }
