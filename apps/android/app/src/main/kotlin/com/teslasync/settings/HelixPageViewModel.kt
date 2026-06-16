// UI-thread-free state holder backing the HelixPage settings surface — the native port of the web page's single
// own hook usage (web/src/features/settings/pages/HelixPage.tsx: `const { isLoading } = useSettings()`). It
// binds the shared cache-then-network [HelixPageSource] (P1/S8) and re-shares the `/settings` document as a
// lifecycle-aware [UiState] stream via [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable
// that only renders. The page consumes this stream solely for the PageContainer `loading` flag (web `isLoading`
// → the centred spinner); the embedded AISettings feature view owns the configuration content and its own
// loading / empty / error / stale states. The view performs NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) cannot
// form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.settings.helix

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * Lifecycle-aware state holder backing the Compose [HelixPage] surface. It consumes the cache-then-network
 * [HelixPageSource] (P1/S8) and re-shares the `/settings` read as a [UiState] stream via
 * [BaseFeedViewModel.asUiState] — collected only while the screen observes it, dropped shortly after it leaves.
 * The initial frame projects the shared feed's current value, so the first frame is honest (a real first-load
 * `loading` when nothing is cached, or immediate content from cache) rather than an artificial blank.
 *
 * The settings document is never treated as "empty" for this surface ([isEmpty] is pinned to `false`): the web
 * page renders only the loading → success lifecycle for its own hook (it has no page-level empty surface — the
 * embedded AISettings owns the empty/error rendering), so the stream resolves to `loading` while the first
 * fetch is in flight and `content` once any value is present. It owns no networking and no mutations — the page
 * is read-only chrome around the AISettings feature view.
 *
 * @param source the cache-then-network settings seam (the shared S8 holder in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class HelixPageViewModel(
    source: HelixPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    /**
     * The `/settings` document as cache-then-network UI state, projected for the page's loading flag (web
     * `useSettings().isLoading`): `loading` while the first fetch is in flight with nothing cached, otherwise
     * `content`. Hard failures with no cached fallback surface as `error`, but the page leaves the embedded
     * AISettings (which re-binds the same feed) to render the user-facing error — matching the web wrapper.
     */
    val settings: StateFlow<UiState<JsonElement>> = source.settings().asUiState(isEmpty = { false })

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: HelixPageSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { HelixPageViewModel(source, logger) }
            }
    }
}
