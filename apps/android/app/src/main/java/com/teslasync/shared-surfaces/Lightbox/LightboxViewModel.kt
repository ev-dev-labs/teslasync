// UI-thread-free state holder backing the Lightbox surface — the native port of the web component's gallery
// binding (web/src/components/ui/Lightbox.tsx is handed `images`; the native surface binds them through
// [LightboxSource]). It performs no HTTP or persistence itself (ADR-002): the view collects [state] and
// folds it through the pure [LightboxProjection]. The gallery is the surface's primary (and only) async
// dependency, so its cache-then-network lifecycle drives the shell's loading / content / empty / error /
// stale / offline states. An empty gallery (web `images.length === 0` → `return null`) is the structurally-
// empty phase, surfaced as a friendly empty state.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Lightbox) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.lightbox

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder for the Lightbox surface.
 *
 * The gallery feed is re-shared as a lifecycle-aware [UiState] so the composable can switch the immersive
 * viewer's surface — loading (first fetch), content (the navigable, zoomable viewer), the empty branch (a
 * friendly empty state instead of the web's blank `return null`), a hard error with retry, and the
 * stale/offline freshness envelope — without re-deriving the cache-then-network contract. [refresh]/[retry]
 * re-read the gallery, and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) — the
 * surface slug only, never an image URL, caption, or any gallery content.
 *
 * @param source the gallery seam (a store-backed adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LightboxViewModel(
    private val source: LightboxSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The gallery as lifecycle-aware [UiState] — the surface's primary feed. An empty gallery is treated as
     * the structurally-empty phase via the [LightboxProjection.isEmpty] predicate, so the empty state is
     * honest rather than a blank overlay.
     */
    val state: StateFlow<UiState<LightboxGallery>> =
        refreshTrigger
            .flatMapLatest { source.gallery() }
            .asUiState(isEmpty = { LightboxProjection.isEmpty(it) })

    init {
        // Trigger the first gallery read; `state` starts at loading and flips to content/empty/error.
        source.refresh()
    }

    /** Re-reads the gallery after a hard error, and backs the stale freshness chip's auto-refresh. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Re-reads the gallery; alias of [retry] for the stale auto-refresh call site. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no image URL, caption, or gallery content. Call from the composable's first effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to LightboxRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "lightbox.refresh"

        /** Wires the surface from a shared [LightboxGalleryStore]. */
        fun create(
            store: LightboxGalleryStore,
            logger: Logger,
        ): LightboxViewModel = LightboxViewModel(StoreLightboxSource(store), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: LightboxSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { LightboxViewModel(source, logger) }
            }
    }
}
