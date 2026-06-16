// The data seam the SettingsPage surface binds to, plus its production binding over the shared S8
// SettingsStore. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's single data hook: `useSettings → GET /settings`
// (web/src/api/hooks/useSettings.ts). The web page reads that hook ONLY for its `isLoading` flag (the
// `PageContainer loading={isLoading}` overlay); the rendered settings controls live in the composed child
// feature-views, each of which binds its own slice of the same shared store.
//
// The settings-document feed is the cache-then-network [Resource] stream the shared S7 SettingsRepository
// exposes via the S8 [SettingsStore]; it shares the `settings` cache key with every other Settings surface
// so logout clears it in one call and a cached document gives an instant cold start. A narrow seam so the
// view-model depends on an abstraction (real store ↔ test fake), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName`
// is suppressed for the co-located binding helper.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.page

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [SettingsPageViewModel] depends on so it binds to an abstraction (the shared
 * Settings holder in production, a fake in tests), never to a concrete client or the network. The one
 * read is the page's cache-then-network settings-document `Resource` feed (web `useSettings`), used to
 * drive the page-level loading → success surface; no HTTP touches the view.
 */
interface SettingsPageSource {
    /** The shared, refreshable `GET /settings` document feed (web `useSettings`). */
    fun settings(): StateFlow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared S8 [settingsStore]'s settings-document feed — the same
 * cache-then-network `Resource` flow every Settings surface runs on, so the page renders the full
 * loading / content state matrix from the one source of truth. No HTTP touches the view.
 */
fun settingsPageSourceOf(settingsStore: SettingsStore): SettingsPageSource =
    object : SettingsPageSource {
        override fun settings(): StateFlow<Resource<JsonElement>> = settingsStore.settings()
    }
